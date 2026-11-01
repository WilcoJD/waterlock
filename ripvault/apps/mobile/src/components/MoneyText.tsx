import { formatPence } from '@ripvault/shared';
import type { StyleProp, TextStyle } from 'react-native';
import { colors } from '../theme.ts';
import type { TypographyVariant } from '../theme.ts';
import { AppText } from './AppText.tsx';
import type { TextTone } from './AppText.tsx';

export interface MoneyTextProps {
  /** Integer pence. */
  pence: number;
  /** Size preset (default "money"); every preset is rendered heavy with tabular digits. */
  variant?: TypographyVariant;
  size?: number;
  tone?: TextTone;
  color?: string;
  /** Show "+" on positive amounts (ledgers). */
  signed?: boolean;
  /** Colour positive green and negative red (ledgers). */
  colorBySign?: boolean;
  /** "£25" instead of "£25.00". */
  trimWholePounds?: boolean;
  align?: 'left' | 'center' | 'right';
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

/** Formats integer pence as GBP ("£1,234.56") in a bold tabular-number style. */
export function MoneyText({
  pence,
  variant = 'money',
  size,
  tone,
  color,
  signed,
  colorBySign,
  trimWholePounds,
  align,
  numberOfLines = 1,
  adjustsFontSizeToFit,
  style,
  accessibilityLabel,
}: MoneyTextProps) {
  const text = formatPence(pence, { signed, trimWholePounds });
  const signColor = colorBySign ? (pence > 0 ? colors.success : pence < 0 ? colors.danger : undefined) : undefined;
  return (
    <AppText
      variant={variant}
      size={size}
      tone={tone}
      color={color ?? signColor}
      align={align}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      weight="800"
      style={[{ fontVariant: ['tabular-nums'] }, style]}
      accessibilityLabel={accessibilityLabel ?? text}
    >
      {text}
    </AppText>
  );
}
