import { StyleSheet, View } from 'react-native';
import { formatPence, pullOutcome } from '@ripvault/shared';
import type { Pull } from '@ripvault/shared';
import { colors, radii, spacing, tierColors, tierLabels, tierRank, withAlpha } from '../../theme.ts';
import { AppText, Button, CardArt, MoneyText, Pill } from '../../components/index.ts';
import { OutcomeBadge } from './OutcomeBadge.tsx';
import type { PullRowState } from './packData.ts';

export interface PullRowProps {
  pull: Pull;
  state: PullRowState;
  packPricePence: number;
  /** Another sale is in flight: sell/keep buttons are paused. */
  busy?: boolean;
  onSell: () => void;
  onKeep: () => void;
}

/** One pulled card in the rip summary, with "Sell £X" / "Keep" (or its sold / kept state). */
export function PullRow({ pull, state, packPricePence, busy = false, onSell, onKeep }: PullRowProps) {
  const { card } = pull;
  const tierColor = tierColors[card.tier];
  const outcome = pullOutcome(pull.valuePence, packPricePence);
  const sold = state.status === 'sold';
  const gone = state.status === 'gone';
  const selling = state.status === 'selling';
  const sellLabel = `Sell ${formatPence(pull.buybackPence)}`;

  return (
    <View
      style={[
        styles.row,
        tierRank[card.tier] >= tierRank.epic && !sold && !gone ? { borderColor: withAlpha(tierColor, 0.7) } : null,
        sold || gone ? styles.rowDone : null,
      ]}
    >
      <View style={styles.top}>
        <CardArt card={card} size="xs" glow={false} dimmed={sold || gone} />
        <View style={styles.middle}>
          <AppText variant="body" weight="700" numberOfLines={1}>
            {card.name}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {card.setName} · {tierLabels[card.tier]}
          </AppText>
          {outcome !== 'loss' ? <OutcomeBadge outcome={outcome} tier={card.tier} size="sm" animated={false} style={styles.badge} /> : null}
        </View>
        <View style={styles.value}>
          <MoneyText pence={pull.valuePence} size={17} align="right" tone={sold || gone ? 'muted' : 'default'} />
          <AppText variant="caption" tone="faint" size={11} align="right">
            market value
          </AppText>
        </View>
      </View>

      <View style={styles.actions}>
        {sold ? (
          <Pill
            label={`Sold for ${formatPence(state.soldForPence ?? pull.buybackPence)}`}
            color={colors.textMuted}
            icon="checkmark"
            size="md"
          />
        ) : gone ? (
          <Pill label={state.goneLabel ?? 'Left the vault'} color={colors.info} icon="paper-plane-outline" size="md" />
        ) : state.status === 'kept' ? (
          <>
            <Pill label="In your vault" color={colors.success} icon="lock-closed" size="md" />
            <Button
              title={sellLabel}
              variant="ghost"
              size="sm"
              onPress={onSell}
              disabled={busy}
              accessibilityLabel={`Sell ${card.name} back for ${formatPence(pull.buybackPence)}`}
            />
          </>
        ) : (
          <>
            <Button
              title={sellLabel}
              variant="secondary"
              size="sm"
              icon="cash-outline"
              onPress={onSell}
              loading={selling}
              disabled={busy && !selling}
              style={styles.actionButton}
              accessibilityLabel={`Sell ${card.name} back for ${formatPence(pull.buybackPence)}`}
            />
            <Button
              title="Keep"
              variant="secondary"
              size="sm"
              icon="lock-closed-outline"
              onPress={onKeep}
              disabled={busy || selling}
              style={styles.actionButton}
              accessibilityLabel={`Keep ${card.name} in your vault`}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowDone: { backgroundColor: colors.bgAlt },
  top: { flexDirection: 'row', alignItems: 'center' },
  middle: { flex: 1, minWidth: 0, marginLeft: spacing.md },
  badge: { alignSelf: 'flex-start', marginTop: 6 },
  value: { marginLeft: spacing.sm, alignItems: 'flex-end' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    minHeight: 44,
  },
  actionButton: { flex: 1, marginHorizontal: spacing.xs },
});
