import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import type { AccessibilityRole, Insets, StyleProp, ViewStyle } from 'react-native';
import { haptic } from '../lib/haptics.ts';
import type { HapticKind } from '../lib/haptics.ts';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps {
  children?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Scale while pressed (default 0.97). */
  scaleTo?: number;
  /** Haptic fired on press (default none). */
  haptic?: HapticKind | false;
  /** Style of the pressable box itself (layout + visuals). */
  style?: StyleProp<ViewStyle>;
  hitSlop?: number | Insets;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: { disabled?: boolean; selected?: boolean; checked?: boolean | 'mixed'; busy?: boolean };
  testID?: string;
}

/**
 * Base for anything tappable: springy scale + slight fade while pressed, optional haptic.
 * Used by Button, ListRow, Panel(onPress), CardArt(onPress). Defaults to accessibilityRole="button".
 */
export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled,
  scaleTo = 0.97,
  haptic: hapticKind = false,
  style,
  hitSlop,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  testID,
}: PressableScaleProps) {
  const pressed = useRef(new Animated.Value(0)).current;

  const animateTo = (toValue: number) => {
    Animated.spring(pressed, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: toValue === 0 ? 8 : 0,
    }).start();
  };

  const scale = pressed.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] });
  const opacity = pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] });

  return (
    <AnimatedPressable
      onPress={
        onPress
          ? () => {
              if (hapticKind) haptic[hapticKind]();
              onPress();
            }
          : undefined
      }
      onLongPress={onLongPress}
      onPressIn={() => animateTo(1)}
      onPressOut={() => animateTo(0)}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      testID={testID}
      style={[style, { opacity, transform: [{ scale }] }, disabled ? styles.disabled : null]}
    >
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.45 },
});
