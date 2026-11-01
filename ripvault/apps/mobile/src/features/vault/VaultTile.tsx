import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatPence } from '@ripvault/shared';
import type { InventoryItem } from '@ripvault/shared';
import { CARD_ASPECT, colors, spacing, tierLabels } from '../../theme.ts';
import { AppText, CardArt, MoneyText, PressableScale, Skeleton } from '../../components/index.ts';
import { haptic } from '../../lib/haptics.ts';
import { ITEM_STATUS_META } from './format.ts';
import { ItemStatusPill, ValueChangeText } from './components.tsx';

export interface VaultTileProps {
  item: InventoryItem;
  width: number;
  /** Multi-select mode is on: a tap toggles selection instead of opening the card. */
  selecting: boolean;
  selected: boolean;
  onPress: (item: InventoryItem) => void;
  /** Long-press (enters multi-select on vaulted cards). */
  onLongPress?: (item: InventoryItem) => void;
}

/** One card in the vault grid: art, name, value (or sold price) and status for non-vaulted cards. */
export const VaultTile = memo(function VaultTile({ item, width, selecting, selected, onPress, onLongPress }: VaultTileProps) {
  const { card } = item;
  const sold = item.status === 'sold';
  const vaulted = item.status === 'vaulted';
  const priceText = sold ? `sold for ${formatPence(item.soldForPence ?? 0)}` : `worth ${formatPence(item.currentValuePence)}`;
  const statusText = vaulted ? '' : `, ${ITEM_STATUS_META[item.status].label}`;
  const label = `${card.name}, ${tierLabels[card.tier]}, ${priceText}${statusText}`;

  return (
    <PressableScale
      onPress={() => onPress(item)}
      onLongPress={
        onLongPress
          ? () => {
              haptic.medium();
              onLongPress(item);
            }
          : undefined
      }
      haptic={selecting ? 'selection' : 'tap'}
      scaleTo={0.96}
      accessibilityLabel={label}
      accessibilityHint={selecting ? (selected ? 'Double tap to deselect' : 'Double tap to select') : 'Opens card details'}
      accessibilityState={selecting ? { selected } : undefined}
      style={[styles.tile, { width }]}
    >
      <View>
        <CardArt card={card} width={width} selected={selected} dimmed={selecting && !vaulted} />
        {!vaulted ? <ItemStatusPill status={item.status} style={styles.statusPill} /> : null}
      </View>
      <View style={styles.meta}>
        <AppText variant="caption" weight="700" tone="default" numberOfLines={1}>
          {card.name}
        </AppText>
        <AppText variant="caption" size={11} tone="faint" numberOfLines={1}>
          {card.setName}
        </AppText>
        <View style={styles.valueRow}>
          {sold ? (
            <>
              <AppText variant="label" size={9} tone="gold" style={styles.soldLabel}>
                Sold
              </AppText>
              <MoneyText pence={item.soldForPence ?? 0} size={15} color={colors.gold} />
            </>
          ) : (
            <>
              <MoneyText pence={item.currentValuePence} size={15} style={styles.value} />
              <ValueChangeText currentPence={item.currentValuePence} atPullPence={item.valueAtPullPence} mode="pct" size={11} />
            </>
          )}
        </View>
      </View>
    </PressableScale>
  );
});

/** Placeholder tile while the vault loads. */
export function VaultTileSkeleton({ width }: { width: number }) {
  return (
    <View style={[styles.tile, { width }]}>
      <Skeleton width={width} height={Math.round(width * CARD_ASPECT)} radius={Math.max(4, Math.round(width * 0.055))} />
      <View style={styles.meta}>
        <Skeleton width="80%" height={12} />
        <Skeleton width="50%" height={10} style={styles.skeletonGap} />
        <Skeleton width="40%" height={16} style={styles.skeletonGap} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { marginBottom: spacing.xl },
  statusPill: { position: 'absolute', top: 8, left: 8, backgroundColor: colors.overlay },
  meta: { marginTop: spacing.sm, paddingHorizontal: 2 },
  valueRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, flexWrap: 'wrap' },
  value: { marginRight: spacing.sm },
  soldLabel: { marginRight: spacing.xs },
  skeletonGap: { marginTop: 6 },
});
