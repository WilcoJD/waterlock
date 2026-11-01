/**
 * After the reveal: what was pulled vs what it cost, every card with Sell / Keep, the fairness
 * footnote, and the footer actions (sell all, ship, rip again, done).
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPence, pullOutcome } from '@ripvault/shared';
import type { OpenPackResponse, Pull } from '@ripvault/shared';
import { colors, radii, spacing, withAlpha } from '../../theme.ts';
import { AppText, Button, CardArt, MoneyText, Panel, Pill, SectionHeader } from '../../components/index.ts';
import { plural, shortHash } from '../../lib/format.ts';
import { CountUpMoney } from './CountUpMoney.tsx';
import { PullRow } from './PullRow.tsx';
import { bestFirst, nonceRange, pullTotals } from './packData.ts';
import type { PullRowState } from './packData.ts';

export interface RipSummaryProps {
  result: OpenPackResponse;
  rows: Readonly<Record<string, PullRowState>>;
  selling: boolean;
  /** "90%" style label of the buyback rate. */
  buybackLabel: string;
  onSell: (pull: Pull) => void;
  onKeep: (pull: Pull) => void;
  onOpenHistory: () => void;
}

export function RipSummary({ result, rows, selling, buybackLabel, onSell, onKeep, onOpenHistory }: RipSummaryProps) {
  const pulls = useMemo(() => bestFirst(result.pulls), [result.pulls]);
  const totals = pullTotals(result.pulls, rows);
  const net = totals.totalValuePence - result.totalCostPence;
  const best = pulls[0];
  const bigHits = result.pulls.filter((p) => pullOutcome(p.valuePence, result.pack.pricePence) === 'big_win').length;
  const hits = result.pulls.filter((p) => pullOutcome(p.valuePence, result.pack.pricePence) !== 'loss').length;

  return (
    <View>
      <Panel raised style={styles.hero} glowColor={net >= 0 ? colors.gold : undefined}>
        <AppText variant="label" tone="gold" align="center">
          Rip complete · {plural(result.quantity, 'pack')}
        </AppText>
        <CountUpMoney
          pence={totals.totalValuePence}
          variant="display"
          size={46}
          align="center"
          durationMs={1100}
          adjustsFontSizeToFit
          style={styles.heroValue}
        />
        <AppText variant="caption" tone="muted" align="center">
          market value pulled for <AppText variant="caption" weight="800" color={colors.text}>{formatPence(result.totalCostPence)}</AppText>
        </AppText>
        <View style={styles.heroPills}>
          <Pill
            label={`${net >= 0 ? '+' : '−'}${formatPence(Math.abs(net))} vs cost`}
            color={net >= 0 ? colors.success : colors.textMuted}
            icon={net >= 0 ? 'trending-up' : 'trending-down'}
            size="md"
          />
          {bigHits > 0 ? (
            <Pill label={bigHits === 1 ? 'Big hit' : `${bigHits} big hits`} color={colors.gold} icon="sparkles" size="md" style={styles.pillGap} />
          ) : hits > 0 ? (
            <Pill label={hits === 1 ? '1 hit' : `${hits} hits`} color={colors.success} icon="flash" size="md" style={styles.pillGap} />
          ) : null}
        </View>

        {pulls.length > 1 ? (
          <View style={styles.fan} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {pulls.slice(0, 5).map((p, i, arr) => {
              const mid = (arr.length - 1) / 2;
              const offset = i - mid;
              return (
                <View
                  key={p.inventoryItemId}
                  style={[
                    styles.fanCard,
                    { zIndex: arr.length - Math.abs(Math.round(offset)), transform: [{ translateX: offset * 40 }, { translateY: Math.abs(offset) * 8 }, { rotate: `${offset * 7}deg` }] },
                  ]}
                >
                  <CardArt card={p.card} size="sm" />
                </View>
              );
            })}
          </View>
        ) : best ? (
          <View style={styles.single}>
            <CardArt card={best.card} size="md" showValue valuePence={best.valuePence} />
          </View>
        ) : null}

        <View style={styles.offerRow}>
          <Ionicons name="cash-outline" size={16} color={colors.textMuted} />
          <AppText variant="caption" tone="muted" style={styles.offerText}>
            Instant sell-back for everything: <AppText variant="caption" weight="800" color={colors.text}>{formatPence(totals.totalBuybackPence)}</AppText> ({buybackLabel} of market value)
          </AppText>
        </View>
      </Panel>

      {totals.soldCount > 0 ? (
        <View style={styles.creditBanner} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <AppText variant="caption" color={colors.text} style={styles.creditText}>
            Sold {plural(totals.soldCount, 'card')} · <AppText variant="caption" weight="800" color={colors.success}>{formatPence(totals.soldPence)}</AppText> added to your balance
          </AppText>
        </View>
      ) : null}

      <SectionHeader title="Your pulls" style={styles.sectionHeader} />
      {pulls.map((pull) => (
        <PullRow
          key={pull.inventoryItemId}
          pull={pull}
          state={rows[pull.inventoryItemId] ?? { status: 'new' }}
          packPricePence={result.pack.pricePence}
          busy={selling}
          onSell={() => onSell(pull)}
          onKeep={() => onKeep(pull)}
        />
      ))}
      <AppText variant="caption" tone="faint" style={styles.vaultNote}>
        Every card is already in your vault. Keep it, sell it back any time, or ship it home.
      </AppText>

      <FairnessFootnote result={result} onOpenHistory={onOpenHistory} />
    </View>
  );
}

