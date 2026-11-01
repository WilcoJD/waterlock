/**
 * Cash out: request a payout of (part of) the wallet balance, plus the list of past cash outs.
 * POST /wallet/withdrawals debits immediately (status pending); an admin pays or returns it.
 */
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { formatPence } from '@ripvault/shared';
import type { Withdrawal } from '@ripvault/shared';
import { createWithdrawal, listWithdrawals, toApiError } from '../src/api/client.ts';
import { useSession } from '../src/state/session.tsx';
import { useAppConfig } from '../src/state/config.tsx';
import { useQuery } from '../src/hooks/useQuery.ts';
import { colors, spacing } from '../src/theme.ts';
import { haptic } from '../src/lib/haptics.ts';
import { formatDate } from '../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  MoneyText,
  Panel,
  Pill,
  Screen,
  SectionHeader,
  TextField,
  useToast,
} from '../src/components/index.ts';
import { checkAmount, penceToInput } from '../src/features/account/format.ts';
import { accountErrorCopy } from '../src/features/account/errors.ts';
import type { ErrorCopy } from '../src/features/account/errors.ts';
import { withdrawalMeta } from '../src/features/account/meta.ts';
import { useActionKey, useMountedRef } from '../src/features/account/hooks.ts';
import { ListGroup, Note, RowSkeletons } from '../src/features/account/ui.tsx';

const PAYOUT_MIN = 3;
const PAYOUT_MAX = 200;

