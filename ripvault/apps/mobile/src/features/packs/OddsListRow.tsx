import { StyleSheet, View } from 'react-native';
import { formatChance, formatOneIn, formatPence, pullOutcome } from '@ripvault/shared';
import type { OddsRow, Tier } from '@ripvault/shared';
import { colors, radii, spacing, tierColors, tierLabels, withAlpha } from '../../theme.ts';
import { AppText, CardArt, MoneyText, Pill } from '../../components/index.ts';
import { plural } from '../../lib/format.ts';

export interface OddsListRowProps {
  row: OddsRow;
  packPricePence: number;
}

/** One card in a pack's odds table: thumb, name/set, tier, value, chance and "1 in N". */
export function OddsListRow({ row, packPricePence }: OddsListRowProps) {
  const { card, chance } = row;
  const tierColor = tierColors[card.tier];
  const outcome = pullOutcome(card.marketValuePence, packPricePence);
  const label = `${card.name}, ${card.setName}, ${tierLabels[card.tier]}. Worth ${formatPence(card.marketValuePence)}. Chance ${formatChance(chance)}, ${formatOneIn(chance)}.`;

  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <View style={[styles.stripe, { backgroundColor: tierColor }]} />
      <CardArt card={card} size="xs" glow={false} />
      <View style={styles.middle}>
        <AppText variant="body" weight="700" numberOfLines={1}>
          {card.name}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {card.setName} · #{card.number}
        </AppText>
        <View style={styles.tags}>
          <AppText variant="label" size={10} color={tierColor}>
            {tierLabels[card.tier]}
          </AppText>
          {outcome !== 'loss' ? (
            <Pill
              label={outcome === 'big_win' ? 'Big hit' : 'Hit'}
              color={outcome === 'big_win' ? colors.gold : colors.success}
              size="sm"
              style={styles.hitPill}
            />
          ) : null}
        </View>
      </View>
      <View style={styles.right}>
        <MoneyText pence={card.marketValuePence} size={16} align="right" />
        <AppText variant="caption" weight="700" color={colors.text} align="right" style={styles.chance}>
          {formatChance(chance)}
        </AppText>
        <AppText variant="caption" tone="faint" size={11} align="right" numberOfLines={1}>
          {formatOneIn(chance)}
        </AppText>
      </View>
    </View>
  );
}

export interface TierSectionHeaderProps {
  tier: Tier;
  count: number;
  /** Combined chance of this tier (0..1). */
  chance: number;
}

/** Group header in the odds list: tier colour + name, card count and combined chance. */
export function TierSectionHeader({ tier, count, chance }: TierSectionHeaderProps) {
  const color = tierColors[tier];
  return (
    <View
      style={styles.header}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${tierLabels[tier]}: ${plural(count, 'card')}, ${formatChance(chance)} combined`}
    >
      <View style={[styles.dot, { backgroundColor: color, shadowColor: color }]} />
      <AppText variant="label" color={color} size={12}>
        {tierLabels[tier]}
      </AppText>
      <View style={styles.headerRule}>
        <View style={[styles.rule, { backgroundColor: withAlpha(color, 0.25) }]} />
      </View>
      <AppText variant="caption" tone="muted" size={12}>
        {plural(count, 'card')} · {formatChance(chance)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  middle: { flex: 1, minWidth: 0, marginLeft: spacing.md },
  tags: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  hitPill: { marginLeft: spacing.sm },
  right: { marginLeft: spacing.sm, alignItems: 'flex-end', minWidth: 76 },
  chance: { marginTop: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  headerRule: { flex: 1, paddingHorizontal: spacing.md },
  rule: { height: 1 },
});
