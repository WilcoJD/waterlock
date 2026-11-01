/**
 * State machine for one visit to the rip screen.
 *
 *   opening -> tearing -> revealing -> summary        (success)
 *   opening -> error -> (retry) opening               (failure)
 *   summary -> (ripAgain) opening                     (new action, new Idempotency-Key)
 *
 * - POST /packs/:id/open is sent exactly once per action: the effect is guarded by a ref, so React
 *   StrictMode's double effects and re-renders never send it twice.
 * - Retries (network error, "Try again") reuse the SAME Idempotency-Key, so a rip that actually went
 *   through is replayed by the server instead of charging again. "Rip again" makes a new key.
 * - Selling uses one key per set of items; a retry of the same sale reuses it.
 * - Every money-moving response updates the session balance (setBalance) straight away.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { formatPence } from '@ripvault/shared';
import type { InventoryItem, OpenPackResponse, Pull } from '@ripvault/shared';
import { getInventoryItem, newIdempotencyKey, openPack, sellItems, toApiError } from '../../api/client.ts';
import type { ApiError } from '../../api/client.ts';
import { useSession } from '../../state/session.tsx';
import { useToast } from '../../components/index.ts';
import { plural } from '../../lib/format.ts';
import { idsSignature } from './packData.ts';
import type { PullRowState } from './packData.ts';

export type RipPhase =
  | { kind: 'opening' }
  | { kind: 'error'; error: ApiError }
  | { kind: 'tearing'; result: OpenPackResponse }
  | { kind: 'revealing'; result: OpenPackResponse }
  | { kind: 'summary'; result: OpenPackResponse };

/** Minimum time the pack "charges" before tearing, so the moment never feels skipped. */
const MIN_CHARGE_MS = 1_200;
/** Minimum time before showing an error, so the screen does not flicker. */
const MIN_ERROR_MS = 450;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function prefetchImages(pulls: readonly Pull[]): void {
  for (const pull of pulls) {
    const uri = pull.card.imageLarge || pull.card.imageSmall;
    if (!uri) continue;
    try {
      Promise.resolve(Image.prefetch(uri)).catch(() => undefined);
    } catch {
      // Prefetch is best effort.
    }
  }
}

function soldStateFor(item: InventoryItem | undefined, fallbackPence: number): PullRowState {
  return { status: 'sold', soldForPence: item?.soldForPence ?? fallbackPence };
}

export interface RipController {
  phase: RipPhase;
  /** Per inventory item id. */
  rows: Readonly<Record<string, PullRowState>>;
  /** A sale is in flight (sell buttons pause). */
  selling: boolean;
  /** Re-send the same rip (same Idempotency-Key). */
  retry: () => void;
  /** Start a brand-new rip of the same pack/quantity (new Idempotency-Key). */
  ripAgain: () => void;
  /** Tear animation finished. */
  finishTear: () => void;
  /** Reveal finished or skipped. */
  finishReveal: () => void;
  /** Sell these pulled items back (all-or-nothing). Resolves when done; never rejects. */
  sell: (pulls: readonly Pull[]) => Promise<void>;
  keep: (pull: Pull) => void;
}

