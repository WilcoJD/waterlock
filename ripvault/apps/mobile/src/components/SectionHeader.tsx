import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, spacing } from '../theme.ts';
import { AppText } from './AppText.tsx';

export interface SectionHeaderProps {
  /** Rendered as an uppercase letter-spaced label. */
  title: string;
  /** Optional link on the right, e.g. "See all". */
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ title, actionLabel, onAction, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <AppText variant="label" accessibilityRole="header">
        {title}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={14} accessibilityRole="button" accessibilityLabel={actionLabel}>
          {({ pressed }: { pressed: boolean }) => (
            <AppText variant="caption" weight="700" color={colors.gold} style={pressed ? styles.pressed : null}>
              {actionLabel}
            </AppText>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    minHeight: 24,
  },
  pressed: { opacity: 0.6 },
});
