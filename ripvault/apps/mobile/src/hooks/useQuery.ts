/**
 * Tiny data-fetching hook for screens.
 *
 *   const packs = useQuery(() => listPacks(), []);
 *   const pack = useQuery(() => getPack(id!), [id], { enabled: !!id, refetchOnFocus: true });
 *
 *   if (packs.loading) return <LoadingState />;
 *   if (packs.error && !packs.data) return <ErrorState error={packs.error} onRetry={packs.refetch} />;
 *   <FlatList refreshControl={themedRefreshControl(packs.refreshing, packs.refresh)} ... />
 *
 * - Fetches on mount and whenever `deps` change (like useEffect deps).
 * - `loading` is true only while there is no data yet. `refreshing` is true during refresh() (use it
 *   for pull-to-refresh). A failed refetch keeps the previous `data` and sets `error`; show an inline
 *   error only when `!data`, otherwise a toast is enough.
 * - Screens only: it uses expo-router's useFocusEffect, so it must render inside a navigator screen.
 * - Stale responses (older request, or after unmount) are ignored, so fast param changes are safe.
 * - `refetchOnFocus` silently refetches when the screen regains focus (not on first mount).
 * - `setData` lets screens apply optimistic/known updates (e.g. after selling items).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList, Dispatch, SetStateAction } from 'react';
import { useFocusEffect } from 'expo-router';
import { toApiError } from '../api/client.ts';
import type { ApiError } from '../api/client.ts';

export interface UseQueryOptions {
  /** When false the fetch is skipped (e.g. waiting for a route param). Default true. */
  enabled?: boolean;
  /** Silently refetch when the screen comes back into focus. Default false. */
  refetchOnFocus?: boolean;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: ApiError | null;
  /** First load: no data yet and a request is in flight. */
  loading: boolean;
  /** A refresh() (pull-to-refresh) is in flight. */
  refreshing: boolean;
  /** Any request is in flight (including silent ones). When deps change, the previous data stays
   *  visible until the new response arrives; use this for a subtle "updating" indicator. */
  fetching: boolean;
  /** Refetch (e.g. ErrorState retry). Shows `loading` if there is no data yet, otherwise silent. Never rejects. */
  refetch: () => Promise<void>;
  /** Refetch with the pull-to-refresh indicator (`refreshing`). Never rejects. */
  refresh: () => Promise<void>;
  setData: Dispatch<SetStateAction<T | undefined>>;
}

export function useQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  options: UseQueryOptions = {},
): QueryResult<T> {
  const { enabled = true, refetchOnFocus = false } = options;

  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [inFlight, setInFlight] = useState<boolean>(enabled);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const run = useCallback(async (mode: 'normal' | 'refresh' | 'silent'): Promise<void> => {
    if (!enabledRef.current) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    if (mode === 'refresh') setRefreshing(true);
    setInFlight(true);
    try {
      const result = await fetcherRef.current(controller.signal);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setData(() => result);
      setError(null);
    } catch (e) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const err = toApiError(e);
      if (err.code === 'aborted') return;
      setError(err);
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setInFlight(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Fetch on mount and whenever deps/enabled change.
  useEffect(() => {
    if (!enabled) {
      setInFlight(false);
      return;
    }
    void run('normal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  // Silent refetch on re-focus (skip the first focus, the mount fetch covers it).
  const focusCountRef = useRef(0);
  const refetchOnFocusRef = useRef(refetchOnFocus);
  refetchOnFocusRef.current = refetchOnFocus;
  useFocusEffect(
    useCallback(() => {
      focusCountRef.current += 1;
      if (focusCountRef.current > 1 && refetchOnFocusRef.current) void run('silent');
    }, [run]),
  );

  const refetch = useCallback(() => run('normal'), [run]);
  const refresh = useCallback(() => run('refresh'), [run]);

  return {
    data,
    error,
    loading: inFlight && data === undefined,
    refreshing,
    fetching: inFlight || refreshing,
    refetch,
    refresh,
    setData,
  };
}
