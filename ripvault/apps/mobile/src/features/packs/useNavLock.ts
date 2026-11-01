import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Guards navigation that must not happen twice (e.g. a double tap on "Rip" would push two rip
 * screens, and each would buy packs with its own Idempotency-Key). The first call runs; later calls
 * are ignored until the screen regains focus (or a short fallback timeout passes).
 *
 *   const navigateOnce = useNavLock();
 *   onPress={() => navigateOnce(() => router.push(href))}
 */
export function useNavLock(fallbackMs = 1_200): (action: () => void) => void {
  const lockedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      lockedRef.current = false;
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, []),
  );

  return useCallback(
    (action: () => void) => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        lockedRef.current = false;
      }, fallbackMs);
      action();
    },
    [fallbackMs],
  );
}
