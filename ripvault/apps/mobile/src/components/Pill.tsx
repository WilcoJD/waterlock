import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, withAlpha } from '../theme.ts';
import { AppText } from './AppText.tsx';
import type { IconName } from './icons.ts';

export interface PillProps {
  label: string;
  /** Accent colour as #RRGGBB (default violet). */
  color?: string;
  icon?: IconName;
  /** soft = tinted background (default), solid = filled, outline = border only. */
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

/** Small status/label chip (shipment status, "HIT", "NEW", counts...). */
export function Pill({ label, color = colors.violet, icon, variant = 'soft', size = 'sm', style }: PillProps) {
  const solid = variant === 'solid';
  const fg = solid ? colors.textOnLight : color;
  return (
    <View
      style={[
        styles.base,
        size === 'md' ? styles.md : styles.sm,
        variant === 'soft' ? { backgroundColor: withAlpha(color, 0.16), borderColor: withAlpha(color, 0.35) } : null,
        solid ? { backgroundColor: color, borderColor: color } : null,
        variant === 'outline' ? { borderColor: withAlpha(color, 0.6) } : null,
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={size === 'md' ? 13 : 11} color={fg} style={styles.icon} /> : null}
      <AppText variant="label" color={fg} size={size === 'md' ? 12 : 10}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sm: { paddingHorizontal: 8, paddingVertical: 3 },
  md: { paddingHorizontal: 12, paddingVertical: 6 },
  icon: { marginRight: 4 },
});
