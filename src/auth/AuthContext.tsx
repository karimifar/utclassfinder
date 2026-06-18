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
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
}

const oauth = (Constants.expoConfig?.extra?.utOauth ?? {}) as UtOauthConfig;

export interface Session {
  accessToken: string;
  /** Best-effort identity label for the UI. */
  eid: string;
  /** Epoch ms when the token expires; sessions persist until then or logout. */
  expiresAt: number | null;
  mock: boolean;
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
 * Real UT SSO OAuth 2.0 / OIDC flow with PKCE via the system browser. Used only
 * when extra.utOauth.enabled is true and the endpoints are configured. Until UT
 * ITS provisions the app this stays off and signIn() falls back to a mock.
 */
async function realSignIn(): Promise<Session> {
  const discovery: AuthSession.DiscoveryDocument = {
    authorizationEndpoint: oauth.authorizationEndpoint!,
    tokenEndpoint: oauth.tokenEndpoint!,
  };

  const request = new AuthSession.AuthRequest({
    clientId: oauth.clientId!,
    redirectUri,
    scopes: ['openid', 'profile'],
    usePKCE: true,
  });
  await request.makeAuthUrlAsync(discovery);

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) {
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

  return {
    accessToken: token.accessToken,
    eid: 'UT EID',
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