export function useRip(packId: string, quantity: number): RipController {
  const { setBalance, refreshUser } = useSession();
  const toast = useToast();

  const [phase, setPhase] = useState<RipPhase>({ kind: 'opening' });
  const [rows, setRows] = useState<Record<string, PullRowState>>({});
  const [selling, setSelling] = useState(false);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  /** Idempotency-Key of the current rip action. */
  const ripKeyRef = useRef<string | null>(null);
  /** Bumped by ripAgain so a late response of an older action is ignored. */
  const attemptRef = useRef(0);
  const inFlightRef = useRef(false);
  const startedRef = useRef(false);
  const sellingRef = useRef(false);
  const sellKeysRef = useRef(new Map<string, string>());
  const resultRef = useRef<OpenPackResponse | null>(null);

  const run = useCallback(async () => {
    if (inFlightRef.current || !packId) return;
    inFlightRef.current = true;
    const attempt = attemptRef.current;
    if (!ripKeyRef.current) ripKeyRef.current = newIdempotencyKey();
    const key = ripKeyRef.current;
    setPhase({ kind: 'opening' });
    const startedAt = Date.now();
    try {
      const result = await openPack(packId, quantity, key);
      // Money moved: apply the new balance even if the player has already left the screen.
      setBalance(result.balancePence);
      void refreshUser(); // stats + spend-limit usage
      if (attempt !== attemptRef.current) return;
      prefetchImages(result.pulls);
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_CHARGE_MS) await wait(MIN_CHARGE_MS - elapsed);
      if (attempt !== attemptRef.current) return;
      resultRef.current = result;
      setRows(Object.fromEntries(result.pulls.map((p) => [p.inventoryItemId, { status: 'new' } satisfies PullRowState])));
      setPhase({ kind: 'tearing', result });
    } catch (e) {
      const error = toApiError(e);
      if (error.code === 'cooling_off' || error.code === 'spend_limit_reached' || error.code === 'insufficient_funds') {
        // Fresh limits / balance for the explanation.
        void refreshUser();
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_ERROR_MS) await wait(MIN_ERROR_MS - elapsed);
      if (attempt !== attemptRef.current) return;
      setPhase({ kind: 'error', error });
    } finally {
      inFlightRef.current = false;
    }
  }, [packId, quantity, setBalance, refreshUser]);

  // Send the rip once when the screen opens (StrictMode-safe).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
  }, [run]);

  const retry = useCallback(() => {
    void run();
  }, [run]);

  const ripAgain = useCallback(() => {
    if (inFlightRef.current || sellingRef.current) return;
    attemptRef.current += 1;
    ripKeyRef.current = newIdempotencyKey();
    sellKeysRef.current.clear();
    resultRef.current = null;
    setRows({});
    void run();
  }, [run]);

  const finishTear = useCallback(() => {
    setPhase((p) => (p.kind === 'tearing' ? { kind: 'revealing', result: p.result } : p));
  }, []);

  const finishReveal = useCallback(() => {
    setPhase((p) => (p.kind === 'tearing' || p.kind === 'revealing' ? { kind: 'summary', result: p.result } : p));
  }, []);

  const keep = useCallback((pull: Pull) => {
    setRows((prev) => {
      const current = prev[pull.inventoryItemId];
      if (current && current.status !== 'new') return prev;
      return { ...prev, [pull.inventoryItemId]: { status: 'kept' } };
    });
  }, []);

  /** After invalid_state: find out what actually happened to each item. */
  const syncRows = useCallback(
    async (pulls: readonly Pull[], previous: Record<string, PullRowState>) => {
      const results = await Promise.allSettled(pulls.map((p) => getInventoryItem(p.inventoryItemId)));
      setRows((prev) => {
        const next = { ...prev };
        pulls.forEach((pull, i) => {
          const r = results[i];
          const id = pull.inventoryItemId;
          if (!r || r.status !== 'fulfilled') {
            next[id] = previous[id] ?? { status: 'new' };
            return;
          }
          const item = r.value;
          if (item.status === 'sold') next[id] = soldStateFor(item, pull.buybackPence);
          else if (item.status === 'shipping' || item.status === 'shipped')
            next[id] = { status: 'gone', goneLabel: item.status === 'shipping' ? 'Shipping to you' : 'Shipped' };
          else next[id] = previous[id] ?? { status: 'new' };
        });
        return next;
      });
      void refreshUser();
    },
    [refreshUser],
  );

  const sell = useCallback(
    async (pulls: readonly Pull[]) => {
      const targets = pulls.filter((p) => {
        const status = rowsRef.current[p.inventoryItemId]?.status ?? 'new';
        return status === 'new' || status === 'kept';
      });
      if (targets.length === 0 || sellingRef.current) return;
      sellingRef.current = true;
      setSelling(true);

      const ids = targets.map((p) => p.inventoryItemId);
      const signature = idsSignature(ids);
      let key = sellKeysRef.current.get(signature);
      if (!key) {
        key = newIdempotencyKey();
        sellKeysRef.current.set(signature, key);
      }
      const previous: Record<string, PullRowState> = {};
      for (const id of ids) previous[id] = rowsRef.current[id] ?? { status: 'new' };
      setRows((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { status: 'selling' };
        return next;
      });

      try {
        const res = await sellItems(ids, key);
        sellKeysRef.current.delete(signature);
        setBalance(res.balancePence);
        const soldById = new Map(res.items.map((item) => [item.id, item]));
        setRows((prev) => {
          const next = { ...prev };
          for (const p of targets) next[p.inventoryItemId] = soldStateFor(soldById.get(p.inventoryItemId), p.buybackPence);
          return next;
        });
        const first = targets[0];
        toast.success(
          `${formatPence(res.creditedPence)} added to your balance.`,
          targets.length === 1 && first ? `Sold ${first.card.name}` : `Sold ${plural(res.soldCount || targets.length, 'card')}`,
        );
      } catch (e) {
        const err = toApiError(e);
        setRows((prev) => ({ ...prev, ...previous }));
        if (err.code === 'invalid_state' || err.code === 'not_found') {
          sellKeysRef.current.delete(signature);
          toast.error(
            targets.length === 1
              ? "This card can't be sold any more. It may already be sold or on its way to you."
              : "Some of these cards can't be sold any more, so nothing was sold. Check each card and try again.",
            'Not sold',
          );
          await syncRows(targets, previous);
        } else {
          toast.error(err, "Couldn't sell");
        }
      } finally {
        sellingRef.current = false;
        setSelling(false);
      }
    },
    [setBalance, toast, syncRows],
  );

  return { phase, rows, selling, retry, ripAgain, finishTear, finishReveal, sell, keep };
}
