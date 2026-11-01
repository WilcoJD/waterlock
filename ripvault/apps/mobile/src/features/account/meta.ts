/**
 * Icon / colour / label for ledger transaction types and withdrawal statuses.
 * Only theme tokens (no stray hex). Pure: safe to import from Node tests.
 */
import type { TransactionType, WithdrawalStatus } from '@ripvault/shared';
import { colors, tierColors } from '../../theme.ts';
import type { IconName } from '../../components/icons.ts';

export interface Meta {
  label: string;
  icon: IconName;
  /** #RRGGBB accent. */
  color: string;
}

export const TRANSACTION_META: Readonly<Record<TransactionType, Meta>> = {
  topup: { label: 'Top-up', icon: 'add-circle', color: colors.success },
  pack_purchase: { label: 'Pack rip', icon: 'layers', color: colors.violet },
  buyback: { label: 'Sell-back', icon: 'swap-horizontal', color: colors.gold },
  shipping_fee: { label: 'Shipping', icon: 'cube', color: colors.info },
  shipping_refund: { label: 'Shipping refund', icon: 'return-down-back', color: colors.info },
  withdrawal: { label: 'Cash out', icon: 'arrow-up-circle', color: tierColors.epic },
  withdrawal_reversal: { label: 'Cash out returned', icon: 'refresh-circle', color: tierColors.epic },
  adjustment: { label: 'Adjustment', icon: 'construct', color: colors.textMuted },
};

/** Fallback for a type added on the server after this build. */
const UNKNOWN_TRANSACTION: Meta = { label: 'Transaction', icon: 'receipt-outline', color: colors.textMuted };

export function transactionMeta(type: string): Meta {
  return (TRANSACTION_META as Record<string, Meta>)[type] ?? UNKNOWN_TRANSACTION;
}

export const WITHDRAWAL_META: Readonly<Record<WithdrawalStatus, Meta & { explanation: string }>> = {
  pending: {
    label: 'Pending',
    icon: 'time-outline',
    color: colors.gold,
    explanation: "We're processing this payout.",
  },
  paid: {
    label: 'Paid',
    icon: 'checkmark-circle',
    color: colors.success,
    explanation: 'Sent to your payout account.',
  },
  rejected: {
    label: 'Returned',
    icon: 'arrow-undo-circle',
    color: colors.danger,
    explanation: "We couldn't pay this out, so the money went back to your balance.",
  },
};

export function withdrawalMeta(status: string): Meta & { explanation: string } {
  return (
    (WITHDRAWAL_META as Record<string, Meta & { explanation: string }>)[status] ?? {
      label: status,
      icon: 'help-circle-outline',
      color: colors.textMuted,
      explanation: '',
    }
  );
}
