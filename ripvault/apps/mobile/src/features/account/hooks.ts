/**
 * Hooks shared by the account screens.
 *   useActionKey()   one Idempotency-Key per money-moving user action (reused on retry)
 *   useUserRefresh() refresh /me on focus + pull-to-refresh state
 *   useOpenLink()    open an external page in the in-app browser
 *   useCopy()        copy text with a toast
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { newIdempotencyKey } from '../../api/client.ts';
import { useSession } from '../../state/session.tsx';
import { useToast } from '../../components/index.ts';
import { colors } from '../../theme.ts';

export interface ActionKey {
  /**
   * The key for the action described by `signature` (e.g. "topup:2500"). Repeated calls with the
   * same signature return the same key until reset(), so a retry after a timeout is replayed by the
   * API instead of charging twice. A different signature (the player changed the amount) gets a
   * new key, because the API rejects a key reused with a different body.
   */
  keyFor: (signature: string) => string;
  /** Call after the action succeeded: the next action gets a fresh key. */
  reset: () => void;
}

export function useActionKey(): ActionKey {
  const ref = useRef<{ signature: string; key: string } | null>(null);
  return useMemo<ActionKey>(
    () => ({
      keyFor: (signature) => {
        if (!ref.current || ref.current.signature !== signature) {
          ref.current = { signature, key: newIdempotencyKey() };
        }
        return ref.current.key;
      },
      reset: () => {
        ref.current = null;
      },
    }),
    [],
  );
}

/** True until the component unmounts (for state updates after awaits). */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * Keeps the signed-in user fresh on screens that show stats/limits: refetches /me whenever the screen
 * gains focus and drives pull-to-refresh.
 */
export function useUserRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const { refreshUser } = useSession();
  const toast = useToast();
  const mounted = useMountedRef();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshUser();
    }, [refreshUser]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refreshUser().then((me) => {
      if (!mounted.current) return;
      setRefreshing(false);
      if (!me) toast.error("Couldn't refresh. Check your connection and try again.");
    });
  }, [mounted, refreshUser, toast]);

  return { refreshing, onRefresh };
}

/** Opens a URL in the in-app browser, themed to match the app. */
export function useOpenLink(): (url: string) => void {
  const toast = useToast();
  return useCallback(
    (url: string) => {
      WebBrowser.openBrowserAsync(url, {
        toolbarColor: colors.bg,
        controlsColor: colors.gold,
        dismissButtonStyle: 'close',
      }).catch(() => toast.error("Couldn't open that page. Please try again."));
    },
    [toast],
  );
}

/** Copies text to the clipboard and confirms with a toast. */
export function useCopy(): (value: string, what: string) => void {
  const toast = useToast();
  return useCallback(
    (value: string, what: string) => {
      Clipboard.setStringAsync(value)
        .then(() => toast.info(`${what} copied to the clipboard`))
        .catch(() => toast.error(`Couldn't copy the ${what.toLowerCase()}`));
    },
    [toast],
  );
}

/** The current time, re-rendering every `intervalMs` (for countdowns like "3h 12m left"). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
