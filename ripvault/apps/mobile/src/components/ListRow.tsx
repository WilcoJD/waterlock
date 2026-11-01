import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, HIT_SIZE, radii, spacing, withAlpha } from '../theme.ts';
import { AppText } from './AppText.tsx';
import type { TextTone } from './AppText.tsx';
import { PressableScale } from './PressableScale.tsx';
import type { IconName } from './icons.ts';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Ionicons name in a tinted rounded square on the left. */
  icon?: IconName;
  /** Accent for the icon (#RRGGBB, default violet). */
  iconColor?: string;
  /** Custom left element (e.g. a small CardArt); replaces `icon`. */
  left?: ReactNode;
  /** Right-aligned text value (e.g. formatPence(...)). */
  value?: string;
  valueTone?: TextTone;
  /** Small text under the value. */
  valueCaption?: string;
  /** Custom right element; replaces value. */
  right?: ReactNode;
  /** Chevron on the right (default: shown when onPress is set). */
  chevron?: boolean;
  /** Red title + icon (e.g. "Sign out", "Delete address"). */
  destructive?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Settings / ledger / list row. Tappable when onPress is given (press animation + haptic). */
export function ListRow({
  title,
  subtitle,
  icon,
  iconColor = colors.violet,
  left,
  value,
  valueTone = 'default',
  valueCaption,
  right,
  chevron,
  destructive = false,
  onPress,
  disabled,
  accessibilityLabel,
  style,
  testID,
}: ListRowProps) {
  const accent = destructive ? colors.danger : iconColor;
  const showChevron = chevron ?? !!onPress;
  const content = (
    <>
      {left ? (
        <View style={styles.left}>{left}</View>
      ) : icon ? (
        <View style={[styles.iconBox, { backgroundColor: withAlpha(accent, 0.16) }]}>
          <Ionicons name={icon} size={18} color={accent} />
        </View>
      ) : null}
      <View style={styles.middle}>
        <AppText variant="body" weight="600" numberOfLines={1} tone={destructive ? 'danger' : 'default'}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted" numberOfLines={2} style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right ??
        (value !== undefined ? (
          <View style={styles.valueWrap}>
            <AppText variant="money" size={16} tone={valueTone} numberOfLines={1}>
              {value}
            </AppText>
            {valueCaption ? (
              <AppText variant="caption" tone="faint" size={11} numberOfLines={1}>
                {valueCaption}
              </AppText>
            ) : null}
          </View>
        ) : null)}
      {showChevron ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} style={styles.chevron} /> : null}
    </>
  );

  const label = accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ');
  if (onPress) {
    return (
      <PressableScale
        onPress={onPress}
        disabled={disabled}
        haptic="tap"
        scaleTo={0.985}
        accessibilityLabel={label}
        style={[styles.row, style]}
        testID={testID}
      >
        {content}
      </PressableScale>
    );
  }
  return (
    <View style={[styles.row, style]} accessible accessibilityLabel={label} testID={testID}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HIT_SIZE + 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  left: { marginRight: spacing.md },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radii.xs + 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  middle: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: 2 },
  valueWrap: { alignItems: 'flex-end', marginLeft: spacing.md, flexShrink: 0 },
  chevron: { marginLeft: spacing.sm },
});
