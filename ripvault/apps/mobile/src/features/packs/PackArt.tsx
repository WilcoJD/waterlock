/**
 * Original RipVault pack artwork, built from views and gradients (no image assets):
 *   - PackBody: the foil pack itself (theme gradient, crimped seals, moving foil sheen, RIPVAULT
 *     wordmark, a "vault door" emblem, pack name, price tag, SOLD OUT ribbon).
 *   - PackArt: PackBody with the pack's featured cards fanned out behind its top seal.
 *   - VaultEmblem: the round vault-door badge (also used on card backs).
 */
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { formatPence } from '@ripvault/shared';
import type { CardSummary, PackTheme } from '@ripvault/shared';
import { CARD_ASPECT, colors, gradients, shadows, withAlpha } from '../../theme.ts';
import type { GradientColors } from '../../theme.ts';
import { AppText, CardArt } from '../../components/index.ts';
import { safePackTheme } from './packData.ts';

/** Pack body height / width. */
export const PACK_ASPECT = 1.42;
/** Fanned card width as a fraction of the pack width. */
const FAN_CARD_RATIO = 0.46;
/** Below this width the pack drops its text (thumbnails). */
const COMPACT_WIDTH = 120;

const WHITE_0 = 'rgba(255, 255, 255, 0)';

export function packBodyHeight(width: number): number {
  return Math.round(width * PACK_ASPECT);
}

/** How far the fanned cards rise above the pack's top edge. */
function fanOverhang(width: number): number {
  const cardHeight = width * FAN_CARD_RATIO * CARD_ASPECT;
  return Math.round(cardHeight * 0.5 + width * 0.06);
}

/** Total height of <PackArt> for a pack `width` (with or without fanned cards). */
export function packArtHeight(width: number, withCards: boolean): number {
  return packBodyHeight(width) + (withCards ? fanOverhang(width) : 0);
}

// ---------------------------------------------------------------------------
// Vault emblem
// ---------------------------------------------------------------------------

export interface VaultEmblemProps {
  size: number;
  accent: string;
}

