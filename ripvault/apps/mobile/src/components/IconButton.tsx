import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, HIT_SIZE } from '../theme.ts';
import { PressableScale } from './PressableScale.tsx';
import type { IconName } from './icons.ts';

export interface IconButtonProps {
  icon: IconName;
  onPress?: () => void;
  /** Required: screen readers have no other text to read. */
  accessibilityLabel: string;
  /** "surface" = round raised chip (default), "plain" = icon only, "gold" = gold chip. */
  variant?: 'surface' | 'plain' | 'gold';
  /** Icon size (default 20). The touch target is always at least 44pt. */
  size?: number;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Round icon-only button (back, close, more...). 44pt touch target. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'surface',
  size = 20,
  color,
  disabled,
  style,
  testID,
}: IconButtonProps) {
  const fg = color ?? (variant === 'gold' ? colors.textOnLight : colors.text);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="tap"
      scaleTo={0.9}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[
        styles.base,
        variant === 'surface' ? styles.surface : null,
        variant === 'gold' ? styles.gold : null,
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={fg} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    width: HIT_SIZE,
    height: HIT_SIZE,
    borderRadius: HIT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  surface: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gold: {
    backgroundColor: colors.gold,
  },
});
