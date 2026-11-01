/**
 * Signed-in player session.
 *
 *   const { status, user, signIn, signOut, setBalance } = useSession();
 *
 * - status: 'loading' (restoring a saved token at launch) | 'signedOut' | 'signedIn'.
 *   `user` is non-null exactly when status === 'signedIn'.
 * - The JWT is stored with expo-secure-store and restored on launch by calling GET /me.
 *   If that check fails for a non-auth reason (offline), status stays 'loading' and `restoreError`
 *   is set; call `retryRestore()` (the tabs layout shows this as an error with a retry button).
 * - Any API 401 made with the current token signs the player out (with a toast).
 * - After a money-moving call, apply the returned balance immediately with
 *   `setBalance(res.balancePence)`; after PATCH /me or PUT /me/limits use `setUser(me)`.
 *   `refreshUser()` refetches /me (also done automatically when the app returns to the foreground).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Me, RegisterRequest } from '@ripvault/shared';
import { getMe, login, markAuthRestored, onUnauthorized, register, setAuthToken, toApiError } from '../api/client.ts';
import type { ApiError } from '../api/client.ts';
import { useToast } from '../components/Toast.tsx';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionValue {
  status: SessionStatus;
  /** The signed-in player (null unless status === 'signedIn'). */
  user: Me | null;
  /** Set when the saved session could not be checked at launch (e.g. offline). */
  restoreError: ApiError | null;
  /** Retry the launch-time session check after restoreError. */
  retryRestore: () => void;
  /** Throws ApiError (e.g. invalid_credentials, validation_failed with fields). */
  signIn: (email: string, password: string) => Promise<Me>;
  /** Throws ApiError (validation_failed, email_taken, underage...). */
  signUp: (body: RegisterRequest) => Promise<Me>;
  signOut: () => Promise<void>;
  /** Refetch /me. Resolves with the fresh user, or null if it failed / signed out. Never rejects. */
  refreshUser: () => Promise<Me | null>;
  /** Update the cached wallet balance (integer pence) from a response's balancePence. */
  setBalance: (balancePence: number) => void;
  /** Replace the cached user (e.g. with the Me returned by updateMe / updateLimits). */
  setUser: (user: Me) => void;
}

const TOKEN_KEY = 'ripvault.authToken';
/** Minimum gap between automatic /me refreshes on app foreground. */
const FOREGROUND_REFRESH_MS = 30_000;

const SessionContext = createContext<SessionValue | null>(null);

async function saveToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // Secure storage unavailable: the session still works until the app is closed.
  }
}

async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // ignore
  }
}

async function readToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children?: ReactNode }) {
  const toast = useToast();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUserState] = useState<Me | null>(null);
  const [restoreError, setRestoreError] = useState<ApiError | null>(null);
  const statusRef = useRef<SessionStatus>('loading');
  statusRef.current = status;
  const lastRefreshRef = useRef(0);
  /** Bumped on every sign in/out so late responses from an older session are ignored. */
  const epochRef = useRef(0);

  const applySignedIn = useCallback((token: string, me: Me) => {
    epochRef.current += 1;
    setAuthToken(token);
    markAuthRestored();
    setUserState(me);
    setRestoreError(null);
    setStatus('signedIn');
    lastRefreshRef.current = Date.now();
  }, []);

  const signOut = useCallback(async () => {
    epochRef.current += 1;
    setAuthToken(null);
    markAuthRestored();
    setUserState(null);
    setRestoreError(null);
    setStatus('signedOut');
    await clearToken();
  }, []);

  const restore = useCallback(async () => {
    const epoch = ++epochRef.current;
    setRestoreError(null);
    setStatus('loading');
    const token = await readToken();
    if (epoch !== epochRef.current) return;
    if (!token) {
      markAuthRestored();
      setStatus('signedOut');
      return;
    }
    setAuthToken(token);
    // Requests held back at launch now go out with the saved token.
    markAuthRestored();
    try {
      const me = await getMe();
      if (epoch !== epochRef.current) return;
      applySignedIn(token, me);
    } catch (e) {
      if (epoch !== epochRef.current) return;
      const err = toApiError(e);
      if (err.status === 401 || err.status === 404) {
        await signOut();
      } else {
        setRestoreError(err);
      }
    }
  }, [applySignedIn, signOut]);

  useEffect(() => {
    void restore();
  }, [restore]);

  // A 401 on the current token: sign out (with a toast if the player was signed in).
  useEffect(
    () =>
      onUnauthorized(() => {
        if (statusRef.current === 'signedIn') toast.info('Please sign in again.', 'Session expired');
        void signOut();
      }),
    [signOut, toast],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await login({ email: email.trim(), password });
      await saveToken(res.token);
      applySignedIn(res.token, res.user);
      return res.user;
    },
    [applySignedIn],
  );

  const signUp = useCallback(
    async (body: RegisterRequest) => {
      const res = await register({ ...body, email: body.email.trim(), displayName: body.displayName.trim() });
      await saveToken(res.token);
      applySignedIn(res.token, res.user);
      return res.user;
    },
    [applySignedIn],
  );

  const refreshUser = useCallback(async (): Promise<Me | null> => {
    if (statusRef.current !== 'signedIn') return null;
    const epoch = epochRef.current;
    try {
      const me = await getMe();
      if (epoch !== epochRef.current) return null;
      lastRefreshRef.current = Date.now();
      setUserState(me);
      return me;
    } catch {
      return null;
    }
  }, []);

  const setBalance = useCallback((balancePence: number) => {
    setUserState((current) => (current ? { ...current, balancePence } : current));
  }, []);

  const setUser = useCallback((next: Me) => {
    setUserState((current) => (current ? next : current));
  }, []);

  const retryRestore = useCallback(() => {
    void restore();
  }, [restore]);

  // Balance can change outside the app (Stripe Checkout in the browser): refresh on foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && Date.now() - lastRefreshRef.current > FOREGROUND_REFRESH_MS) void refreshUser();
    });
    return () => sub.remove();
  }, [refreshUser]);

  const value = useMemo<SessionValue>(
    () => ({ status, user, restoreError, retryRestore, signIn, signUp, signOut, refreshUser, setBalance, setUser }),
    [status, user, restoreError, retryRestore, signIn, signUp, signOut, refreshUser, setBalance, setUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
