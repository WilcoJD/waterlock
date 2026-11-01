/**
 * Verify one opening on the device: GET /openings/:id/verify gives the opening and its immutable
 * odds table; once the server seed is revealed we recompute hash, roll and card with the shared
 * verifyPull() (the same code the API used to draw) and show the result and where the roll landed.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { canonicalEntries, formatChance, formatPence } from '@ripvault/shared';
import type { VerifyOpeningResponse } from '@ripvault/shared';
import { verifyOpening } from '../../src/api/client.ts';
import { useQuery } from '../../src/hooks/useQuery.ts';
import { colors, radii, spacing, tierColors, withAlpha } from '../../src/theme.ts';
import { haptic } from '../../src/lib/haptics.ts';
import { formatDateTime } from '../../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  Button,
  CardArt,
  ErrorState,
  LoadingState,
  MoneyText,
  Panel,
  Screen,
  SectionHeader,
  TierBadge,
} from '../../src/components/index.ts';
import { formatCount, formatRoll } from '../../src/features/account/format.ts';
import { oddsRangeFor, verifyOpeningLocally } from '../../src/features/account/verification.ts';
import type { OddsRange, VerifyOutcome } from '../../src/features/account/verification.ts';
import { RangeBar } from '../../src/features/account/RangeBar.tsx';
import { CopyField, MonoText, Note } from '../../src/features/account/ui.tsx';

export default function VerifyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const openingId = typeof id === 'string' ? id : '';
  const q = useQuery(() => verifyOpening(openingId), [openingId], { enabled: openingId !== '', refetchOnFocus: true });

  const outcome = useMemo<VerifyOutcome | null>(
    () => (q.data ? verifyOpeningLocally(q.data.opening, q.data.entries) : null),
    [q.data],
  );

  const status = outcome?.status;
  useEffect(() => {
    if (status === 'verified') haptic.success();
    else if (status === 'mismatch' || status === 'error') haptic.error();
  }, [status]);

  const header = <AppHeader title="Verify pull" back />;

  if (!openingId) {
    return (
      <Screen header={header}>
        <ErrorState title="Pull not found" message="This link doesn't point to a pack opening." />
      </Screen>
    );
  }
  if (q.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Fetching the proof" />
      </Screen>
    );
  }
  if (!q.data || !outcome) {
    return (
      <Screen header={header}>
        <ErrorState
          error={q.error}
          title={q.error?.code === 'not_found' ? 'Pull not found' : undefined}
          onRetry={q.error?.code === 'not_found' ? undefined : () => void q.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen header={header} scroll refreshing={q.refreshing} onRefresh={() => void q.refresh()}>
      <OpeningSummary data={q.data} />
      <ResultPanel data={q.data} outcome={outcome} />
      <LandingPanel data={q.data} outcome={outcome} />
      <InputsPanel data={q.data} />
      <OddsTable data={q.data} outcome={outcome} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function OpeningSummary({ data }: { data: VerifyOpeningResponse }) {
  const { opening } = data;
  return (
    <Panel style={styles.summary}>
      <CardArt card={opening.card} size="sm" width={84} />
      <View style={styles.summaryText}>
        <AppText variant="heading" numberOfLines={2}>
          {opening.card.name}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {opening.card.setName} · #{opening.card.number}
        </AppText>
        <TierBadge tier={opening.card.tier} style={styles.tier} />
        <View style={styles.summaryValues}>
          <View>
            <AppText variant="label">Value at pull</AppText>
            <MoneyText pence={opening.valuePence} size={18} color={tierColors[opening.card.tier]} />
          </View>
          <View style={styles.summaryRight}>
            <AppText variant="label">{opening.pack.name}</AppText>
            <MoneyText pence={opening.pricePence} size={18} />
          </View>
        </View>
        <AppText variant="caption" tone="faint" style={styles.summaryDate}>
          Pulled {formatDateTime(opening.createdAt)}
        </AppText>
      </View>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function CheckLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={styles.check} accessible accessibilityLabel={`${ok ? 'Passed' : 'Failed'}: ${label}`}>
      <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={18} color={ok ? colors.success : colors.danger} />
      <AppText variant="caption" tone={ok ? 'default' : 'danger'} style={styles.checkText}>
        {label}
      </AppText>
    </View>
  );
}

function ResultPanel({ data, outcome }: { data: VerifyOpeningResponse; outcome: VerifyOutcome }) {
  const { opening } = data;

  if (outcome.status === 'pending') {
    return (
      <Panel glowColor={colors.gold} style={styles.block}>
        <View style={styles.resultHead}>
          <View style={[styles.resultIcon, { backgroundColor: colors.goldSoft, borderColor: withAlpha(colors.gold, 0.5) }]}>
            <Ionicons name="lock-closed" size={30} color={colors.gold} />
          </View>
          <AppText variant="title" size={24} align="center">
            Pending reveal
          </AppText>
          <AppText variant="body" tone="muted" align="center" style={styles.resultText}>
            This pull used your current server seed, which stays secret until you rotate your seeds. Rotate to reveal it, then
            come back here to verify.
          </AppText>
        </View>
        <Button title="Go to my seeds" icon="key-outline" variant="holo" block onPress={() => router.push('/fairness')} />
      </Panel>
    );
  }

  if (outcome.status === 'error') {
    return (
      <Panel glowColor={colors.danger} style={styles.block}>
        <View style={styles.resultHead}>
          <View style={[styles.resultIcon, { backgroundColor: colors.dangerSoft, borderColor: withAlpha(colors.danger, 0.5) }]}>
            <Ionicons name="alert" size={34} color={colors.danger} />
          </View>
          <AppText variant="title" size={24} align="center">
            Couldn't recompute
          </AppText>
          <AppText variant="body" tone="muted" align="center" style={styles.resultText}>
            {outcome.message} Please contact support with this pull's id.
          </AppText>
        </View>
        <CopyField label="Pull id" value={opening.id} />
      </Panel>
    );
  }

  const verified = outcome.status === 'verified';
  const accent = verified ? colors.success : colors.danger;
  const computedName = outcome.cardId === opening.card.id ? opening.card.name : outcome.cardId;
  return (
    <Panel glowColor={accent} style={styles.block}>
      <View style={styles.resultHead} accessibilityLiveRegion="polite">
        <View style={[styles.resultIconLg, { backgroundColor: withAlpha(accent, 0.14), borderColor: withAlpha(accent, 0.55) }]}>
          <Ionicons name={verified ? 'checkmark' : 'close'} size={52} color={accent} />
        </View>
        <AppText variant="title" align="center" color={accent}>
          {verified ? 'Result verified' : "Doesn't match"}
        </AppText>
        <AppText variant="body" tone="muted" align="center" style={styles.resultText}>
          {verified
            ? 'Recomputed on your phone: same seeds, same roll, same card.'
            : 'Recomputing this pull on your phone gave a different result. Please contact support with this pull id.'}
        </AppText>
      </View>
      <CheckLine ok={outcome.hashMatches} label="The revealed server seed matches the hash shown before you opened" />
      <CheckLine ok={outcome.rollMatches} label={`Roll ${formatRoll(outcome.roll)}${outcome.rollMatches ? ' matches' : ` differs from ${formatRoll(opening.roll)}`}`} />
      <CheckLine
        ok={outcome.cardMatches}
        label={outcome.cardMatches ? `The roll lands on ${opening.card.name}` : `The roll lands on ${computedName}, not ${opening.card.name}`}
      />
      {!verified ? <CopyField label="Pull id" value={opening.id} style={styles.fieldGap} /> : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function LandingPanel({ data, outcome }: { data: VerifyOpeningResponse; outcome: VerifyOutcome }) {
  const { opening, entries } = data;
  // Verified/mismatch: the roll we recomputed. Pending: the roll the server recorded (provable later).
  const roll = outcome.status === 'verified' || outcome.status === 'mismatch' ? outcome.roll : opening.roll;
  const range = useMemo<OddsRange | null>(() => {
    if (outcome.status === 'verified' || outcome.status === 'mismatch') return outcome.range;
    try {
      return oddsRangeFor(entries, roll);
    } catch {
      return null;
    }
  }, [outcome, entries, roll]);
  if (!range) return null;
  const cardName = range.cardId === opening.card.id ? opening.card.name : range.cardId;
  return (
    <>
      <SectionHeader title="Where the roll landed" style={styles.section} />
      <Panel>
        <AppText variant="caption" tone="muted">
          {range.entryCount} cards share {formatCount(range.totalWeight)} tickets, sorted by card id. The roll times{' '}
          {formatCount(range.totalWeight)} picks one ticket.
        </AppText>
        <RangeBar range={range} roll={roll} cardName={cardName} color={tierColors[opening.card.tier]} />
        {outcome.status === 'pending' ? (
          <AppText variant="caption" tone="faint" style={styles.fieldGapSm}>
            Based on the recorded roll. It becomes provable once the server seed is revealed.
          </AppText>
        ) : null}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------

function InputsPanel({ data }: { data: VerifyOpeningResponse }) {
  const { opening } = data;
  return (
    <>
      <SectionHeader title="Inputs" style={styles.section} />
      <Panel>
        {opening.serverSeed ? (
          <CopyField label="Server seed" value={opening.serverSeed} accent={colors.gold} />
        ) : (
          <CopyField label="Server seed" value="Not revealed yet" copyable={false} />
        )}
        <CopyField label="Server seed hash" value={opening.serverSeedHash} style={styles.fieldGapSm} />
        <CopyField label="Client seed" value={opening.clientSeed} style={styles.fieldGapSm} />
        <View style={styles.metaRow}>
          <Meta label="Nonce" value={String(opening.nonce)} />
          <Meta label="Cursor" value="0" />
          <Meta label="Odds revision" value={`#${opening.revisionId}`} />
        </View>
        <AppText variant="label" style={styles.formulaLabel}>
          Formula
        </AppText>
        <View style={styles.formula}>
          <MonoText size={12}>
            {`roll = int(HMAC_SHA256(server seed, "${opening.clientSeed}:${opening.nonce}:0")[0..13], 16) / 2^52`}
          </MonoText>
        </View>
      </Panel>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="money" size={17}>
        {value}
      </AppText>
    </View>
  );
}

// ---------------------------------------------------------------------------

function OddsTable({ data, outcome }: { data: VerifyOpeningResponse; outcome: VerifyOutcome }) {
  const [open, setOpen] = useState(false);
  const { opening, entries } = data;
  const rows = useMemo(() => {
    const sorted = canonicalEntries(entries);
    const total = sorted.reduce((sum, e) => sum + e.weight, 0);
    let start = 0;
    return sorted.map((e) => {
      const row = { ...e, start, end: start + e.weight - 1, chance: total > 0 ? e.weight / total : 0 };
      start += e.weight;
      return row;
    });
  }, [entries]);
  const hitId = outcome.status === 'verified' || outcome.status === 'mismatch' ? outcome.cardId : null;
  return (
    <>
      <SectionHeader
        title={`Odds table (${rows.length} cards)`}
        actionLabel={open ? 'Hide' : 'Show'}
        onAction={() => setOpen((o) => !o)}
        style={styles.section}
      />
      {open ? (
        <Panel padded={false} style={styles.table}>
          <View style={[styles.tableRow, styles.tableHead]}>
            <AppText variant="label" style={styles.colCard}>
              Card id
            </AppText>
            <AppText variant="label" style={styles.colTickets}>
              Tickets
            </AppText>
            <AppText variant="label" style={styles.colChance}>
              Chance
            </AppText>
          </View>
          {rows.map((r) => {
            const hit = r.cardId === hitId;
            const yours = r.cardId === opening.card.id;
            return (
              <View
                key={r.cardId}
                style={[styles.tableRow, hit ? { backgroundColor: withAlpha(colors.gold, 0.12) } : null]}
                accessible
                accessibilityLabel={`${r.cardId}${yours ? ', your card' : ''}: tickets ${r.start} to ${r.end}, ${formatChance(r.chance)}`}
              >
                <MonoText size={12} numberOfLines={1} tone={hit ? 'gold' : 'default'} style={styles.colCard}>
                  {yours ? '▸ ' : ''}
                  {r.cardId}
                </MonoText>
                <MonoText size={12} tone="muted" numberOfLines={1} style={styles.colTickets}>
                  {r.start}-{r.end}
                </MonoText>
                <AppText variant="caption" weight="700" numberOfLines={1} style={styles.colChance}>
                  {formatChance(r.chance)}
                </AppText>
              </View>
            );
          })}
        </Panel>
      ) : (
        <AppText variant="caption" tone="faint">
          The exact table used for this pull ({formatPence(opening.pricePence)} pack, revision #{opening.revisionId}). It never
          changes after a pull.
        </AppText>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', marginTop: spacing.sm },
  summaryText: { flex: 1, minWidth: 0, marginLeft: spacing.lg },
  tier: { marginTop: spacing.sm },
  summaryValues: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  summaryRight: { alignItems: 'flex-end', marginLeft: spacing.md, flexShrink: 1 },
  summaryDate: { marginTop: spacing.sm },
  block: { marginTop: spacing.lg },
  section: { marginTop: spacing.xxl },
  resultHead: { alignItems: 'center', marginBottom: spacing.lg },
  resultIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  resultIconLg: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  resultText: { marginTop: spacing.xs, maxWidth: 340 },
  check: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm },
  checkText: { flex: 1, marginLeft: spacing.sm },
  fieldGap: { marginTop: spacing.lg },
  fieldGapSm: { marginTop: spacing.md },
  metaRow: { flexDirection: 'row', marginTop: spacing.lg },
  meta: { flex: 1 },
  formulaLabel: { marginTop: spacing.lg, marginBottom: spacing.xs + 2 },
  formula: {
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgAlt,
  },
  table: { overflow: 'hidden' },
  tableHead: { backgroundColor: colors.surfaceRaised },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  colCard: { flex: 1, marginRight: spacing.sm },
  colTickets: { width: 96, textAlign: 'right' },
  colChance: { width: 64, textAlign: 'right' },
});
