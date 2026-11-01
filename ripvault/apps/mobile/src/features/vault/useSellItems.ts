/**
 * Sell-back flow shared by the Vault tab (multi-select) and the item detail screen:
 * confirm alert -> POST /inventory/sell (with an idempotency key per action) -> new balance,
 * success haptic + toast -> onSold callback. Errors get friendly copy (see actions.ts).
 */
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { formatPence } from '@ripvault/shared';
import type { InventoryItem, SellResponse } from '@ripvault/shared';
import { sellItems } from '../../api/client.ts';
import { useSession } from '../../state/session.tsx';
import { useAppConfig } from '../../state/config.tsx';
import { useToast } from '../../components/index.ts';
import { haptic } from '../../lib/haptics.ts';
import { plural } from '../../lib/format.ts';
import { idsSignature, presentActionError, useActionKey } from './actions.ts';
import { formatBps, sumPence } from './format.ts';

/** POST /inventory/sell accepts 1-100 ids (docs/API.md). */
export const MAX_SELL_ITEMS = 100;

export interface UseSellItemsOptions {
  /** After a successful sale (balance and toast already handled). */
  onSold?: (res: SellResponse) => void;
  /** The vault changed under us (invalid_state etc.): refetch. */
  onStale?: () => void;
}

export interface SellItemsApi {
  /** Ask for confirmation, then sell the vaulted items among `items`. */
  confirmSell: (items: readonly InventoryItem[]) => void;
  selling: boolean;
}

export function useSellItems({ onSold, onStale }: UseSellItemsOptions = {}): SellItemsApi {
  const { setBalance, refreshUser } = useSession();
  const { config } = useAppConfig();
  const toast = useToast();
  const actionKey = useActionKey();
  const [selling, setSelling] = useState(false);
  const busyRef = useRef(false);

  const callbacksRef = useRef({ onSold, onStale });
  callbacksRef.current = { onSold, onStale };

  const run = useCallback(
    async (items: InventoryItem[]) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setSelling(true);
      // Sorted so a retry sends a byte-identical body (the idempotency key is bound to the body).
      const ids = items.map((i) => i.id).sort();
      const key = actionKey.keyFor(idsSignature('sell', ids));
      try {
        const res = await sellItems(ids, key);
        actionKey.reset();
        setBalance(res.balancePence);
        // Stats (cards in vault, vault value) changed too; refresh quietly in the background.
        void refreshUser();
        const what = res.soldCount === 1 && items.length === 1 ? items[0]!.card.name : plural(res.soldCount, 'card');
        toast.success(`Sold ${what} for ${formatPence(res.creditedPence)}`);
        callbacksRef.current.onSold?.(res);
      } catch (e) {
        presentActionError(e, 'sell', { toast, onStale: () => callbacksRef.current.onStale?.() });
      } finally {
        busyRef.current = false;
        setSelling(false);
      }
    },
    [actionKey, refreshUser, setBalance, toast],
  );

  const confirmSell = useCallback(
    (all: readonly InventoryItem[]) => {
      if (busyRef.current) return;
      const items = all.filter((i) => i.status === 'vaulted');
      if (items.length === 0) {
        toast.info('Only cards in your vault can be sold back.');
        return;
      }
      if (items.length > MAX_SELL_ITEMS) {
        toast.error(`You can sell up to ${MAX_SELL_ITEMS} cards at a time. Select fewer cards.`);
        return;
      }
      const total = sumPence(items, (i) => i.buybackPence);
      const what = items.length === 1 ? items[0]!.card.name : plural(items.length, 'card');
      haptic.warning();
      Alert.alert(
        `Sell ${what}?`,
        `${formatPence(total)} will be added to your balance instantly (${formatBps(config.buybackBps)} of current market value). ` +
          "This can't be undone.",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: `Sell for ${formatPence(total)}`, onPress: () => void run(items) },
        ],
      );
    },
    [config.buybackBps, run, toast],
  );

  return { confirmSell, selling };
}
