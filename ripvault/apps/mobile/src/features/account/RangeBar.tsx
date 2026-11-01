import { StyleSheet, View } from 'react-native';
import { formatChance } from '@ripvault/shared';
import { colors, radii, spacing, withAlpha } from '../../theme.ts';
import { AppText } from '../../components/index.ts';
import { formatCount, formatRoll } from './format.ts';
import type { OddsRange } from './verification.ts';

export interface RangeBarProps {
  range: OddsRange;
  roll: number;
  /** Name of the card that owns the slice (the pulled card's name when it matches). */
  cardName: string;
  color?: string;
}

/**
 * The odds table drawn as a 0..1 line: the winning card's slice is highlighted and a marker shows
 * exactly where the roll landed, with the ticket maths underneath.
 */
export function RangeBar({ range, roll, cardName, color = colors.gold }: RangeBarProps) {
  const total = Math.max(1, range.totalWeight);
  const left = (range.start / total) * 100;
  // Very rare cards would be invisible at true scale: keep the slice at least ~1% wide.
  const width = Math.max((range.weight / total) * 100, 1);
  // Keep a widened slice inside the track (e.g. a rare card at the very end of the table).
  const sliceLeft = Math.max(0, Math.min(left, 100 - width));
  const marker = Math.min(100, Math.max(0, roll * 100));
  return (
    <View
      accessible
      accessibilityLabel={`The roll ${formatRoll(roll)} picked ticket ${range.ticket} of ${range.totalWeight}. ${cardName} owns tickets ${range.start} to ${range.end}, a ${formatChance(range.chance)} chance.`}
    >
      <View style={styles.track}>
        {/* The winning card's slice of 0..1, and the exact roll. */}
        <View style={[styles.slice, { left: `${sliceLeft}%`, width: `${width}%`, backgroundColor: color }]} />
        <View style={[styles.marker, { left: `${marker}%` }]} />
      </View>
      <View style={styles.scale}>
        <AppText variant="caption" size={11} tone="faint">
          0
        </AppText>
        <AppText variant="caption" size={11} tone="faint">
          1
        </AppText>
      </View>
      <View style={styles.facts}>
        <Fact label="Roll" value={formatRoll(roll)} />
        <Fact label="Ticket" value={`${formatCount(range.ticket)} of ${formatCount(range.totalWeight)}`} />
        <Fact label={`${cardName}'s range`} value={`${formatCount(range.start)}-${formatCount(range.end)}`} />
        <Fact label="Chance" value={formatChance(range.chance)} highlight={color} last />
      </View>
    </View>
  );
}

function Fact({ label, value, highlight, last = false }: { label: string; value: string; highlight?: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last ? styles.factBorder : null]}>
      <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.factLabel}>
        {label}
      </AppText>
      <AppText variant="money" size={15} color={highlight} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const TRACK_HEIGHT = 14;

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  slice: {
    position: 'absolute',
    top: 1,
    bottom: 1,
    borderRadius: radii.xs,
  },
  marker: {
    position: 'absolute',
    top: -6,
    width: 3,
    height: TRACK_HEIGHT + 10,
    marginLeft: -1.5,
    borderRadius: 2,
    backgroundColor: colors.text,
    borderWidth: 1,
    borderColor: withAlpha(colors.bg, 0.6),
  },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  facts: { marginTop: spacing.md },
  fact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  factBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  factLabel: { flex: 1, marginRight: spacing.md },
});