/** Round vault-door badge: accent ring with 8 bolts around a holo core and a diamond. */
export function VaultEmblem({ size, accent }: VaultEmblemProps) {
  const bolt = Math.max(3, Math.round(size * 0.06));
  const inner = Math.round(size * 0.6);
  const bolts = useMemo(() => {
    const radius = size / 2 - bolt * 1.5;
    return Array.from({ length: 8 }, (_, i) => {
      const angle = (i * Math.PI) / 4;
      return { left: size / 2 + radius * Math.cos(angle) - bolt / 2, top: size / 2 + radius * Math.sin(angle) - bolt / 2 };
    });
  }, [size, bolt]);

  return (
    <View
      style={[styles.emblem, { width: size, height: size, borderRadius: size / 2, borderColor: withAlpha(accent, 0.9), borderWidth: Math.max(1.5, size * 0.025) }]}
    >
      <LinearGradient
        colors={[withAlpha(accent, 0.38), 'rgba(7, 6, 26, 0.6)']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
      />
      {bolts.map((b, i) => (
        <View
          key={i}
          style={[styles.bolt, { left: b.left, top: b.top, width: bolt, height: bolt, borderRadius: bolt / 2, backgroundColor: withAlpha(accent, 0.95) }]}
        />
      ))}
      <View style={[styles.emblemCore, { width: inner, height: inner, borderRadius: inner / 2 }]}>
        <LinearGradient colors={gradients.holo} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Ionicons name="diamond" size={Math.round(inner * 0.46)} color={colors.textOnLight} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pack body
// ---------------------------------------------------------------------------

/** Hard-stop gradient that draws vertical ridges: a crimped foil seal in one native view. */
function crimpGradient(stripes: number): { colors: GradientColors; locations: number[] } {
  const stops: string[] = [];
  const locations: number[] = [];
  const light = 'rgba(255, 255, 255, 0.22)';
  const dark = 'rgba(0, 0, 0, 0.22)';
  for (let i = 0; i < stripes; i++) {
    const a = i / stripes;
    const m = (i + 0.5) / stripes;
    const b = (i + 1) / stripes;
    stops.push(light, light, dark, dark);
    locations.push(a, m, m, b);
  }
  return { colors: stops as unknown as GradientColors, locations };
}

function Crimp({ width, height, edge }: { width: number; height: number; edge: 'top' | 'bottom' }) {
  const gradient = useMemo(() => crimpGradient(Math.max(8, Math.round(width / 7))), [width]);
  return (
    <View style={[styles.crimp, edge === 'top' ? styles.crimpTop : styles.crimpBottom, { height }]} pointerEvents="none">
      <LinearGradient
        colors={gradient.colors}
        locations={gradient.locations}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.crimpEdge, edge === 'top' ? styles.crimpEdgeTop : styles.crimpEdgeBottom]} />
    </View>
  );
}

/** Diagonal foil highlight, optionally sweeping across the pack on a loop. */
function Sheen({ width, height, animated }: { width: number; height: number; animated: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(400 + Math.round(Math.random() * 1200)),
        Animated.timing(progress, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(1400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, progress]);

  const band = width * 0.42;
  const translateX = animated
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [-band * 1.8, width + band * 0.8] })
    : width * 0.18;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.sheen, { width: band, top: -height * 0.2, height: height * 1.4, transform: [{ translateX }, { rotate: '18deg' }] }]}
    >
      <LinearGradient
        colors={[WHITE_0, 'rgba(255, 255, 255, 0.34)', WHITE_0]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export interface PackBodyProps {
  name: string;
  theme: PackTheme;
  /** Width in points; height is width * PACK_ASPECT. */
  width: number;
  pricePence?: number;
  soldOut?: boolean;
  /** Animate the foil sheen (default true). */
  shimmer?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PackBody({ name, theme: rawTheme, width, pricePence, soldOut = false, shimmer = true, style }: PackBodyProps) {
  const theme = safePackTheme(rawTheme);
  const height = packBodyHeight(width);
  const radius = Math.max(6, Math.round(width * 0.055));
  const crimpHeight = Math.max(6, Math.round(width * 0.075));
  const compact = width < COMPACT_WIDTH;
  const brandSize = Math.max(9, Math.round(width * 0.052));

  return (
    <View
      style={[styles.body, { width, height, borderRadius: radius, borderColor: withAlpha(theme.accent, 0.55) }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <LinearGradient colors={[theme.from, theme.to]} start={{ x: 0, y: 0 }} end={{ x: 0.85, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* Holo wash + a soft light falling from the top. */}
      <LinearGradient
        colors={[withAlpha(theme.accent, 0.3), WHITE_0, withAlpha(theme.accent, 0.2)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(255, 255, 255, 0.16)', WHITE_0]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.45 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Folded-foil edges. */}
      <LinearGradient
        colors={['rgba(255, 255, 255, 0.24)', WHITE_0]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.edge, styles.edgeLeft, { width: width * 0.1 }]}
      />
      <LinearGradient
        colors={[WHITE_0, 'rgba(0, 0, 0, 0.28)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.edge, styles.edgeRight, { width: width * 0.12 }]}
      />

      <Crimp width={width} height={crimpHeight} edge="top" />
      <Crimp width={width} height={crimpHeight} edge="bottom" />

      <View style={[styles.content, { paddingTop: crimpHeight + width * 0.05, paddingBottom: crimpHeight + width * 0.04, paddingHorizontal: width * 0.07 }]}>
        {!compact ? (
          <View style={styles.brandRow}>
            <Ionicons name="diamond" size={brandSize} color={colors.gold} />
            <AppText variant="label" size={brandSize} color={colors.text} style={[styles.brandText, { letterSpacing: brandSize * 0.32 }]}>
              RIP
            </AppText>
            <AppText variant="label" size={brandSize} color={colors.gold} style={{ letterSpacing: brandSize * 0.32 }}>
              VAULT
            </AppText>
          </View>
        ) : null}

        <View style={styles.emblemWrap}>
          <VaultEmblem size={Math.round(width * (compact ? 0.62 : 0.44))} accent={theme.accent} />
        </View>

        {!compact ? (
          <>
            <AppText
              variant="heading"
              size={Math.max(13, Math.round(width * 0.088))}
              weight="900"
              align="center"
              numberOfLines={2}
              adjustsFontSizeToFit
              style={styles.name}
            >
              {name.toUpperCase()}
            </AppText>
            <View style={styles.bottomRow}>
              <AppText variant="label" size={Math.max(8, Math.round(width * 0.04))} color={withAlpha(colors.text, 0.82)}>
                1 real card
              </AppText>
              {pricePence !== undefined ? (
                <View style={[styles.priceTag, { paddingHorizontal: width * 0.035 }]}>
                  <LinearGradient colors={gradients.gold} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <AppText variant="money" size={Math.max(10, Math.round(width * 0.058))} color={colors.textOnLight}>
                    {formatPence(pricePence, { trimWholePounds: true })}
                  </AppText>
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </View>

      <Sheen width={width} height={height} animated={shimmer} />

      {soldOut ? (
        <>
          <View style={[StyleSheet.absoluteFill, styles.soldOutDim]} pointerEvents="none" />
          <View
            pointerEvents="none"
            style={[
              styles.ribbon,
              { width: width * 1.5, left: -width * 0.25, top: height * 0.46, height: Math.max(20, width * 0.13) },
            ]}
          >
            <AppText variant="label" size={Math.max(9, Math.round(width * 0.06))} weight="900" color={colors.text} style={styles.ribbonText}>
              Sold out
            </AppText>
          </View>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pack art (pack + fanned featured cards)
// ---------------------------------------------------------------------------

export interface PackArtProps {
  name: string;
  theme: PackTheme;
  /** Pack body width in points. Total height: packArtHeight(width, hasCards). */
  width: number;
  featuredCards?: readonly CardSummary[];
  pricePence?: number;
  soldOut?: boolean;
  shimmer?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PackArt({ name, theme, width, featuredCards = [], pricePence, soldOut, shimmer = true, style }: PackArtProps) {
  const cards = featuredCards.slice(0, 3);
  const withCards = cards.length > 0;
  const overhang = withCards ? fanOverhang(width) : 0;
  const cardWidth = Math.round(width * FAN_CARD_RATIO);
  const baseLeft = (width - cardWidth) / 2;
  const top = Math.round(width * 0.03);
  // Highest value in the middle (on top), the next two fanned to either side.
  const fan = [
    cards[1] ? { card: cards[1], left: baseLeft - width * 0.25, top: top + width * 0.07, rotate: '-14deg' } : null,
    cards[2] ? { card: cards[2], left: baseLeft + width * 0.25, top: top + width * 0.07, rotate: '14deg' } : null,
    cards[0] ? { card: cards[0], left: baseLeft, top, rotate: '0deg' } : null,
  ];

  return (
    <View
      style={[{ width, height: packArtHeight(width, withCards) }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {fan.map((slot) =>
        slot ? (
          <View key={slot.card.id} style={[styles.fanCard, { left: slot.left, top: slot.top, transform: [{ rotate: slot.rotate }] }]}>
            <CardArt card={slot.card} width={cardWidth} highRes={false} />
          </View>
        ) : null,
      )}
      <View style={[styles.bodyShadow, { top: overhang, borderRadius: Math.max(6, Math.round(width * 0.055)) }]}>
        <PackBody name={name} theme={theme} width={width} pricePence={pricePence} soldOut={soldOut} shimmer={shimmer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  bodyShadow: {
    position: 'absolute',
    left: 0,
    backgroundColor: colors.surface,
    ...shadows.raised,
  },
  fanCard: { position: 'absolute' },
  edge: { position: 'absolute', top: 0, bottom: 0 },
  edgeLeft: { left: 0 },
  edgeRight: { right: 0 },
  crimp: { position: 'absolute', left: 0, right: 0 },
  crimpTop: { top: 0 },
  crimpBottom: { bottom: 0 },
  crimpEdge: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: 'rgba(0, 0, 0, 0.35)' },
  crimpEdgeTop: { bottom: 0 },
  crimpEdgeBottom: { top: 0 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brandText: { marginLeft: 5 },
  emblemWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emblem: { alignItems: 'center', justifyContent: 'center' },
  emblemCore: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  bolt: { position: 'absolute' },
  name: {
    letterSpacing: 1,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
    marginTop: 6,
    marginBottom: 6,
  },
  bottomRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priceTag: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingVertical: 2,
  },
  sheen: { position: 'absolute', left: 0 },
  soldOutDim: { backgroundColor: 'rgba(7, 6, 26, 0.5)' },
  ribbon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    transform: [{ rotate: '-16deg' }],
    ...shadows.card,
  },
  ribbonText: { letterSpacing: 4 },
});
