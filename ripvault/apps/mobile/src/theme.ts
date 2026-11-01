/**
 * RipVault design tokens. Dark mode only.
 * Import from here instead of hard-coding colours/sizes in screens:
 *   import { colors, spacing, radii, typography, gradients, tierColors, glow } from '../src/theme.ts';
 */
import type { TextStyle, ViewStyle } from 'react-native';
import type { Tier } from '@ripvault/shared';

/** A LinearGradient `colors` value: a readonly tuple of at least two colours. */
export type GradientColors = readonly [string, string, ...string[]];

export const colors = {
  /** App background (bottom of the background gradient). */
  bg: '#07061A',
  /** Slightly lifted background, e.g. tab bar. */
  bgAlt: '#0C0A24',
  /** Top of the background gradient. */
  bgTop: '#120F2E',
  /** Cards, panels, inputs. */
  surface: '#17143A',
  /** Raised surfaces: pressed rows, chips, nested panels. */
  surfaceRaised: '#1F1B4D',
  surfacePressed: '#27225C',
  border: '#2E2A66',
  borderStrong: '#433D8C',

  text: '#F5F3FF',
  textMuted: '#A7A3D6',
  textFaint: '#6F6AA6',
  /** Dark text for use on the holo / gold gradients. */
  textOnLight: '#14102E',

  gold: '#FFC94D',
  goldDeep: '#E0A526',
  violet: '#7C5CFF',
  violetDeep: '#5B3FE0',
  violetSoft: 'rgba(124, 92, 255, 0.16)',
  goldSoft: 'rgba(255, 201, 77, 0.14)',

  success: '#34D399',
  successSoft: 'rgba(52, 211, 153, 0.14)',
  danger: '#F87171',
  dangerSoft: 'rgba(248, 113, 113, 0.14)',
  warning: '#FBBF24',
  info: '#60A5FA',

  /** Scrim behind modals/overlays. */
  overlay: 'rgba(7, 6, 26, 0.78)',
  transparent: 'transparent',
} as const;

/** Rarity tier colours (border/glow on cards, badges). Keyed by the shared `Tier`. */
export const tierColors: Readonly<Record<Tier, string>> = {
  common: '#9CA3AF',
  uncommon: '#34D399',
  rare: '#60A5FA',
  epic: '#C084FC',
  legendary: '#FBBF24',
};

/** Human labels for tiers. */
export const tierLabels: Readonly<Record<Tier, string>> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/** Tier rank, handy for "glow from rare upwards" checks: tierRank[tier] >= tierRank.rare. */
export const tierRank: Readonly<Record<Tier, number>> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

export const gradients = {
  /** Primary call-to-action: iridescent pale gold -> pink -> periwinkle. Use dark text on it. */
  holo: ['#FFE7A3', '#FFA6C9', '#A9B8FF'],
  gold: ['#FFE08A', '#FFC94D', '#E0A526'],
  violet: ['#9A82FF', '#7C5CFF', '#5B3FE0'],
  danger: ['#FF8A8A', '#E5484D'],
  /** Screen background, top to bottom. */
  background: ['#120F2E', '#07061A'],
  /** Soft violet glow that fades out, laid over the top of the background. */
  backgroundGlow: ['rgba(124, 92, 255, 0.22)', 'rgba(124, 92, 255, 0)'],
  /** Raised panel sheen. */
  surface: ['#1F1B4D', '#17143A'],
} as const satisfies Record<string, GradientColors>;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  /** Horizontal screen gutter. */
  gutter: 20,
} as const;

export const radii = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Minimum touch target (iOS HIG / Material). */
export const HIT_SIZE = 44;

export type TypographyVariant = 'display' | 'title' | 'heading' | 'body' | 'caption' | 'label' | 'money';

/** Text presets. `money` is for amounts: heavy weight and tabular digits so values do not jitter. */
export const typography: Record<TypographyVariant, TextStyle> = {
  display: { fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: -0.8 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4 },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '700', letterSpacing: -0.1 },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  money: { fontSize: 20, lineHeight: 26, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.2 },
};

/** Coloured glow (iOS shadow + Android elevation tinted by shadowColor on API 28+). */
export function glow(color: string, intensity: 'soft' | 'medium' | 'strong' = 'medium'): ViewStyle {
  const radius = intensity === 'soft' ? 8 : intensity === 'medium' ? 16 : 26;
  return {
    shadowColor: color,
    shadowOpacity: intensity === 'soft' ? 0.35 : intensity === 'medium' ? 0.55 : 0.8,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: 0 },
    elevation: intensity === 'soft' ? 4 : intensity === 'medium' ? 8 : 14,
  };
}

export const shadows: Record<'card' | 'raised' | 'floating', ViewStyle> = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
};

/** Real trading-card proportions (63 x 88 mm). height = width * CARD_ASPECT. */
export const CARD_ASPECT = 88 / 63;

/** Add alpha to a #RRGGBB colour: withAlpha('#7C5CFF', 0.2) -> 'rgba(124, 92, 255, 0.2)'. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h as string, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
