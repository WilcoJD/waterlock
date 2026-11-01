/**
 * Shared plumbing for money-moving actions on the vault and shipping screens:
 *   - useActionKey(): one Idempotency-Key per user action, reused when that same action is retried
 *   - describeActionError() / presentActionError(): friendly copy for every ApiError code we can hit,
 *     with a "Top up" shortcut for insufficient_funds.
 */
import { useCallback, useMemo, useRef } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { newIdempotencyKey, toApiError } from '../../api/client.ts';
import type { ApiError } from '../../api/client.ts';
import { haptic } from '../../lib/haptics.ts';
import type { ToastApi } from '../../components/index.ts';

export interface ActionKey {
  /**
   * The Idempotency-Key for an action described by `signature` (e.g. "sell:id1,id2"). The same
   * signature returns the same key until reset(), so retrying after a timeout cannot double-charge;
   * a different signature (a new action, or a different body) gets a fresh key.
   */
  keyFor: (signature: string) => string;
  /** Forget the key (call after the action succeeded). */
  reset: () => void;
}

export function useActionKey(): ActionKey {
  const ref = useRef<{ signature: string; key: string } | null>(null);
  const keyFor = useCallback((signature: string) => {
    const current = ref.current;
    if (current && current.signature === signature) return current.key;
    const key = newIdempotencyKey();
    ref.current = { signature, key };
    return key;
  }, []);
  const reset = useCallback(() => {
    ref.current = null;
  }, []);
  return useMemo(() => ({ keyFor, reset }), [keyFor, reset]);
}

/** Stable signature for a set of ids (order-insensitive). */
export function idsSignature(prefix: string, ids: readonly string[]): string {
  return `${prefix}:${[...ids].sort().join(',')}`;
}

export type VaultAction = 'sell' | 'ship' | 'cancel' | 'quote' | 'address' | 'deleteAddress';

export interface ActionErrorCopy {
  error: ApiError;
  title: string;
  message: string;
  /** Offer a "Top up" button. */
  topUp: boolean;
  /** The data on screen is out of date (cards moved, address deleted): refetch it. */
  stale: boolean;
}

const MONEY_ACTIONS: readonly VaultAction[] = ['sell', 'ship'];

export function describeActionError(e: unknown, action: VaultAction): ActionErrorCopy {
  const error = toApiError(e);
  const base = { error, topUp: false, stale: false };
  switch (error.code) {
    case 'insufficient_funds':
      return {
        ...base,
        title: 'Not enough balance',
        message:
          action === 'ship'
            ? "Your balance doesn't cover the shipping fee. Top up and try again."
            : 'Top up your balance and try again.',
        topUp: true,
      };
    case 'invalid_state':
      if (action === 'sell') {
        return {
          ...base,
          title: 'Vault has changed',
          message: 'Some of these cards are no longer in your vault (already sold or shipping). Nothing was sold. We have refreshed your vault.',
          stale: true,
        };
      }
      if (action === 'ship' || action === 'quote') {
        return {
          ...base,
          title: 'Vault has changed',
          message: 'Some of these cards are no longer in your vault, so they cannot be shipped. We have refreshed your selection.',
          stale: true,
        };
      }
      if (action === 'cancel') {
        return {
          ...base,
          title: "Can't cancel",
          message: error.message || 'This shipment is already being processed and can no longer be cancelled.',
          stale: true,
        };
      }
      return { ...base, title: "Can't do that", message: error.message };
    case 'not_found':
      if (action === 'ship') {
        return {
          ...base,
          title: 'Address not found',
          message: 'That address no longer exists. Please choose another one.',
          stale: true,
        };
      }
      if (action === 'deleteAddress') {
        return { ...base, title: 'Already deleted', message: 'That address was already removed.', stale: true };
      }
      return { ...base, title: 'Not found', message: error.message || "We couldn't find that.", stale: true };
    case 'cooling_off':
      return {
        ...base,
        title: "You're taking a break",
        message: error.message || "This isn't available until your cool-off period ends.",
      };
    case 'spend_limit_reached':
      return { ...base, title: 'Daily limit reached', message: error.message };
    case 'sold_out':
      return { ...base, title: 'Sold out', message: error.message };
    case 'validation_failed': {
      const first = Object.values(error.fields)[0];
      return { ...base, title: 'Check the details', message: first ?? error.message };
    }
    case 'rate_limited':
      return { ...base, title: 'Slow down', message: error.message };
    case 'conflict':
      return { ...base, title: 'Please try again', message: error.message, stale: true };
    case 'network':
    case 'timeout':
      return {
        ...base,
        title: "Can't connect",
        message: MONEY_ACTIONS.includes(action)
          ? "We couldn't confirm this went through. Check your connection and try again: you will never be charged twice."
          : error.message,
      };
    default:
      return { ...base, title: 'Something went wrong', message: error.message };
  }
}

export interface PresentOptions {
  toast: ToastApi;
  /** Called when the error means the on-screen data is stale. */
  onStale?: () => void;
}

/**
 * Show an action error: an alert with a "Top up" button for insufficient_funds (and other blocking
 * money problems), a toast otherwise. Calls onStale when the screen should refetch.
 */
export function presentActionError(e: unknown, action: VaultAction, { toast, onStale }: PresentOptions): ActionErrorCopy {
  const copy = describeActionError(e, action);
  if (copy.stale) onStale?.();
  if (copy.error.code === 'aborted') return copy;
  if (copy.topUp) {
    haptic.error();
    Alert.alert(copy.title, copy.message, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Top up', onPress: () => router.push('/topup') },
    ]);
  } else {
    toast.error(copy.message, copy.title);
  }
  return copy;
}
