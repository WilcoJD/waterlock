import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PackSummary } from '@ripvault/shared';
import { colors, radii, spacing, withAlpha } from '../../theme.ts';
import { AppText, Button, MoneyText, Pill, SectionHeader } from '../../components/index.ts';
import { PackBody } from './PackArt.tsx';
import { PackStatRow } from './PackStats.tsx';
import { safePackTheme } from './packData.ts';

export interface OddsHeaderProps {
  pack: PackSummary;
  onOpenFairness: () => void;
}

/** Top of the odds sheet: mini pack + price, summary stats (no EV), and the provably-fair note. */
export function OddsHeader({ pack, onOpenFairness }: OddsHeaderProps) {
  const theme = safePackTheme(pack.theme);
  return (
    <View>
      <View style={styles.hero}>
        <View style={[styles.mini, { shadowColor: theme.accent }]}>
          <PackBody name={pack.name} theme={theme} width={78} soldOut={pack.soldOut} />
        </View>
        <View style={styles.heroText}>
          <AppText variant="title" size={24} numberOfLines={2}>
            {pack.name}
          </AppText>
          {pack.tagline ? (
            <AppText variant="caption" tone="muted" numberOfLines={3} style={styles.tagline}>
              {pack.tagline}
            </AppText>
          ) : null}
          <View style={styles.priceRow}>
            <MoneyText pence={pack.pricePence} size={22} tone="gold" />
            <AppText variant="caption" tone="muted" style={styles.perPack}>
              per pack · 1 card
            </AppText>
          </View>
          {pack.soldOut ? <Pill label="Sold out" color={colors.danger} icon="close-circle" size="md" style={styles.soldOut} /> : null}
        </View>
      </View>

      <PackStatRow
        minPullPence={pack.minPullPence}
        maxPullPence={pack.maxPullPence}
        hitChance={pack.hitChance}
        cardCount={pack.cardCount}
        style={styles.stats}
      />

      <View style={styles.fair}>
        <View style={styles.fairIcon}>
          <Ionicons name="shield-checkmark" size={20} color={colors.violet} />
        </View>
        <View style={styles.fairText}>
          <AppText variant="body" weight="700">
            Provably fair draws
          </AppText>
          <AppText variant="caption" tone="muted" style={styles.fairBody}>
            Each pull is decided by your server seed (its hash is shown before you rip), your client seed and a nonce,
            using exactly these odds. You can verify every result.
          </AppText>
          <Button title="How it works" variant="ghost" size="sm" iconRight="chevron-forward" onPress={onOpenFairness} style={styles.fairLink} />
        </View>
      </View>

      <SectionHeader title="Every card in this pack" style={styles.listTitle} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm },
  mini: {
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  heroText: { flex: 1, marginLeft: spacing.lg },
  tagline: { marginTop: spacing.xs },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.sm },
  perPack: { marginLeft: spacing.sm },
  soldOut: { marginTop: spacing.sm },
  stats: { marginTop: spacing.xl },
  fair: {
    flexDirection: 'row',
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.violetSoft,
    borderWidth: 1,
    borderColor: withAlpha(colors.violet, 0.35),
  },
  fairIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.violet, 0.2),
  },
  fairText: { flex: 1, marginLeft: spacing.md },
  fairBody: { marginTop: spacing.xs },
  fairLink: { marginTop: spacing.xs, marginLeft: -spacing.md },
  listTitle: { marginTop: spacing.xl, marginBottom: 0 },
});
