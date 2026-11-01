import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPence } from '@ripvault/shared';
import type { CardSummary, Shipment } from '@ripvault/shared';
import { CARD_ASPECT, colors, spacing } from '../../theme.ts';
import { AppText, CardArt, CARD_WIDTHS, MoneyText, Panel, Pill } from '../../components/index.ts';
import { formatDate, plural } from '../../lib/format.ts';
import { SHIPMENT_STATUS_META, shipmentRef } from './status.ts';

/** Up to three cards fanned out (shipment thumbnails). */
export function CardFan({ cards, width = CARD_WIDTHS.xs }: { cards: readonly CardSummary[]; width?: number }) {
  const shown = cards.slice(0, 3);
  const height = Math.round(width * CARD_ASPECT);
  const step = Math.round(width * 0.36);
  const totalWidth = width + step * Math.max(0, shown.length - 1);
  const angles = shown.length === 1 ? [0] : shown.length === 2 ? [-5, 5] : [-8, 0, 8];
  if (shown.length === 0) {
    return (
      <View style={[styles.fanEmpty, { width, height }]}>
        <Ionicons name="cube-outline" size={20} color={colors.textFaint} />
      </View>
    );
  }
  return (
    <View style={{ width: totalWidth, height: height + 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {shown.map((card, i) => (
        <View
          key={`${card.id}-${i}`}
          style={[styles.fanCard, { left: i * step, transform: [{ rotate: `${angles[i] ?? 0}deg` }], zIndex: i }]}
        >
          <CardArt card={card} width={width} glow={false} />
        </View>
      ))}
    </View>
  );
}

export interface ShipmentCardProps {
  shipment: Shipment;
  onPress: (shipment: Shipment) => void;
}

/** Shipment list row: card fan, item count + date, status chip, value and fee. */
export const ShipmentCard = memo(function ShipmentCard({ shipment, onPress }: ShipmentCardProps) {
  const meta = SHIPMENT_STATUS_META[shipment.status];
  const fee = shipment.feePence === 0 ? 'Free shipping' : `Fee ${formatPence(shipment.feePence)}`;
  return (
    <Panel
      onPress={() => onPress(shipment)}
      accessibilityLabel={`Shipment ${shipmentRef(shipment.id)}, ${meta.label}, ${plural(shipment.itemCount, 'card')} worth ${formatPence(
        shipment.totalValuePence,
      )}, requested ${formatDate(shipment.createdAt)}`}
      style={styles.card}
    >
      <View style={styles.row}>
        <CardFan cards={shipment.items.map((i) => i.card)} />
        <View style={styles.middle}>
          <Pill label={meta.label} color={meta.color} icon={meta.icon} />
          <AppText variant="body" weight="700" numberOfLines={1} style={styles.title}>
            {plural(shipment.itemCount, 'card')}
          </AppText>
          <AppText variant="caption" tone="faint" numberOfLines={1}>
            {shipmentRef(shipment.id)} · {formatDate(shipment.createdAt)}
          </AppText>
        </View>
        <View style={styles.right}>
          <MoneyText pence={shipment.totalValuePence} size={16} />
          <AppText variant="caption" size={11} tone={shipment.feePence === 0 ? 'success' : 'faint'} numberOfLines={1}>
            {fee}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} style={styles.chevron} />
      </View>
    </Panel>
  );
});

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  middle: { flex: 1, minWidth: 0, marginLeft: spacing.lg },
  title: { marginTop: spacing.sm },
  right: { alignItems: 'flex-end', marginLeft: spacing.sm },
  chevron: { marginLeft: spacing.xs },
  fanCard: { position: 'absolute', top: 3 },
  fanEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
});
