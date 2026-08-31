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
  scopes?: string[];
}

const oauth = (Constants.expoConfig?.extra?.utOauth ?? {}) as UtOauthConfig;

const DEFAULT_SCOPES = ['openid', 'profile', 'utexas_profile'];

export interface Session {
  accessToken: string;
  /** Best-effort identity label for the UI. */
  eid: string;
  /** Display name from the profile scope, when the IdP releases one. */
  name?: string;
  /** Raw OIDC ID token, kept for API calls that need to assert identity. */
  idToken?: string;
  /** Epoch ms when the token expires; sessions persist until then or logout. */
  expiresAt: number | null;
  mock: boolean;
}

/**
 * Decode a JWT payload. Claims are used only for display — the token was
 * received over TLS directly from the token endpoint, so we do not verify the
 * signature on-device. Anything security-sensitive must be verified server-side.
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

/** Pull the UT EID out of the ID token, tolerating IdP claim-name variation. */
function eidFromClaims(claims: Record<string, unknown> | null): string {
  if (!claims) return 'UT EID';
  const candidates = [
    'eid',
    'utexasEduPersonEid',
    'uid',
    'preferred_username',
    'sub',
  ];
  for (const key of candidates) {
    const v = claims[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return 'UT EID';
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  signIn: () => Promise<void>;
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
 * Real UT SSO OIDC flow with PKCE via the system browser. The client is
 * registered with UT IAM as a public native client (`token_endpoint_auth_method:
 * none`), so no secret is sent — PKCE is what proves the exchange came from us.
 * Used only when extra.utOauth.enabled is true; otherwise signIn() mocks.
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

  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: oauth.clientId!,
      code: result.params.code,
      redirectUri,
      extraParams: request.codeVerifier
        ? { code_verifier: request.codeVerifier }
        : undefined,
    },
    discovery,
  );

  const claims = token.idToken ? decodeJwtPayload(token.idToken) : null;
  if (__DEV__) {
    // TEMP: verifying what UT's IdP actually releases under utexas_profile.
    // Remove once eidFromClaims' candidate list is confirmed against a real token.
    console.log('[UT SSO] raw id_token claims:', JSON.stringify(claims, null, 2));
  }
  const name = claims?.name;

  return {
    accessToken: token.accessToken,
    eid: eidFromClaims(claims),
    name: typeof name === 'string' ? name : undefined,
    idToken: token.idToken,
    expiresAt: token.expiresIn ? Date.now() + token.expiresIn * 1000 : null,
    mock: false,
  };
}

function mockSignIn(): Session {
  // Local-only session so the app is fully testable before SSO is wired up.
  return {
    accessToken: 'mock-token',
    eid: 'mock-eid',
    expiresAt: Date.now() + 1000 * 60 * 60 * 8,
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

  const signIn = useCallback(async () => {
    const s = oauth.enabled ? await realSignIn() : mockSignIn();
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
