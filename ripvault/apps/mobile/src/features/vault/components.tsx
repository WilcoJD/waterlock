/**
 * Small building blocks for the vault and item screens: toolbar chips, the value-change line,
 * and the item status pill.
 */
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPence } from '@ripvault/shared';
import type { InventoryStatus } from '@ripvault/shared';
import { colors, HIT_SIZE, radii, spacing } from '../../theme.ts';
import { AppText, Pill, PressableScale } from '../../components/index.ts';
import type { IconName } from '../../components/index.ts';
import { formatPct, ITEM_STATUS_META, valueChange } from './format.ts';

// ---------------------------------------------------------------------------

export interface ChipButtonProps {
  label: string;
  icon?: IconName;
  iconRight?: IconName;
  onPress: () => void;
  /** Gold outline + text (e.g. while selection mode is on). */
  active?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** Compact rounded toolbar button (36pt tall, 44pt touch target). */
export function ChipButton({ label, icon, iconRight, onPress, active = false, accessibilityLabel, accessibilityHint, style }: ChipButtonProps) {
  const fg = active ? colors.gold : colors.text;
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      scaleTo={0.95}
      hitSlop={(HIT_SIZE - CHIP_HEIGHT) / 2}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: active }}
      style={[styles.chip, active ? styles.chipActive : null, style]}
    >
      {icon ? <Ionicons name={icon} size={15} color={fg} style={styles.chipIcon} /> : null}
      <AppText variant="caption" weight="700" color={fg} numberOfLines={1}>
        {label}
      </AppText>
      {iconRight ? <Ionicons name={iconRight} size={14} color={colors.textMuted} style={styles.chipIconRight} /> : null}
    </PressableScale>
  );
}

const CHIP_HEIGHT = 36;

// ---------------------------------------------------------------------------

export interface ValueChangeTextProps {
  currentPence: number;
  atPullPence: number;
  /** "full" = "+£1.20 (+12%)", "pct" = "+12%" only. */
  mode?: 'full' | 'pct';
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** Green/red change in value since the card was pulled. Renders nothing for no change in "pct" mode. */
export function ValueChangeText({ currentPence, atPullPence, mode = 'full', size = 13, style }: ValueChangeTextProps) {
  const change = valueChange(currentPence, atPullPence);
  if (mode === 'pct' && (change.direction === 'flat' || change.pct === null)) return null;
  const color = change.direction === 'up' ? colors.success : change.direction === 'down' ? colors.danger : colors.textMuted;
  const icon: IconName = change.direction === 'up' ? 'arrow-up' : change.direction === 'down' ? 'arrow-down' : 'remove';
  const pctText = change.pct !== null ? formatPct(change.pct) : null;
  const text =
    mode === 'pct'
      ? (pctText ?? '')
      : change.direction === 'flat'
        ? 'No change'
        : `${formatPence(change.deltaPence, { signed: true })}${pctText ? ` (${pctText})` : ''}`;
  const spoken =
    change.direction === 'flat'
      ? 'No change in value since pulled'
      : `${change.direction === 'up' ? 'Up' : 'Down'} ${formatPence(Math.abs(change.deltaPence))}${pctText ? `, ${pctText}` : ''} since pulled`;
  return (
    <View style={[styles.change, style]} accessible accessibilityLabel={spoken}>
      <Ionicons name={icon} size={size - 1} color={color} style={styles.changeIcon} />
      <AppText variant="caption" size={size} weight="800" color={color} numberOfLines={1} style={styles.tabular}>
        {text}
      </AppText>
    </View>
  );
}

// ---------------------------------------------------------------------------

export function ItemStatusPill({ status, size = 'sm', style }: { status: InventoryStatus; size?: 'sm' | 'md'; style?: StyleProp<ViewStyle> }) {
  const meta = ITEM_STATUS_META[status];
  return <Pill label={meta.label} color={meta.color} icon={meta.icon} size={size} style={style} />;
}

const styles = StyleSheet.create({
  chip: {
    height: CHIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  chipIcon: { marginRight: 6 },
  chipIconRight: { marginLeft: 4 },
  change: { flexDirection: 'row', alignItems: 'center' },
  changeIcon: { marginRight: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
});
