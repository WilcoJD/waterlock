import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, HIT_SIZE, radii, spacing } from '../theme.ts';
import { haptic } from '../lib/haptics.ts';
import { AppText } from './AppText.tsx';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Text (or custom node, e.g. text with links) beside the box. */
  label?: ReactNode;
  /** Error text under the row. */
  error?: string | null;
  disabled?: boolean;
  /** Screen-reader label; defaults to `label` when it is a string. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Checkbox({ checked, onChange, label, error, disabled, accessibilityLabel, style, testID }: CheckboxProps) {
  return (
    <View style={style}>
      <Pressable
        onPress={() => {
          haptic.selection();
          onChange(!checked);
        }}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: !!disabled }}
        accessibilityLabel={accessibilityLabel ?? (typeof label === 'string' ? label : undefined)}
        testID={testID}
        style={({ pressed }: { pressed: boolean }) => [styles.row, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
      >
        <View
          style={[
            styles.box,
            checked ? styles.boxChecked : null,
            error && !checked ? { borderColor: colors.danger } : null,
          ]}
        >
          {checked ? <Ionicons name="checkmark" size={16} color={colors.textOnLight} /> : null}
        </View>
        {label !== undefined ? (
          <View style={styles.labelWrap}>
            {typeof label === 'string' ? <AppText variant="body" size={15}>{label}</AppText> : label}
          </View>
        ) : null}
      </Pressable>
      {error ? (
        <AppText variant="caption" tone="danger" style={styles.error}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HIT_SIZE,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radii.xs - 1,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  labelWrap: { flex: 1, marginLeft: spacing.md },
  error: { marginLeft: 24 + spacing.md, marginTop: 2 },
});
