/**
 * Top up (modal sheet).
 *
 * - Preset chips from config.topup.presetsPence, or a custom amount (parsePounds, min/max checked).
 * - POST /wallet/topup with one Idempotency-Key per amount (a retry of the same amount reuses it).
 *   - kind 'credited' (dev): new balance, success toast, close.
 *   - kind 'checkout' (Stripe): open Checkout in the in-app browser; when the player comes back we
 *     look for the credited ledger line (reference = paymentId) and show the result.
 * - Payments not configured -> explains; on a break (cooling off) -> explains, no form.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { router, useNavigation } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { formatPence } from '@ripvault/shared';
import { getWallet, toApiError, topUp } from '../src/api/client.ts';
import { useSession } from '../src/state/session.tsx';
import { useAppConfig } from '../src/state/config.tsx';
import { colors, radii, spacing, withAlpha } from '../src/theme.ts';
import { haptic } from '../src/lib/haptics.ts';
import { formatDateTime, formatTimeUntil } from '../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  BalancePill,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyText,
  Panel,
  Screen,
  TextField,
  useToast,
} from '../src/components/index.ts';
import { checkAmount } from '../src/features/account/format.ts';
import { accountErrorCopy } from '../src/features/account/errors.ts';
import type { ErrorCopy } from '../src/features/account/errors.ts';
import { isCoolingOff, limitLabel, remainingToday } from '../src/features/account/limits.ts';
import { useActionKey, useMountedRef } from '../src/features/account/hooks.ts';
import { ChoiceChips, Note } from '../src/features/account/ui.tsx';
import { leaveModalsTo } from '../src/features/packs/nav.ts';
import type { ChoiceOption } from '../src/features/account/ui.tsx';

type Choice = number | 'custom';

type Phase =
  | { kind: 'form' }
  | { kind: 'checkout'; paymentId: string; checkoutUrl: string; amountPence: number }
  | { kind: 'paid'; amountPence: number; balancePence: number };

const browserOptions = { toolbarColor: colors.bg, controlsColor: colors.gold, dismissButtonStyle: 'close' } as const;

export default function TopUpScreen() {
  const { user, setBalance, refreshUser } = useSession();
  const { config, loaded, error: configError, reload } = useAppConfig();
  const toast = useToast();
  const actionKey = useActionKey();
  const mounted = useMountedRef();
  const navigation = useNavigation();

  const { minPence, maxPence, presetsPence, stripeEnabled, devTopupsEnabled } = config.topup;
  const presets = useMemo(() => presetsPence.filter((p) => p >= minPence && p <= maxPence), [presetsPence, minPence, maxPence]);

  const [choice, setChoice] = useState<Choice | null>(null);
  const [custom, setCustom] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Synchronous guard: a fast double tap runs submit twice before `submitting` re-renders. */
  const submittingRef = useRef(false);
  const [failure, setFailure] = useState<ErrorCopy | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  // Fresh limits / break status for the safer-play line.
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const selected: Choice = choice ?? presets[1] ?? presets[0] ?? 'custom';
  const amount = useMemo(() => {
    if (selected !== 'custom') return { pence: selected, error: null };
    return checkAmount(custom, {
      minPence,
      maxPence,
      minMessage: `The minimum top-up is ${formatPence(minPence, { trimWholePounds: true })}`,
      maxMessage: `The maximum top-up is ${formatPence(maxPence, { trimWholePounds: true })}`,
    });
  }, [selected, custom, minPence, maxPence]);

  const chipOptions = useMemo<ChoiceOption<Choice>[]>(
    () => [
      ...presets.map((p) => ({ value: p as Choice, label: formatPence(p, { trimWholePounds: true }) })),
      { value: 'custom' as Choice, label: 'Other', icon: 'create-outline' as const },
    ],
    [presets],
  );

  // ---------------------------------------------------------------------------
  // Stripe Checkout: look for the credited ledger line when the player returns.
  // ---------------------------------------------------------------------------

  const checkPayment = useCallback(
    async (p: Extract<Phase, { kind: 'checkout' }>, silent: boolean) => {
      setChecking(true);
      if (!silent) setCheckNote(null);
      try {
        const wallet = await getWallet(null, 20);
        if (!mounted.current) return;
        setBalance(wallet.balancePence);
        const credited = wallet.transactions.some((t) => t.type === 'topup' && t.reference === p.paymentId);
        if (credited) {
          setPhase({ kind: 'paid', amountPence: p.amountPence, balancePence: wallet.balancePence });
          toast.success(`${formatPence(p.amountPence)} added to your balance`, 'Top-up complete');
        } else if (!silent) {
          setCheckNote("We haven't received this payment yet. If you've just paid, give it a few seconds and check again.");
        }
      } catch (e) {
        if (!silent && mounted.current) toast.error(e);
      } finally {
        if (mounted.current) setChecking(false);
      }
    },
    [mounted, setBalance, toast],
  );

  const openCheckout = useCallback(
    async (p: Extract<Phase, { kind: 'checkout' }>) => {
      try {
        // iOS resolves when the browser is closed; Android resolves straight away (see AppState below).
        await WebBrowser.openBrowserAsync(p.checkoutUrl, browserOptions);
      } catch {
        toast.error("Couldn't open the payment page. Please try again.");
        return;
      }
      if (mounted.current) await checkPayment(p, true);
    },
    [checkPayment, mounted, toast],
  );

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      const current = phaseRef.current;
      if (state === 'active' && current.kind === 'checkout') void checkPayment(current, true);
    });
    return () => sub.remove();
  }, [checkPayment]);

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const submit = async () => {
    if (submitting || submittingRef.current) return;
    if (amount.pence === null || amount.error) {
      setShowErrors(true);
      haptic.error();
      return;
    }
    const pence = amount.pence;
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);
    const key = actionKey.keyFor(`topup:${pence}`);
    try {
      const res = await topUp(pence, key);
      actionKey.reset();
      if (res.kind === 'credited') {
        setBalance(res.balancePence);
        toast.success(`${formatPence(pence)} added to your balance`, 'Top-up complete');
        // The sheet may already be closed (swiped down while this was in flight): then going back
        // would close whatever screen is showing now.
        if (mounted.current) router.back();
        return;
      }
      const next = { kind: 'checkout' as const, paymentId: res.paymentId, checkoutUrl: res.checkoutUrl, amountPence: pence };
      if (!mounted.current) return;
      setPhase(next);
      submittingRef.current = false;
      setSubmitting(false);
      await openCheckout(next);
    } catch (e) {
      if (!mounted.current) return;
      const err = toApiError(e);
      const copy = accountErrorCopy(err, 'topup', { coolingOffUntil: user?.limits.coolingOffUntil });
      haptic.error();
      if (copy.refreshUser) void refreshUser();
      if (err.code === 'payments_unavailable') {
        setUnavailable(true);
        void reload();
      } else if (err.code === 'cooling_off') {
        // refreshUser() above switches this screen to the break explanation.
        toast.show({ type: 'error', title: copy.title, message: copy.message });
      } else {
        setFailure(copy);
      }
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const header = <AppHeader title="Top up" back="close" right={<BalancePill hideTopUp />} />;

  if (!user || (!loaded && !configError)) {
    return (
      <Screen modal header={header}>
        <LoadingState />
      </Screen>
    );
  }
  if (!loaded && configError) {
    return (
      <Screen modal header={header}>
        <ErrorState error={configError} onRetry={() => void reload()} />
      </Screen>
    );
  }

  if (phase.kind === 'paid') {
    return (
      <Screen modal header={header} footer={<Button title="Done" variant="holo" size="lg" block onPress={() => router.back()} />}>
        <View style={styles.result}>
          <View style={[styles.medallion, { borderColor: withAlpha(colors.success, 0.5), backgroundColor: colors.successSoft }]}>
            <Ionicons name="checkmark" size={40} color={colors.success} />
          </View>
          <AppText variant="label" tone="success" align="center">
            Payment received
          </AppText>
          <MoneyText pence={phase.amountPence} signed variant="display" align="center" style={styles.resultAmount} />
          <AppText variant="body" tone="muted" align="center">
            Your balance is now {formatPence(phase.balancePence)}.
          </AppText>
        </View>
      </Screen>
    );
  }

  if (phase.kind === 'checkout') {
    return (
      <Screen
        modal
        scroll
        header={header}
        footer={
          <View>
            <Button
              title="I've paid, check now"
              variant="holo"
              size="lg"
              block
              loading={checking}
              onPress={() => void checkPayment(phase, false)}
            />
            <Button title="Close" variant="ghost" block onPress={() => router.back()} style={styles.footerSecondary} />
          </View>
        }
      >
        <View style={styles.result}>
          <View style={[styles.medallion, { borderColor: withAlpha(colors.violet, 0.5), backgroundColor: colors.violetSoft }]}>
            <Ionicons name="lock-closed" size={34} color={colors.violet} />
          </View>
          <AppText variant="title" align="center">
            Finish paying
          </AppText>
          <AppText variant="body" tone="muted" align="center" style={styles.resultText}>
            Complete your {formatPence(phase.amountPence)} payment on the secure Stripe page. Your balance updates as soon as
            Stripe confirms it.
          </AppText>
        </View>
        {checkNote ? (
          <Note icon="time-outline" color={colors.gold} style={styles.block}>
            <AppText variant="caption" tone="muted">
              {checkNote}
            </AppText>
          </Note>
        ) : null}
        <Button
          title="Reopen payment page"
          icon="open-outline"
          variant="secondary"
          block
          onPress={() => void openCheckout(phase)}
          style={styles.block}
        />
        <AppText variant="caption" tone="faint" align="center" style={styles.block}>
          Closed the page without paying? Nothing was charged.
        </AppText>
      </Screen>
    );
  }

  if (unavailable || (!stripeEnabled && !devTopupsEnabled)) {
    return (
      <Screen modal header={header}>
        <EmptyState
          icon="card-outline"
          title="Top-ups unavailable"
          message="Card payments aren't available right now. Your balance and cards are safe. Please check back soon."
          actionLabel="Close"
          actionVariant="secondary"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  if (isCoolingOff(user.limits)) {
    const until = user.limits.coolingOffUntil ?? '';
    return (
      <Screen modal scroll header={header}>
        <View style={styles.result}>
          <View style={[styles.medallion, { borderColor: withAlpha(colors.gold, 0.5), backgroundColor: colors.goldSoft }]}>
            <Ionicons name="cafe" size={34} color={colors.gold} />
          </View>
          <AppText variant="title" align="center">
            You're taking a break
          </AppText>
          <AppText variant="body" tone="muted" align="center" style={styles.resultText}>
            Top-ups and pack opening are paused until {formatDateTime(until)} ({formatTimeUntil(until)} left). You can still
            sell cards back, ship them home and cash out.
          </AppText>
        </View>
        <Button title="Close" variant="secondary" block onPress={() => router.back()} style={styles.block} />
      </Screen>
    );
  }

  const limits = user.limits;
  const left = remainingToday(limits);
  const showFieldError = selected === 'custom' && (showErrors || custom.trim() !== '') ? amount.error : null;

  return (
    <Screen
      modal
      scroll
      keyboardAvoiding
      header={header}
      footer={
        <Button
          title={amount.pence !== null && !amount.error ? `Continue · ${formatPence(amount.pence)}` : 'Continue'}
          variant="holo"
          size="lg"
          block
          loading={submitting}
          iconRight="arrow-forward"
          onPress={() => void submit()}
        />
      }
    >
      <View style={styles.amountHero} accessible accessibilityLabel={amount.pence !== null ? `Top-up amount ${formatPence(amount.pence)}` : 'No amount chosen'}>
        <AppText variant="label">You're adding</AppText>
        {amount.pence !== null && !amount.error ? (
          <MoneyText pence={amount.pence} variant="display" size={48} color={colors.gold} align="center" style={styles.amountValue} />
        ) : (
          <AppText variant="display" size={48} tone="faint" align="center" style={styles.amountValue}>
            £—
          </AppText>
        )}
      </View>

      {failure ? (
        <Note icon="alert-circle" color={colors.danger} style={styles.block}>
          <AppText variant="body" weight="700">
            {failure.title}
          </AppText>
          <AppText variant="caption" tone="muted">
            {failure.message}
          </AppText>
        </Note>
      ) : null}

      <ChoiceChips
        options={chipOptions}
        value={selected}
        onChange={(v) => {
          setChoice(v);
          setFailure(null);
          setShowErrors(false);
        }}
        columns={Math.min(4, Math.max(2, Math.ceil(chipOptions.length / 2)))}
        accessibilityLabel="Top-up amount"
        style={styles.block}
      />

      {selected === 'custom' ? (
        <TextField
          label="Amount"
          value={custom}
          onChangeText={(t) => {
            setCustom(t);
            setFailure(null);
          }}
          placeholder="0.00"
          prefix="£"
          keyboardType="decimal-pad"
          autoFocus
          maxLength={9}
          error={showFieldError}
          hint={`Between ${formatPence(minPence, { trimWholePounds: true })} and ${formatPence(maxPence, { trimWholePounds: true })}`}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          style={styles.block}
        />
      ) : null}

      <View style={styles.notes}>
        {stripeEnabled ? (
          <Note icon="lock-closed" color={colors.violet}>
            <AppText variant="caption" tone="muted">
              Secure card payment by Stripe. You'll pay in your browser, then come back here.
            </AppText>
          </Note>
        ) : (
          <Note icon="construct-outline" color={colors.gold}>
            <AppText variant="caption" tone="muted">
              Development mode: top-ups are credited instantly and no real money moves.
            </AppText>
          </Note>
        )}

        <Note
          icon="hand-left-outline"
          color={colors.success}
          style={styles.noteGap}
          action={
            <Button
              title={limits.dailySpendLimitPence === null ? 'Set limit' : 'Limits'}
              variant="ghost"
              size="sm"
              onPress={() => leaveModalsTo(navigation, 'limits')}
            />
          }
        >
          {limits.dailySpendLimitPence === null ? (
            <AppText variant="caption" tone="muted">
              No daily pack limit set. You can add one any time.
            </AppText>
          ) : (
            <AppText variant="caption" tone="muted">
              Daily pack limit {limitLabel(limits.dailySpendLimitPence)}: {formatPence(limits.spentLast24hPence)} used,{' '}
              {formatPence(left ?? 0)} left in the last 24 hours.
            </AppText>
          )}
        </Note>
      </View>

      <Panel padded={spacing.md} style={styles.block}>
        <AppText variant="caption" tone="faint" align="center">
          18+ only. Pack results are random. Only spend what you can afford to lose.
        </AppText>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.lg },
  amountHero: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  amountValue: { marginTop: spacing.sm },
  notes: { marginTop: spacing.xl },
  noteGap: { marginTop: spacing.sm },
  result: { alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.lg },
  medallion: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  resultAmount: { marginVertical: spacing.sm },
  resultText: { marginTop: spacing.sm, maxWidth: 340 },
  footerSecondary: { marginTop: spacing.sm },
});
