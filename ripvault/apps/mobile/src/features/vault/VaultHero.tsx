import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { formatPence } from '@ripvault/shared';
import { colors, gradients, radii, spacing, withAlpha } from '../../theme.ts';
import { AppText, MoneyText, Skeleton } from '../../components/index.ts';
import { plural } from '../../lib/format.ts';
import { formatBps } from './format.ts';
import { ChipButton } from './components.tsx';

export interface VaultHeroProps {
  /** Undefined while the vault is loading. */
  totalValuePence: number | undefined;
  totalBuybackPence: number | undefined;
  cardCount: number | undefined;
  buybackBps: number;
  onShipments: () => void;
}

/** "Vault value" + "Instant sell-back" summary at the top of the Vault tab. */
export function VaultHero({ totalValuePence, totalBuybackPence, cardCount, buybackBps, onShipments }: VaultHeroProps) {
  const loaded = totalValuePence !== undefined && totalBuybackPence !== undefined && cardCount !== undefined;
  return (
    <View style={styles.card}>
      <LinearGradient colors={gradients.surface} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <LinearGradient
        colors={[withAlpha(colors.gold, 0.2), withAlpha(colors.gold, 0)]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.35, y: 0.75 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.topRow}>
        <AppText variant="label">Vault value</AppText>
        <ChipButton label="Shipments" icon="paper-plane-outline" iconRight="chevron-forward" onPress={onShipments} accessibilityHint="Opens your shipments" />
      </View>

      {loaded ? (
        <>
          <MoneyText pence={totalValuePence} variant="display" size={38} adjustsFontSizeToFit accessibilityLabel={`Vault value ${formatPence(totalValuePence)}`} style={styles.total} />
          <AppText variant="caption" tone="muted">
            {cardCount === 0 ? 'No cards in your vault yet' : `${plural(cardCount, 'card')} in your vault, at live market value`}
          </AppText>
        </>
      ) : (
        <>
          <Skeleton width={180} height={40} style={styles.total} />
          <Skeleton width={140} height={12} />
        </>
      )}

      <View style={styles.divider} />

      <View style={styles.buybackRow}>
        <View style={styles.bolt}>
          <Ionicons name="flash" size={16} color={colors.textOnLight} />
        </View>
        <View style={styles.buybackText}>
          <AppText variant="label">Instant sell-back</AppText>
          <AppText variant="caption" tone="faint" numberOfLines={2}>
            {formatBps(buybackBps)} of market value, credited instantly
          </AppText>
        </View>
        {loaded ? (
          <MoneyText pence={totalBuybackPence} size={22} color={colors.gold} accessibilityLabel={`Instant sell-back ${formatPence(totalBuybackPence)}`} />
        ) : (
          <Skeleton width={84} height={22} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg + 4,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { marginTop: spacing.sm, marginBottom: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginVertical: spacing.lg },
  buybackRow: { flexDirection: 'row', alignItems: 'center' },
  bolt: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  buybackText: { flex: 1, minWidth: 0, marginRight: spacing.md },
});