export default function WithdrawScreen() {
  const { user, setBalance, refreshUser } = useSession();
  const { config, reload } = useAppConfig();
  const toast = useToast();
  const actionKey = useActionKey();
  const mounted = useMountedRef();
  const history = useQuery(() => listWithdrawals(), [], { refetchOnFocus: true });

  const [amountText, setAmountText] = useState('');
  const [payout, setPayout] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<{ amountPence?: string; payoutDetails?: string }>({});
  const [failure, setFailure] = useState<ErrorCopy | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const balance = user?.balancePence ?? 0;
  const minPence = config.withdrawals.minPence;
  const enabled = config.withdrawals.enabled;
  const tooLow = balance < minPence;

  const amount = useMemo(
    () =>
      checkAmount(amountText, {
        minPence,
        maxPence: balance,
        minMessage: `The minimum cash out is ${formatPence(minPence, { trimWholePounds: true })}`,
        maxMessage: `That's more than your balance (${formatPence(balance)})`,
      }),
    [amountText, minPence, balance],
  );
  const payoutTrimmed = payout.trim();
  const payoutError =
    payoutTrimmed.length < PAYOUT_MIN
      ? 'Tell us where to send it, e.g. your PayPal email'
      : payoutTrimmed.length > PAYOUT_MAX
        ? `Keep it under ${PAYOUT_MAX} characters`
        : null;

  const amountFieldError = serverErrors.amountPence ?? (showErrors || amountText.trim() !== '' ? amount.error : null);
  const payoutFieldError = serverErrors.payoutDetails ?? (showErrors ? payoutError : null);

  const onRefresh = () => {
    setRefreshing(true);
    void Promise.all([history.refresh(), refreshUser()]).then(() => {
      if (mounted.current) setRefreshing(false);
    });
  };

  const send = async (pence: number, details: string) => {
    setSubmitting(true);
    setFailure(null);
    const key = actionKey.keyFor(`withdraw:${pence}:${details}`);
    try {
      const res = await createWithdrawal({ amountPence: pence, payoutDetails: details }, key);
      actionKey.reset();
      setBalance(res.balancePence);
      toast.success(`We'll send ${formatPence(pence)} to your payout account.`, 'Cash out requested');
      if (!mounted.current) return;
      setAmountText('');
      setShowErrors(false);
      history.setData((list) => [res.withdrawal, ...(list ?? []).filter((w) => w.id !== res.withdrawal.id)]);
      void history.refetch();
    } catch (e) {
      if (!mounted.current) return;
      const err = toApiError(e);
      const copy = accountErrorCopy(err, 'withdraw');
      haptic.error();
      if (copy.refreshUser) void refreshUser();
      if (err.code === 'forbidden') void reload();
      if (copy.field) {
        setServerErrors({ [copy.field.name]: copy.field.message });
      } else if (err.code === 'insufficient_funds') {
        setServerErrors({ amountPence: copy.message });
      } else {
        setFailure(copy);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };

  const confirm = () => {
    if (submitting) return;
    setServerErrors({});
    if (amount.pence === null || amount.error || payoutError) {
      setShowErrors(true);
      haptic.error();
      return;
    }
    const pence = amount.pence;
    haptic.warning();
    Alert.alert(
      `Cash out ${formatPence(pence)}?`,
      `It leaves your balance now and goes to:\n${payoutTrimmed}\n\nPayouts usually arrive within 3 to 5 working days. If we can't pay it, the money comes back to your balance.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Cash out', onPress: () => void send(pence, payoutTrimmed) },
      ],
    );
  };

  const header = <AppHeader title="Cash out" back />;

  if (!user) {
    return (
      <Screen header={header}>
        <LoadingState />
      </Screen>
    );
  }

  const canSubmit = enabled && !tooLow;

  return (
    <Screen
      scroll
      keyboardAvoiding
      header={header}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        canSubmit ? (
          <Button
            title={amount.pence !== null && !amount.error ? `Cash out ${formatPence(amount.pence)}` : 'Cash out'}
            variant="holo"
            size="lg"
            block
            icon="arrow-up"
            loading={submitting}
            onPress={confirm}
          />
        ) : undefined
      }
    >
      <Panel raised style={styles.balancePanel}>
        <AppText variant="label">Available to cash out</AppText>
        <MoneyText pence={balance} variant="display" size={40} adjustsFontSizeToFit style={styles.balance} />
        <AppText variant="caption" tone="muted">
          Want more to cash out? Sell cards back from your vault for {config.buybackBps / 100}% of their value.
        </AppText>
      </Panel>

      {!enabled ? (
        <Note icon="pause-circle" color={colors.gold} style={styles.block}>
          <AppText variant="body" weight="700">
            Cash outs are paused
          </AppText>
          <AppText variant="caption" tone="muted">
            Your balance is safe and you can keep using it for packs and shipping. Please check back later.
          </AppText>
        </Note>
      ) : tooLow ? (
        <Note icon="information-circle" color={colors.violet} style={styles.block}>
          <AppText variant="caption" tone="muted">
            You need at least {formatPence(minPence, { trimWholePounds: true })} in your balance to cash out.
          </AppText>
        </Note>
      ) : (
        <View style={styles.form}>
          {failure ? (
            <Note icon="alert-circle" color={colors.danger} style={styles.fieldGap}>
              <AppText variant="body" weight="700">
                {failure.title}
              </AppText>
              <AppText variant="caption" tone="muted">
                {failure.message}
              </AppText>
            </Note>
          ) : null}
          <TextField
            label="Amount"
            value={amountText}
            onChangeText={(t) => {
              setAmountText(t);
              setServerErrors((e) => ({ ...e, amountPence: undefined }));
            }}
            placeholder="0.00"
            prefix="£"
            keyboardType="decimal-pad"
            maxLength={12}
            error={amountFieldError}
            hint={`Minimum ${formatPence(minPence, { trimWholePounds: true })}`}
            right={
              <Button
                title="Max"
                variant="ghost"
                size="sm"
                haptic="selection"
                accessibilityLabel={`Cash out everything, ${formatPence(balance)}`}
                onPress={() => {
                  setAmountText(penceToInput(balance));
                  setServerErrors((e) => ({ ...e, amountPence: undefined }));
                }}
              />
            }
          />
          <TextField
            label="Send it to"
            value={payout}
            onChangeText={(t) => {
              setPayout(t);
              setServerErrors((e) => ({ ...e, payoutDetails: undefined }));
            }}
            placeholder="PayPal email, or name, sort code and account number"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            maxLength={PAYOUT_MAX}
            error={payoutFieldError}
            hint="Double-check it: we pay exactly what you enter here."
            style={styles.fieldGap}
          />
          <Note icon="time-outline" color={colors.violet} style={styles.fieldGap}>
            <AppText variant="caption" tone="muted">
              The amount leaves your balance as soon as you confirm. Payouts usually arrive within 3 to 5 working days.
            </AppText>
          </Note>
        </View>
      )}

      <SectionHeader title="Your cash outs" style={styles.section} />
      <WithdrawalList
        data={history.data}
        loading={history.loading}
        error={history.error}
        onRetry={() => void history.refetch()}
        onTopUp={() => router.push('/topup')}
      />
    </Screen>
  );
}

function WithdrawalList({
  data,
  loading,
  error,
  onRetry,
  onTopUp,
}: {
  data: Withdrawal[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onTopUp: () => void;
}) {
  if (loading) return <RowSkeletons count={3} />;
  if (!data) return <ErrorState error={error} onRetry={onRetry} fill={false} />;
  if (data.length === 0) {
    return (
      <EmptyState
        fill={false}
        icon="cash-outline"
        title="No cash outs yet"
        message="When you cash out, you can follow its progress here."
        actionLabel="Top up instead"
        actionVariant="ghost"
        onAction={onTopUp}
      />
    );
  }
  return (
    <ListGroup>
      {data.map((w) => {
        const meta = withdrawalMeta(w.status);
        const note = w.adminNote ? ` · ${w.adminNote}` : '';
        return (
          <ListRow
            key={w.id}
            icon={meta.icon}
            iconColor={meta.color}
            title={formatPence(w.amountPence)}
            subtitle={`${w.payoutDetails} · ${formatDate(w.createdAt)}${note}`}
            right={<Pill label={meta.label} color={meta.color} />}
            accessibilityLabel={`Cash out of ${formatPence(w.amountPence)} on ${formatDate(w.createdAt)}: ${meta.label}. ${meta.explanation}${note}`}
          />
        );
      })}
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  balancePanel: { marginTop: spacing.sm },
  balance: { marginTop: spacing.sm, marginBottom: spacing.xs },
  block: { marginTop: spacing.lg },
  form: { marginTop: spacing.xl },
  fieldGap: { marginTop: spacing.lg },
  section: { marginTop: spacing.xxl },
});
