/**
 * Infinite scroll over a newest-first, cursor-paged endpoint (GET /wallet, GET /openings).
 *
 *   const list = useCursorPages(
 *     (before) => getWallet(before, 30),
 *     (res) => ({ items: res.transactions, nextCursor: res.nextCursor }),
 *     (t) => t.id,
 *     { refetchOnFocus: true },
 *   );
 *   <FlatList data={list.items} onEndReached={list.loadMore}
 *             refreshControl={themedRefreshControl(list.refreshing, list.refresh)} />
 *
 * The first page goes through useQuery (loading/error/focus refetch). Refetched first pages are
 * merged into the loaded pages (see pages.ts), so pull-to-refresh and focus refetches keep the
 * player's place. `fetchPage`, `toPage` and `keyOf` may be inline functions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toApiError } from '../../api/client.ts';
import type { ApiError } from '../../api/client.ts';
import { useQuery } from '../../hooks/useQuery.ts';
import { appendPage, emptyPages, mergeFirstPage } from './pages.ts';
import type { Page, PagesState } from './pages.ts';
import { useMountedRef } from './hooks.ts';

export interface CursorPagesOptions {
  /** Silently refetch the first page when the screen regains focus. */
  refetchOnFocus?: boolean;
}

export interface CursorPages<R, T> {
  /** Every loaded item, newest first. */
  items: T[];
  /** The latest first-page response (e.g. WalletResponse.balancePence). */
  firstPage: R | undefined;
  /** First load in progress and nothing to show yet. */
  loading: boolean;
  /** Error of the latest first-page fetch (items may still be showing older data). */
  error: ApiError | null;
  refreshing: boolean;
  /** Pull-to-refresh. Never rejects. */
  refresh: () => Promise<void>;
  /** Retry the first page (ErrorState). Never rejects. */
  refetch: () => Promise<void>;
  /** More (older) items can be loaded. */
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: ApiError | null;
  /** Load the next older page; no-op while loading, at the end, or after a failure (use retryMore). */
  loadMore: () => void;
  /** Retry a failed loadMore. */
  retryMore: () => void;
}

type Stored<R, T> = PagesState<T> & { source: R | undefined };

export function useCursorPages<R, T>(
  fetchPage: (before: string | null) => Promise<R>,
  toPage: (response: R) => Page<T>,
  keyOf: (item: T) => string,
  options: CursorPagesOptions = {},
): CursorPages<R, T> {
  const fns = useRef({ fetchPage, toPage, keyOf });
  fns.current = { fetchPage, toPage, keyOf };
  const mounted = useMountedRef();

  const first = useQuery(() => fns.current.fetchPage(null), [], { refetchOnFocus: options.refetchOnFocus });

  const [stored, setStored] = useState<Stored<R, T>>(() => ({ ...emptyPages<T>(), source: undefined }));

  // Fold a fresh first page in during render (no empty flash), then commit it to state.
  const state = useMemo<Stored<R, T>>(() => {
    if (first.data === undefined || first.data === stored.source) return stored;
    return { ...mergeFirstPage(stored, fns.current.toPage(first.data), fns.current.keyOf), source: first.data };
  }, [first.data, stored]);
  useEffect(() => {
    if (state !== stored) setStored(state);
  }, [state, stored]);

  const stateRef = useRef(state);
  stateRef.current = state;

  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<ApiError | null>(null);
  const busyRef = useRef(false);
  const failedRef = useRef(false);

  const fetchMore = useCallback(() => {
    const current = stateRef.current;
    if (busyRef.current || !current.seeded || current.cursor === null) return;
    const cursor = current.cursor;
    busyRef.current = true;
    failedRef.current = false;
    setLoadingMore(true);
    setLoadMoreError(null);
    fns.current
      .fetchPage(cursor)
      .then(
        (res) => {
          if (!mounted.current) return;
          const page = fns.current.toPage(res);
          setStored((prev) => ({ ...appendPage(prev, page, cursor, fns.current.keyOf), source: prev.source }));
        },
        (e: unknown) => {
          if (!mounted.current) return;
          failedRef.current = true;
          setLoadMoreError(toApiError(e));
        },
      )
      .finally(() => {
        busyRef.current = false;
        if (mounted.current) setLoadingMore(false);
      });
  }, [mounted]);

  const loadMore = useCallback(() => {
    // FlatList fires onEndReached repeatedly; after a failure wait for an explicit retry.
    if (failedRef.current) return;
    fetchMore();
  }, [fetchMore]);

  const firstRefresh = first.refresh;
  const refresh = useCallback(async () => {
    failedRef.current = false;
    setLoadMoreError(null);
    await firstRefresh();
  }, [firstRefresh]);

  return {
    items: state.items,
    firstPage: first.data,
    loading: !state.seeded && first.loading,
    error: first.error,
    refreshing: first.refreshing,
    refresh,
    refetch: first.refetch,
    hasMore: state.seeded && state.cursor !== null,
    loadingMore,
    loadMoreError,
    loadMore,
    retryMore: fetchMore,
  };
}
