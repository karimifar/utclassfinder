import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const SESSION_KEY = 'ut_session_v1';

interface UtOauthConfig {
  enabled: boolean;
  clientId?: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
  brokerUrl?: string;
  scopes?: string[];
}

const oauth = (Constants.expoConfig?.extra?.utOauth ?? {}) as UtOauthConfig;

const DEFAULT_SCOPES = ['openid', 'profile', 'utexas_profile'];

/**
 * How long a sign-in lasts on this device.
 *
 * Deliberately not the OIDC access token's expires_in. We never call a UT API
 * with that token — signing in only proves the user holds a valid EID — so
 * there is nothing whose freshness matters, and inheriting the IdP's ~1 hour
 * lifetime would force a full browser re-login every hour for no security
 * benefit. This is the one knob controlling how often users re-authenticate.
 */
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * What we keep after sign-in — deliberately no token material.
 *
 * The tokens are used once, at sign-in, to establish identity and are then
 * discarded: nothing in the app calls a UT API, so there is nothing to present
 * them to. Persisting the id_token also overflowed SecureStore's 2048-byte
 * advisory limit and would have written a JWT full of PII (UIN, affiliation
 * codes, org unit, job title) into the keychain for no purpose. If a backend
 * ever needs an assertion of identity, re-run the flow rather than storing one.
 */
export interface Session {
  /** Identity label for the UI. */
  eid: string;
  /** Display name from the profile scope, when the IdP releases one. */
  name?: string;
  /** Epoch ms when the session expires; persists until then or logout. */
  expiresAt: number | null;
  mock: boolean;
}

/** Shape of the token endpoint's response, as relayed by the broker. */
interface BrokerTokenResponse {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Decode a JWT payload. Claims are used only for display — the token was
 * received over TLS from our broker, which received it over TLS directly from
 * the token endpoint, so we do not verify the signature on-device. Anything
 * security-sensitive must be verified server-side.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Pull the UT EID out of the ID token.
 *
 * Confirmed against a real token from UT's IdP (2026-09-03): the EID is
 * released as `utexasEduPersonEid` and duplicated in `uid` and `username`.
 * There is no `eid` or `preferred_username` claim. `sub` holds the scoped
 * principal (`abc12345@utexas.edu`), so it is a last resort and the scope is
 * stripped rather than shown as an EID.
 */
function eidFromClaims(claims: Record<string, unknown> | null): string {
  if (!claims) return 'UT EID';
  for (const key of ['utexasEduPersonEid', 'uid', 'username']) {
    const v = claims[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const sub = claims.sub;
  if (typeof sub === 'string' && sub.trim()) return sub.trim().split('@')[0];
  return 'UT EID';
}

/**
 * Two-letter label for the header, e.g. "MK".
 *
 * Prefers the display name from the profile scope. When the IdP releases no
 * name, UT EIDs lead with letters (`mk46795`), so the leading letters are the
 * closest thing to initials available.
 */
export function initialsFromSession(session: Session | null): string {
  if (!session) return '';
  // A mock session has no real identity behind it. Labelling it plainly is
  // what stops a tester filing a bug against behaviour they only saw because
  // they skipped sign-in.
  if (session.mock) return 'TEST';
  const name = session.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  const letters = session.eid.replace(/[^a-zA-Z]/g, '');
  return (letters || session.eid).slice(0, 2).toUpperCase();
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  /**
   * `forceMock` mints a local session even when SSO is configured, so a build
   * can offer both paths at once. Only reachable where DEBUG_TOOLS_ENABLED is
   * true — see the login screen.
   */
  signIn: (opts?: { forceMock?: boolean }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    if (s.expiresAt && Date.now() > s.expiresAt) {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

async function saveSession(s: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
}

const redirectUri = AuthSession.makeRedirectUri({ scheme: 'utclassfinder', path: 'redirect' });

/**
 * Trade the authorization code for tokens via our broker.
 *
 * UT's OP does not support public clients — its token endpoint requires client
 * authentication, and "none" is not among the methods it advertises — so the
 * exchange cannot happen on-device without shipping the client secret to every
 * install. The broker (server/) holds the secret and adds only that client
 * authentication; PKCE still binds this exchange to this app instance.
 */
async function exchangeViaBroker(
  code: string,
  codeVerifier: string,
): Promise<BrokerTokenResponse> {
  const base = oauth.brokerUrl?.replace(/\/+$/, '');
  if (!base) {
    throw new Error('Sign-in is not configured for this build.');
  }

  let res: Response;
  try {
    res = await fetch(`${base}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, code_verifier: codeVerifier }),
    });
  } catch {
    throw new Error('Could not reach the sign-in service. Check your connection and try again.');
  }

  const payload = (await res.json().catch(() => null)) as BrokerTokenResponse | null;
  if (!res.ok || !payload?.id_token) {
    const detail = payload?.error_description || payload?.error;
    throw new Error(detail ? `Sign-in failed: ${detail}` : 'Sign-in failed.');
  }
  return payload;
}

/**
 * Real UT SSO OIDC flow: authorization code + PKCE in the system browser, then
 * the code exchange through our broker. Used only when extra.utOauth.enabled
 * is true; otherwise signIn() mocks.
 */
async function realSignIn(): Promise<Session> {
  const discovery: AuthSession.DiscoveryDocument = {
    authorizationEndpoint: oauth.authorizationEndpoint!,
    tokenEndpoint: oauth.tokenEndpoint!,
    userInfoEndpoint: oauth.userInfoEndpoint,
  };

  const request = new AuthSession.AuthRequest({
    clientId: oauth.clientId!,
    redirectUri,
    scopes: oauth.scopes?.length ? oauth.scopes : DEFAULT_SCOPES,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });
  await request.makeAuthUrlAsync(discovery);

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) {
    if (result.type === 'error') {
      throw new Error(
        result.params.error_description || result.params.error || 'Sign-in failed.',
      );
    }
    throw new Error('Sign-in was cancelled or failed.');
  }

  // PKCE is the only thing binding the exchange to this app instance, so a
  // missing verifier is a hard failure rather than a degraded exchange.
  if (!request.codeVerifier) {
    throw new Error('Sign-in failed: PKCE verifier missing.');
  }

  const token = await exchangeViaBroker(result.params.code, request.codeVerifier);

  const claims = token.id_token ? decodeJwtPayload(token.id_token) : null;
  const name = claims?.name;

  return {
    eid: eidFromClaims(claims),
    name: typeof name === 'string' ? name : undefined,
    expiresAt: Date.now() + SESSION_TTL_MS,
    mock: false,
  };
}

function mockSignIn(): Session {
  // Local-only session so the app is fully testable without SSO configured.
  return {
    eid: 'mock-eid',
    expiresAt: Date.now() + SESSION_TTL_MS,
    mock: true,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSession()
      .then(setSession)
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (opts?: { forceMock?: boolean }) => {
    const useMock = opts?.forceMock === true || !oauth.enabled;
    const s = useMock ? mockSignIn() : await realSignIn();
    await saveSession(s);
    setSession(s);
  }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, loading, signIn, signOut }),
    [session, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
