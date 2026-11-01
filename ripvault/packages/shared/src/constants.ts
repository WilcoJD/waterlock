import type { InventoryStatus, ShipmentStatus, TransactionType, WithdrawalStatus } from './types.ts';

/** Default sell-back rate: 90% of current market value. Override with BUYBACK_BPS on the API. */
export const DEFAULT_BUYBACK_BPS = 9_000;
/** Packs per purchase (each pack holds one card). */
export const MAX_OPEN_QUANTITY = 10;
export const MINIMUM_AGE = 18;
export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 32;
/** Raising or removing a spend limit only takes effect after this long. */
export const LIMIT_INCREASE_DELAY_MS = 24 * 60 * 60 * 1000;

export const INVENTORY_STATUSES: readonly InventoryStatus[] = ['vaulted', 'shipping', 'shipped', 'sold'];
export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = ['requested', 'processing', 'shipped', 'delivered', 'cancelled'];
export const WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ['pending', 'paid', 'rejected'];
export const TRANSACTION_TYPES: readonly TransactionType[] = [
  'topup',
  'pack_purchase',
  'buyback',
  'shipping_fee',
  'shipping_refund',
  'withdrawal',
  'withdrawal_reversal',
  'adjustment',
];

/** Allowed admin transitions for a shipment. Players may only cancel while "requested". */
export const SHIPMENT_TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  requested: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function canTransitionShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}

/** Shipping fee for a shipment whose cards are worth `totalValuePence`. */
export function shippingFeePence(
  totalValuePence: number,
  shipping: { flatFeePence: number; freeOverPence: number | null },
): number {
  if (shipping.freeOverPence !== null && totalValuePence >= shipping.freeOverPence) return 0;
  return shipping.flatFeePence;
}
