/**
 * Shared pieces for the sign-in / register screens: the decorative hero and the safer-play footer.
 */
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { CARD_ASPECT, colors, glow, gradients, radii, spacing, tierColors } from '../theme.ts';
import { SUPPORT_LINKS } from '../config.ts';
import { AppText } from './AppText.tsx';
import { Wordmark } from './AppHeader.tsx';

const FAN = [
  { tier: 'epic' as const, rotate: '-12deg', x: -54, y: 10 },
  { tier: 'rare' as const, rotate: '12deg', x: 54, y: 10 },
  { tier: 'legendary' as const, rotate: '0deg', x: 0, y: 0 },
];

/** Fanned card silhouettes in tier colours + the large wordmark + tagline. Purely decorative. */
export function AuthHero({ tagline }: { tagline: string }) {
  const width = 74;
  const height = Math.round(width * CARD_ASPECT);
  return (
    <View style={styles.hero}>
      <View style={[styles.fan, { height: height + 24 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {FAN.map((c) => (
          <View
            key={c.tier}
            style={[
              styles.card,
              glow(tierColors[c.tier], c.tier === 'legendary' ? 'strong' : 'soft'),
              {
                width,
                height,
                borderColor: tierColors[c.tier],
                transform: [{ translateX: c.x }, { translateY: c.y }, { rotate: c.rotate }],
              },
            ]}
          >
            <LinearGradient
              colors={c.tier === 'legendary' ? gradients.holo : gradients.surface}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, styles.cardFill]}
            />
            <Ionicons
              name={c.tier === 'legendary' ? 'sparkles' : 'diamond-outline'}
              size={c.tier === 'legendary' ? 30 : 22}
              color={c.tier === 'legendary' ? colors.textOnLight : tierColors[c.tier]}
            />
          </View>
        ))}
      </View>
      <Wordmark size="lg" />
      <AppText variant="body" tone="muted" align="center" style={styles.tagline}>
        {tagline}
      </AppText>
    </View>
  );
}

/** "18+ only · Play responsibly" with a BeGambleAware link. */
export function SaferPlayFooter() {
  return (
    <View style={styles.footer}>
      <View style={styles.ageBadge}>
        <AppText variant="label" size={11} color={colors.text}>
          18+
        </AppText>
      </View>
      <AppText variant="caption" tone="faint" align="center">
        Play responsibly. Set limits any time in Profile.{' '}
        <AppText
          variant="caption"
          color={colors.textMuted}
          style={styles.link}
          accessibilityRole="link"
          onPress={() => {
            void WebBrowser.openBrowserAsync(SUPPORT_LINKS.beGambleAware);
          }}
        >
          BeGambleAware.org
        </AppText>
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl },
  fan: { width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  card: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: radii.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  cardFill: { borderRadius: radii.xs - 2 },
  tagline: { marginTop: spacing.sm, maxWidth: 300 },
  footer: { alignItems: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  ageBadge: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: spacing.sm,
  },
  link: { textDecorationLine: 'underline' },
});
