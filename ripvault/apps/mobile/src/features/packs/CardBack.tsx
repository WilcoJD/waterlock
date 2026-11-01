import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CARD_ASPECT, colors, gradients, withAlpha } from '../../theme.ts';
import { AppText } from '../../components/index.ts';
import { VaultEmblem } from './PackArt.tsx';

export interface CardBackProps {
  /** Width in points; height follows real card proportions. */
  width: number;
  /** Accent for the frame and emblem (default gold). */
  accent?: string;
}

/** The RipVault card back: deep violet foil, gold frame, vault emblem. Same size/radius as CardArt. */
export function CardBack({ width, accent = colors.gold }: CardBackProps) {
  const height = Math.round(width * CARD_ASPECT);
  const radius = Math.max(4, Math.round(width * 0.055));
  const inset = Math.max(4, Math.round(width * 0.05));
  const brand = Math.max(8, Math.round(width * 0.055));
  return (
    <View
      style={[styles.card, { width, height, borderRadius: radius, borderColor: withAlpha(accent, 0.85) }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <LinearGradient
        colors={[colors.violetDeep, colors.bgTop, colors.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[withAlpha(gradients.holo[0], 0.2), withAlpha(gradients.holo[1], 0.04), withAlpha(gradients.holo[2], 0.22)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.frame,
          { top: inset, left: inset, right: inset, bottom: inset, borderRadius: Math.max(2, radius - inset / 2), borderColor: withAlpha(accent, 0.45) },
        ]}
      >
        <VaultEmblem size={Math.round(width * 0.52)} accent={accent} />
        {width >= 90 ? (
          <View style={styles.brandRow}>
            <AppText variant="label" size={brand} color={colors.text} style={{ letterSpacing: brand * 0.4 }}>
              RIP
            </AppText>
            <AppText variant="label" size={brand} color={accent} style={{ letterSpacing: brand * 0.4 }}>
              VAULT
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: 2,
    backgroundColor: colors.bgTop,
  },
  frame: {
    position: 'absolute',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandRow: { flexDirection: 'row', marginTop: 14 },
});
