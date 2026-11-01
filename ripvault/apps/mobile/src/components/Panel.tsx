import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, glow as glowStyle, gradients, radii, spacing } from '../theme.ts';
import { PressableScale } from './PressableScale.tsx';

export interface PanelProps {
  children?: ReactNode;
  /** Inner padding (default true = 16). Pass a number for custom padding. */
  padded?: boolean | number;
  /** Raised look: lighter surface with a subtle top sheen. */
  raised?: boolean;
  /** Coloured border + glow (e.g. a tier colour or colors.gold for highlights). */
  glowColor?: string;
  /** Makes the whole panel tappable (press animation + haptic). */
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Surface card: rounded, 1px border, dark raised background. */
export function Panel({ children, padded = true, raised = false, glowColor, onPress, accessibilityLabel, style, testID }: PanelProps) {
  const padding = padded === true ? spacing.lg : padded === false ? 0 : padded;
  const boxStyle = [
    styles.base,
    raised ? styles.raised : null,
    glowColor ? [{ borderColor: glowColor }, glowStyle(glowColor, 'soft')] : null,
    { padding },
    style,
  ];
  const content = (
    <>
      {raised ? (
        <LinearGradient
          colors={gradients.surface}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.sheen]}
          pointerEvents="none"
        />
      ) : null}
      {children}
    </>
  );
  if (onPress) {
    return (
      <PressableScale onPress={onPress} haptic="tap" scaleTo={0.98} accessibilityLabel={accessibilityLabel} style={boxStyle} testID={testID}>
        {content}
      </PressableScale>
    );
  }
  return (
    <View style={boxStyle} accessibilityLabel={accessibilityLabel} testID={testID}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  raised: {
    backgroundColor: colors.surfaceRaised,
  },
  sheen: {
    borderRadius: radii.lg,
  },
});
