import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, glow, gradients, radii } from '../theme.ts';
import type { GradientColors } from '../theme.ts';
import type { HapticKind } from '../lib/haptics.ts';
import { AppText } from './AppText.tsx';
import { PressableScale } from './PressableScale.tsx';
import type { IconName } from './icons.ts';

export type ButtonVariant = 'holo' | 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  /** holo = main call-to-action (iridescent, dark text); primary = violet; secondary = outlined
   *  surface; ghost = text only; danger = destructive. Default "primary". */
  variant?: ButtonVariant;
  /** sm 36pt (hit area padded to 44), md 48pt, lg 56pt. Default "md". */
  size?: ButtonSize;
  /** Shows a spinner, keeps the width, blocks presses. */
  loading?: boolean;
  disabled?: boolean;
  /** Ionicons name shown before the title. */
  icon?: IconName;
  /** Ionicons name shown after the title. */
  iconRight?: IconName;
  /** Stretch to the container width. */
  block?: boolean;
  /** Haptic on press (default "tap"; false to disable). */
  haptic?: HapticKind | false;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

const SIZES: Record<ButtonSize, { height: number; padH: number; font: number; icon: number; radius: number }> = {
  sm: { height: 36, padH: 14, font: 14, icon: 16, radius: radii.sm },
  md: { height: 48, padH: 20, font: 16, icon: 18, radius: radii.md },
  lg: { height: 56, padH: 24, font: 17, icon: 20, radius: radii.lg },
};

const FOREGROUND: Record<ButtonVariant, string> = {
  holo: colors.textOnLight,
  primary: '#FFFFFF',
  secondary: colors.text,
  ghost: colors.gold,
  danger: '#FFFFFF',
};

const GRADIENT: Partial<Record<ButtonVariant, GradientColors>> = {
  holo: gradients.holo,
  primary: gradients.violet,
  danger: gradients.danger,
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconRight,
  block = false,
  haptic = 'tap',
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const s = SIZES[size];
  const fg = FOREGROUND[variant];
  const gradient = GRADIENT[variant];
  const inactive = disabled || loading;
  const hitSlop = s.height < 44 ? (44 - s.height) / 2 : undefined;

  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      haptic={haptic}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: loading }}
      testID={testID}
      style={[
        block ? styles.block : styles.inline,
        variant === 'holo' && !inactive ? glow('#FFB8D9', 'soft') : null,
        variant === 'primary' && !inactive ? glow(colors.violet, 'soft') : null,
        style,
      ]}
    >
      <View
        style={[
          styles.body,
          { minHeight: s.height, paddingHorizontal: s.padH, borderRadius: s.radius },
          variant === 'secondary' ? styles.secondary : null,
          variant === 'ghost' ? styles.ghost : null,
        ]}
      >
        {gradient ? (
          <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : null}
        {variant === 'holo' ? (
          <LinearGradient
            colors={['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 0.6 }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View style={[styles.content, loading ? styles.hidden : null]}>
          {icon ? <Ionicons name={icon} size={s.icon} color={fg} style={styles.iconLeft} /> : null}
          <AppText
            variant="body"
            size={s.font}
            weight="800"
            color={fg}
            numberOfLines={1}
            style={styles.title}
          >
            {title}
          </AppText>
          {iconRight ? <Ionicons name={iconRight} size={s.icon} color={fg} style={styles.iconRight} /> : null}
        </View>
        {loading ? <ActivityIndicator color={fg} style={StyleSheet.absoluteFill} /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  block: { alignSelf: 'stretch' },
  inline: { alignSelf: 'flex-start' },
  body: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hidden: { opacity: 0 },
  title: { letterSpacing: 0.2 },
  iconLeft: { marginRight: 8 },
  iconRight: { marginLeft: 8 },
});
