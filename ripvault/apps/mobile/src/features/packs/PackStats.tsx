import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { formatChance, formatOneIn, formatPence } from '@ripvault/shared';
import { colors, radii, spacing } from '../../theme.ts';
import { AppText, MoneyText } from '../../components/index.ts';

export interface StatTileProps {
  label: string;
  /** Rendered value (use MoneyText / AppText variant="money"). */
  children?: ReactNode;
  caption?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/** Small stat tile: uppercase label, big tabular value, optional caption. */
export function StatTile({ label, children, caption, style, accessibilityLabel }: StatTileProps) {
  return (
    <View style={[styles.tile, style]} accessible accessibilityLabel={accessibilityLabel}>
      <AppText variant="label" numberOfLines={1}>
        {label}
      </AppText>
      <View style={styles.value}>{children}</View>
      {caption ? (
        <AppText variant="caption" tone="faint" size={11} numberOfLines={1}>
          {caption}
        </AppText>
      ) : null}
    </View>
  );
}

export interface PackStatRowProps {
  minPullPence: number;
  maxPullPence: number;
  /** Chance a single pull is worth at least the pack price (0..1). */
  hitChance: number;
  /** Adds a fourth "Cards" tile (the odds sheet lays these out 2 x 2). */
  cardCount?: number;
  style?: StyleProp<ViewStyle>;
}

/** Min pull / Max pull / Hit rate (and optionally card count). Expected value is deliberately not shown. */
export function PackStatRow({ minPullPence, maxPullPence, hitChance, cardCount, style }: PackStatRowProps) {
  const grid = cardCount !== undefined;
  const tileStyle = grid ? styles.gridTile : styles.rowTile;
  return (
    <View style={[grid ? styles.grid : styles.row, style]}>
      <StatTile label="Min pull" caption="lowest card" style={tileStyle} accessibilityLabel={`Minimum pull ${formatPence(minPullPence)}`}>
        <MoneyText pence={minPullPence} size={18} adjustsFontSizeToFit />
      </StatTile>
      <StatTile label="Max pull" caption="top card" style={tileStyle} accessibilityLabel={`Maximum pull ${formatPence(maxPullPence)}`}>
        <MoneyText pence={maxPullPence} size={18} tone="gold" adjustsFontSizeToFit />
      </StatTile>
      <StatTile
        label="Hit rate"
        caption={hitChance > 0 ? formatOneIn(hitChance) : 'no hits'}
        style={tileStyle}
        accessibilityLabel={`Hit rate ${formatChance(hitChance)}, ${formatOneIn(hitChance)}. Chance a card is worth at least the pack price`}
      >
        <AppText variant="money" size={18} color={colors.success} numberOfLines={1} adjustsFontSizeToFit>
          {formatChance(hitChance)}
        </AppText>
      </StatTile>
      {grid ? (
        <StatTile label="Cards" caption="in the odds table" style={tileStyle} accessibilityLabel={`${cardCount} different cards`}>
          <AppText variant="money" size={18} numberOfLines={1}>
            {cardCount}
          </AppText>
        </StatTile>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginHorizontal: -spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  rowTile: { flex: 1, marginHorizontal: spacing.xs },
  gridTile: { width: '47%', flexGrow: 1, marginHorizontal: spacing.xs, marginBottom: spacing.sm },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  value: { marginTop: spacing.xs, marginBottom: 2, minHeight: 26, justifyContent: 'center' },
});