function FairnessFootnote({ result, onOpenHistory }: { result: OpenPackResponse; onOpenHistory: () => void }) {
  return (
    <View style={styles.fairness}>
      <View style={styles.fairnessHead}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.violet} />
        <AppText variant="label" color={colors.text} style={styles.fairnessTitle}>
          Provably fair
        </AppText>
      </View>
      <AppText variant="caption" tone="muted" selectable>
        Server seed hash {shortHash(result.fairness.serverSeedHash, 8, 6)} · client seed {shortHash(result.fairness.clientSeed, 6, 4)} ·
        nonce {nonceRange(result.pulls)}
      </AppText>
      <AppText variant="caption" tone="faint" style={styles.fairnessBody}>
        Rotate your seed to reveal the server seed, then verify each pull yourself.
      </AppText>
      <Button title="Verify in history" variant="ghost" size="sm" iconRight="chevron-forward" onPress={onOpenHistory} style={styles.fairnessLink} />
    </View>
  );
}

export interface RipSummaryFooterProps {
  result: OpenPackResponse;
  rows: Readonly<Record<string, PullRowState>>;
  selling: boolean;
  onSellAll: (pulls: Pull[], totalPence: number) => void;
  onShip: (itemIds: string[]) => void;
  onRipAgain: () => void;
  onDone: () => void;
}

export function RipSummaryFooter({ result, rows, selling, onSellAll, onShip, onRipAgain, onDone }: RipSummaryFooterProps) {
  const totals = pullTotals(result.pulls, rows);
  const sellable = result.pulls.filter((p) => totals.sellableIds.includes(p.inventoryItemId));
  // While a multi-card sale is in flight its rows are "selling": keep the button (with a spinner).
  const inFlight = result.pulls.filter((p) => rows[p.inventoryItemId]?.status === 'selling');
  const bulkInFlight = inFlight.length > 1;
  const sellTargets = bulkInFlight ? inFlight : sellable;
  const sellTotal = sellTargets.reduce((sum, p) => sum + p.buybackPence, 0);
  const canSell = sellTargets.length > 0;
  const canShip = totals.shippableIds.length > 0;
  const sellTitle =
    result.pulls.length === 1
      ? `Sell for ${formatPence(sellTotal)}`
      : sellTargets.length === result.pulls.length
        ? `Sell all for ${formatPence(sellTotal)}`
        : `Sell ${sellTargets.length} for ${formatPence(sellTotal)}`;
  return (
    <View>
      {canSell || canShip ? (
        <View style={styles.footerRow}>
          {canSell ? (
            <Button
              title={sellTitle}
              variant="secondary"
              size="md"
              icon="cash-outline"
              loading={bulkInFlight}
              disabled={selling}
              onPress={() => onSellAll(sellable, totals.sellablePence)}
              style={styles.footerButton}
              accessibilityLabel={`Sell ${plural(sellTargets.length, 'card')} back for ${formatPence(sellTotal)}`}
            />
          ) : null}
          {canShip ? (
            <Button
              title="Ship"
              variant="secondary"
              size="md"
              icon="paper-plane-outline"
              disabled={selling}
              onPress={() => onShip(totals.shippableIds)}
              style={canSell ? styles.shipButton : styles.footerButton}
              accessibilityLabel={`Ship ${plural(totals.shippableIds.length, 'card')} home`}
            />
          ) : null}
        </View>
      ) : null}
      <View style={[styles.footerRow, canSell || canShip ? styles.footerRowGap : null]}>
        <Button
          title={`Rip again · ${formatPence(result.totalCostPence)}`}
          accessibilityLabel={`Rip ${plural(result.quantity, 'more pack')} for ${formatPence(result.totalCostPence)}`}
          variant="holo"
          size="lg"
          icon="flash"
          haptic="medium"
          disabled={selling}
          onPress={onRipAgain}
          style={styles.ripAgain}
        />
        <Button title="Done" variant="ghost" size="lg" onPress={onDone} style={styles.done} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { padding: spacing.xl, alignItems: 'stretch' },
  heroValue: { marginTop: spacing.sm },
  heroPills: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: spacing.md },
  pillGap: { marginLeft: spacing.sm },
  fan: { height: 170, marginTop: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  fanCard: { position: 'absolute' },
  single: { alignItems: 'center', marginTop: spacing.lg },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  offerText: { marginLeft: spacing.sm, flexShrink: 1 },
  creditBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: withAlpha(colors.success, 0.35),
  },
  creditText: { marginLeft: spacing.sm, flex: 1 },
  sectionHeader: { marginTop: spacing.xl },
  vaultNote: { marginTop: spacing.xs, textAlign: 'center' },
  fairness: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  fairnessHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  fairnessTitle: { marginLeft: spacing.sm },
  fairnessBody: { marginTop: spacing.xs },
  fairnessLink: { marginTop: spacing.sm, marginLeft: -spacing.md },
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerRowGap: { marginTop: spacing.sm },
  footerButton: { flex: 1 },
  shipButton: { marginLeft: spacing.sm },
  ripAgain: { flex: 1 },
  done: { marginLeft: spacing.sm },
});
