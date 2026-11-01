import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPence } from '@ripvault/shared';
import type { CardSummary } from '@ripvault/shared';
import { CARD_ASPECT, colors, glow as glowStyle, radii, tierColors, tierLabels, tierRank } from '../theme.ts';
import { AppText } from './AppText.tsx';
import { PressableScale } from './PressableScale.tsx';

export type CardArtSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Card widths in points for each size. Height is always width * 88/63. */
export const CARD_WIDTHS: Readonly<Record<CardArtSize, number>> = {
  xs: 56,
  sm: 96,
  md: 150,
  lg: 220,
  xl: 300,
};

export interface CardArtProps {
  card: CardSummary;
  /** Preset width (default "md"). Ignored when `width` is given. */
  size?: CardArtSize;
  /** Exact width in points (e.g. computed for a 2- or 3-column grid). */
  width?: number;
  /** Show a value badge on the bottom edge. */
  showValue?: boolean;
  /** Value for the badge (default card.marketValuePence), e.g. item.valueAtPullPence. */
  valuePence?: number;
  /** Tier-coloured glow. Default: on for rare and above. */
  glow?: boolean;
  /** Use the high-resolution image (default: true for lg/xl or width >= 200). */
  highRes?: boolean;
  /** Selection ring + check (multi-select in the vault). */
  selected?: boolean;
  /** Fade out (e.g. sold / shipping items). */
  dimmed?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A real card image at true 63:88 proportions with a tier-coloured border (and glow from rare up),
 * loading placeholder, broken-image fallback and an optional value badge.
 */
export function CardArt({
  card,
  size = 'md',
  width: widthProp,
  showValue = false,
  valuePence,
  glow,
  highRes,
  selected = false,
  dimmed = false,
  onPress,
  onLongPress,
  style,
  testID,
}: CardArtProps) {
  const width = widthProp ?? CARD_WIDTHS[size];
  const height = Math.round(width * CARD_ASPECT);
  const radius = Math.max(4, Math.round(width * 0.055));
  const tierColor = tierColors[card.tier];
  const showGlow = glow ?? tierRank[card.tier] >= tierRank.rare;
  const useLarge = highRes ?? width >= 200;
  const uri = useLarge ? card.imageLarge || card.imageSmall : card.imageSmall || card.imageLarge;
  // Load status is tied to the uri so a recycled list cell never shows the previous card's state.
  const [loadStatus, setLoadStatus] = useState<{ uri: string; status: 'loaded' | 'error' } | null>(null);
  const state: 'loading' | 'loaded' | 'error' = !uri ? 'error' : loadStatus?.uri === uri ? loadStatus.status : 'loading';
  const value = valuePence ?? card.marketValuePence;
  const compact = width < 80;

  const label = `${card.name}, ${tierLabels[card.tier]}${showValue ? `, worth ${formatPence(value)}` : ''}`;

  const body = (
    <View
      style={[
        styles.frame,
        { width, height, borderRadius: radius, borderColor: selected ? colors.gold : tierColor },
        showGlow && !dimmed ? glowStyle(tierColor, width >= 200 ? 'strong' : 'medium') : null,
        dimmed ? styles.dimmed : null,
      ]}
    >
      <View style={[styles.clip, { borderRadius: Math.max(2, radius - 2) }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="cover"
            onLoad={() => setLoadStatus({ uri, status: 'loaded' })}
            onError={() => setLoadStatus({ uri, status: 'error' })}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {state === 'loading' ? (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            <ActivityIndicator color={tierColor} size="small" />
          </View>
        ) : null}
        {state === 'error' ? (
          <View style={[StyleSheet.absoluteFill, styles.placeholder, styles.fallback]}>
            <Ionicons name="image-outline" size={compact ? 16 : 28} color={tierColor} />
            {!compact ? (
              <AppText variant="caption" align="center" numberOfLines={3} style={styles.fallbackText}>
                {card.name}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>
      {selected ? (
        <View style={styles.check}>
          <Ionicons name="checkmark" size={14} color={colors.textOnLight} />
        </View>
      ) : null}
      {showValue ? (
        <View style={[styles.valueBadge, { borderColor: tierColor }, compact ? styles.valueBadgeCompact : null]}>
          <AppText variant="money" size={compact ? 10 : width >= 200 ? 15 : 12} numberOfLines={1}>
            {formatPence(value)}
          </AppText>
        </View>
      ) : null}
    </View>
  );

  if (onPress || onLongPress) {
    return (
      <PressableScale
        onPress={onPress}
        onLongPress={onLongPress}
        haptic="tap"
        scaleTo={0.96}
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        style={style}
        testID={testID}
      >
        {body}
      </PressableScale>
    );
  }
  return (
    <View style={style} accessible accessibilityRole="image" accessibilityLabel={label} testID={testID}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  clip: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  fallback: {
    padding: 8,
  },
  fallbackText: {
    marginTop: 6,
  },
  dimmed: { opacity: 0.4 },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  valueBadge: {
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(7, 6, 26, 0.88)',
    borderWidth: 1,
  },
  valueBadgeCompact: {
    bottom: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
});
