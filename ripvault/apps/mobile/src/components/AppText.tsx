import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { colors, typography } from '../theme.ts';
import type { TypographyVariant } from '../theme.ts';

export type TextTone = 'default' | 'muted' | 'faint' | 'gold' | 'violet' | 'success' | 'danger' | 'onLight';

const toneColors: Record<TextTone, string> = {
  default: colors.text,
  muted: colors.textMuted,
  faint: colors.textFaint,
  gold: colors.gold,
  violet: colors.violet,
  success: colors.success,
  danger: colors.danger,
  onLight: colors.textOnLight,
};

export interface AppTextProps {
  children?: ReactNode;
  /** Typography preset (default "body"). `label` is small, uppercase and letter-spaced. */
  variant?: TypographyVariant;
  /** Colour by role (default "default"; `label` and `caption` default to "muted"). */
  tone?: TextTone;
  /** Explicit colour; wins over `tone`. */
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Override the preset's font size (line height scales with it). */
  size?: number;
  weight?: TextStyle['fontWeight'];
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
  onPress?: () => void;
  accessibilityRole?: 'text' | 'header' | 'link' | 'button';
  accessibilityLabel?: string;
  testID?: string;
}

/** The only text component screens should use. */
export function AppText({
  children,
  variant = 'body',
  tone,
  color,
  align,
  size,
  weight,
  numberOfLines,
  adjustsFontSizeToFit,
  selectable,
  style,
  onPress,
  accessibilityRole,
  accessibilityLabel,
  testID,
}: AppTextProps) {
  const preset = typography[variant];
  const defaultTone: TextTone = variant === 'label' || variant === 'caption' ? 'muted' : 'default';
  const sizeStyle: TextStyle | null =
    size !== undefined
      ? {
          fontSize: size,
          lineHeight:
            typeof preset.lineHeight === 'number' && typeof preset.fontSize === 'number'
              ? Math.round(size * (preset.lineHeight / preset.fontSize))
              : undefined,
        }
      : null;
  return (
    <Text
      style={[
        styles.base,
        preset,
        { color: color ?? toneColors[tone ?? defaultTone] },
        align ? { textAlign: align } : null,
        sizeStyle,
        weight ? { fontWeight: weight } : null,
        style,
      ]}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={adjustsFontSizeToFit ? 0.6 : undefined}
      selectable={selectable}
      onPress={onPress}
      accessibilityRole={accessibilityRole ?? (variant === 'title' || variant === 'display' ? 'header' : undefined)}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      maxFontSizeMultiplier={variant === 'display' || variant === 'money' ? 1.3 : 1.6}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    color: colors.text,
    includeFontPadding: false,
  },
});
