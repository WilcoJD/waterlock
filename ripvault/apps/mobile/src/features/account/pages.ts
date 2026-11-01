/**
 * Cursor pagination state for newest-first lists (wallet ledger, opening history).
 * Pure: the React wrapper lives in useCursorPages.ts.
 *
 * The API pages backwards with `?before=<cursor>`; items never disappear from these lists, so a
 * refetched first page can be folded into what is already loaded without losing the user's place.
 */

export interface Page<T> {
  items: readonly T[];
  /** Cursor for the next (older) page; null when this page reaches the end. */
  nextCursor: string | null;
}

export interface PagesState<T> {
  /** Every loaded item, newest first, no duplicates. */
  items: T[];
  /** Cursor for the next older page; null when everything is loaded. */
  cursor: string | null;
  /** True once a first page has been received. */
  seeded: boolean;
}

export function emptyPages<T>(): PagesState<T> {
  return { items: [], cursor: null, seeded: false };
}

/**
 * Fold a freshly fetched FIRST page into the loaded list.
 * - Nothing loaded yet, or the fresh page already reaches the end: the page replaces the list.
 * - The fresh page overlaps what is loaded: fresh items go on top (replacing their old copies) and
 *   the older pages stay, so the list stays contiguous and the user keeps their scroll position.
 * - No overlap (a lot happened since): older pages could leave a gap, so start again from the page.
 */
export function mergeFirstPage<T>(prev: PagesState<T>, page: Page<T>, keyOf: (item: T) => string): PagesState<T> {
  const fresh = [...page.items];
  if (!prev.seeded || prev.items.length === 0 || page.nextCursor === null) {
    return { items: fresh, cursor: page.nextCursor, seeded: true };
  }
  const freshKeys = new Set(fresh.map(keyOf));
  const overlaps = prev.items.some((item) => freshKeys.has(keyOf(item)));
  if (!overlaps) return { items: fresh, cursor: page.nextCursor, seeded: true };
  return {
    items: [...fresh, ...prev.items.filter((item) => !freshKeys.has(keyOf(item)))],
    cursor: prev.cursor,
    seeded: true,
  };
}

/**
 * Append an older page that was requested with `requestedCursor`. Ignored when the list moved on in
 * the meantime (it was reset, or that page was already appended).
 */
export function appendPage<T>(
  prev: PagesState<T>,
  page: Page<T>,
  requestedCursor: string,
  keyOf: (item: T) => string,
): PagesState<T> {
  if (!prev.seeded || prev.cursor !== requestedCursor) return prev;
  const have = new Set(prev.items.map(keyOf));
  return {
    items: [...prev.items, ...page.items.filter((item) => !have.has(keyOf(item)))],
    cursor: page.nextCursor,
    seeded: true,
  };
}
