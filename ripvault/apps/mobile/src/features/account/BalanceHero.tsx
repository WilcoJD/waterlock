import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { formatPence } from '@ripvault/shared';
import { Ionicons } from '@expo/vector-icons';
import { colors, glow, radii, spacing, withAlpha } from '../../theme.ts';
import { AppText, Button, Coin, MoneyText, PressableScale } from '../../components/index.ts';
import { plural } from '../../lib/format.ts';

export interface BalanceHeroProps {
  balancePence: number;
  vaultValuePence: number;
  cardsInVault: number;
  /** Show the "Cash out" button (config.withdrawals.enabled). */
  canCashOut: boolean;
  onTopUp: () => void;
  onCashOut: () => void;
  onOpenVault: () => void;
}

/** Wallet tab hero: big balance, Top up / Cash out, and a link to the vault's value. */
export function BalanceHero({
  balancePence,
  vaultValuePence,
  cardsInVault,
  canCashOut,
  onTopUp,
  onCashOut,
  onOpenVault,
}: BalanceHeroProps) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.hero, glow(colors.violet, 'soft')]}>
        <LinearGradient
          colors={[withAlpha(colors.violet, 0.42), withAlpha(colors.violetDeep, 0.12)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.heroFill]}
        />
        <LinearGradient
          colors={[withAlpha(colors.gold, 0.18), withAlpha(colors.gold, 0)]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.4, y: 0.7 }}
          style={[StyleSheet.absoluteFill, styles.heroFill]}
        />
        <View style={styles.labelRow}>
          <Coin size={20} />
          <AppText variant="label" color={colors.text} style={styles.label}>
            Wallet balance
          </AppText>
        </View>
        <MoneyText
          pence={balancePence}
          variant="display"
          size={46}
          adjustsFontSizeToFit
          accessibilityLabel={`Wallet balance ${formatPence(balancePence)}`}
          style={styles.balance}
        />
        <AppText variant="caption" tone="muted">
          Rips are paid from here. Sell-backs land here instantly.
        </AppText>
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button title="Top up" icon="add" variant="holo" block onPress={onTopUp} accessibilityHint="Add funds to your balance" />
          </View>
          {canCashOut ? (
            <View style={[styles.action, styles.actionGap]}>
              <Button
                title="Cash out"
                icon="arrow-up"
                variant="secondary"
                block
                onPress={onCashOut}
                accessibilityHint="Withdraw your balance"
              />
            </View>
          ) : null}
        </View>
      </View>

      <PressableScale
        onPress={onOpenVault}
        haptic="tap"
        scaleTo={0.98}
        accessibilityLabel={`Your vault: ${plural(cardsInVault, 'card')}, worth ${formatPence(vaultValuePence)}`}
        style={styles.vaultLink}
      >
        <View style={styles.vaultIcon}>
          <Ionicons name="cube" size={16} color={colors.gold} />
        </View>
        <View style={styles.vaultText}>
          <AppText variant="caption" tone="muted">
            In your vault · {plural(cardsInVault, 'card')}
          </AppText>
        </View>
        <MoneyText pence={vaultValuePence} size={16} />
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} style={styles.chevron} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.xl },
  hero: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: withAlpha(colors.violet, 0.5),
    backgroundColor: colors.surface,
    padding: spacing.xl,
  },
  heroFill: { borderRadius: radii.xl },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
  label: { marginLeft: spacing.sm },
  balance: { marginTop: spacing.md, marginBottom: spacing.xs },
  actions: { flexDirection: 'row', marginTop: spacing.xl },
  action: { flex: 1 },
  actionGap: { marginLeft: spacing.md },
  vaultLink: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  vaultIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
    marginRight: spacing.md,
  },
  vaultText: { flex: 1 },
  chevron: { marginLeft: spacing.sm },
});
