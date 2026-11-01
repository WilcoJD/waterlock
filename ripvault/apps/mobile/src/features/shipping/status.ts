import type { ShipmentStatus } from '@ripvault/shared';
import { colors } from '../../theme.ts';
import type { IconName } from '../../components/index.ts';

export interface ShipmentStatusMeta {
  label: string;
  /** #RRGGBB accent for chips and the timeline. */
  color: string;
  icon: IconName;
  /** One-line explanation for the timeline / detail header. */
  description: string;
}

export const SHIPMENT_STATUS_META: Readonly<Record<ShipmentStatus, ShipmentStatusMeta>> = {
  requested: {
    label: 'Requested',
    color: colors.gold,
    icon: 'time-outline',
    description: 'We have your request. You can still cancel for a full refund of the fee.',
  },
  processing: {
    label: 'Processing',
    color: colors.info,
    icon: 'construct-outline',
    description: 'Your cards are being sleeved, packed and insured.',
  },
  shipped: {
    label: 'Shipped',
    color: colors.violet,
    icon: 'airplane-outline',
    description: 'Your parcel is on its way.',
  },
  delivered: {
    label: 'Delivered',
    color: colors.success,
    icon: 'checkmark-circle',
    description: 'Delivered. Enjoy your cards!',
  },
  cancelled: {
    label: 'Cancelled',
    color: colors.textMuted,
    icon: 'close-circle',
    description: 'Cancelled. The cards went back to your vault and any fee was refunded.',
  },
};

/** Normal progression shown on the timeline. */
export const SHIPMENT_FLOW: readonly ShipmentStatus[] = ['requested', 'processing', 'shipped', 'delivered'];

/** Players may cancel only while the shipment is "requested" (see SHIPMENT_TRANSITIONS). */
export function canPlayerCancel(status: ShipmentStatus): boolean {
  return status === 'requested';
}

/** "#7F3K2Q" style short reference from a shipment id. */
export function shipmentRef(id: string): string {
  const tail = id.replace(/^[a-z]+_/i, '').slice(-6).toUpperCase();
  return `#${tail || id.toUpperCase()}`;
}
