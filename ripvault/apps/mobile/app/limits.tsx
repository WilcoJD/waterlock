/**
 * Safer play: daily pack-spend limit (with 24h delay for raising/removing), take-a-break cool-off,
 * and support links. Everything goes through PUT /me/limits, which returns the updated Me.
 */
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { formatPence } from '@ripvault/shared';
import type { UpdateLimitsRequest } from '@ripvault/shared';
import { toApiError, updateLimits } from '../src/api/client.ts';
import { useSession } from '../src/state/session.tsx';
import { colors, spacing } from '../src/theme.ts';
import { SUPPORT_LINKS } from '../src/config.ts';
import { haptic } from '../src/lib/haptics.ts';
import { formatDateTime, formatTimeUntil } from '../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  Button,
  ListRow,
  LoadingState,
  MoneyText,
  Panel,
  Screen,
  SectionHeader,
  TextField,
  useToast,
} from '../src/components/index.ts';
import { checkAmount } from '../src/features/account/format.ts';
import { accountErrorCopy } from '../src/features/account/errors.ts';
import {
  COOL_OFF_OPTIONS,
  LIMIT_PRESETS_PENCE,
  MAX_LIMIT_PENCE,
  coolOffLabel,
  describeLimitChange,
  isCoolingOff,
  limitLabel,
  limitUsage,
  planCoolOff,
  remainingToday,
} from '../src/features/account/limits.ts';
import { useMountedRef, useNow, useOpenLink, useUserRefresh } from '../src/features/account/hooks.ts';
import { ChoiceChips, ListGroup, Note, ProgressBar } from '../src/features/account/ui.tsx';
import type { ChoiceOption } from '../src/features/account/ui.tsx';

type LimitChoice = number | 'custom' | 'none';
type BreakDays = 1 | 7 | 30;

const LIMIT_OPTIONS: ChoiceOption<LimitChoice>[] = [
  ...LIMIT_PRESETS_PENCE.map((p) => ({ value: p as LimitChoice, label: formatPence(p, { trimWholePounds: true }) })),
  { value: 'custom', label: 'Other', icon: 'create-outline' },
  { value: 'none', label: 'No limit', icon: 'infinite-outline' },
];

export default function LimitsScreen() {
  const { user, setUser } = useSession();
  const { refreshing, onRefresh } = useUserRefresh();
  const openLink = useOpenLink();
  const toast = useToast();
  const mounted = useMountedRef();
  const now = useNow(30_000);

  const [choice, setChoice] = useState<LimitChoice | null>(null);
  const [custom, setCustom] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [savingLimit, setSavingLimit] = useState(false);
  const [breakDays, setBreakDays] = useState<BreakDays | null>(null);
  const [startingBreak, setStartingBreak] = useState(false);

  const customCheck = useMemo(
    () => checkAmount(custom, { minPence: 0, maxPence: MAX_LIMIT_PENCE }),
    [custom],
  );

  const header = <AppHeader title="Safer play" back />;
  if (!user) {
    return (
      <Screen header={header}>
        <LoadingState />
      </Screen>
    );
  }

  const limits = user.limits;
  const current = limits.dailySpendLimitPence;
  const usage = limitUsage(limits);
  const left = remainingToday(limits);
  const onBreak = isCoolingOff(limits, now);
  const hasPending = limits.pendingEffectiveAt !== null;

  // The value the player picked: pence, null (= remove), or undefined (nothing valid picked yet).
  let next: number | null | undefined;
  if (choice === null) next = undefined;
  else if (choice === 'none') next = null;
  else if (choice === 'custom') next = customCheck.error ? undefined : (customCheck.pence ?? undefined);
  else next = choice;
  const change = next !== undefined ? describeLimitChange(limits, next, now) : null;
  const customError = choice === 'custom' && (showErrors || custom.trim() !== '') ? customCheck.error : null;

  const save = async (value: number | null, successMessage: (delayed: boolean) => string) => {
    const body: UpdateLimitsRequest = { dailySpendLimitPence: value };
    const plan = describeLimitChange(limits, value, new Date());
    setSavingLimit(true);
    setLimitError(null);
    try {
      const me = await updateLimits(body);
      setUser(me);
      toast.success(successMessage(plan.kind === 'delayed'));
      if (!mounted.current) return;
      setChoice(null);
      setCustom('');
      setShowErrors(false);
    } catch (e) {
      if (!mounted.current) return;
      const copy = accountErrorCopy(toApiError(e), 'limits');
      haptic.error();
      if (copy.field) setLimitError(copy.field.message);
      else toast.show({ type: 'error', title: copy.title, message: copy.message });
    } finally {
      if (mounted.current) setSavingLimit(false);
    }
  };

  const saveChoice = () => {
    if (savingLimit) return;
    if (next === undefined) {
      setShowErrors(true);
      haptic.error();
      return;
    }
    if (change?.kind === 'none') return;
    const value = next;
    void save(value, (delayed) =>
      delayed
        ? `Your new limit (${limitLabel(value)}) applies in 24 hours.`
        : value === null
          ? 'Daily limit removed'
          : `Daily limit set to ${limitLabel(value)}`,
    );
  };

  const cancelPending = () => {
    if (current === null || savingLimit) return;
    void save(current, () => `Pending change cancelled. Your limit stays at ${limitLabel(current)}.`);
  };

  const confirmBreak = (days: BreakDays) => {
    if (startingBreak) return;
    const plan = planCoolOff(days, limits, new Date());
    if (!plan.extends) {
      toast.info('Your current break already lasts longer than that.');
      return;
    }
    haptic.warning();
    Alert.alert(
      `Take a ${coolOffLabel(days)} break?`,
      `Until ${formatDateTime(plan.until)} you won't be able to open packs or top up.\n\nThis can't be undone or shortened, even if you change your mind. You can still sell cards back, ship them and cash out.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Start my ${coolOffLabel(days)} break`,
          style: 'destructive',
          onPress: () => void startBreak(days),
        },
      ],
    );
  };

  const startBreak = async (days: BreakDays) => {
    setStartingBreak(true);
    try {
      const me = await updateLimits({ coolOffDays: days });
      setUser(me);
      toast.success(
        me.limits.coolingOffUntil ? `Your break runs until ${formatDateTime(me.limits.coolingOffUntil)}.` : 'Your break has started.',
        'Break started',
      );
      if (mounted.current) setBreakDays(null);
    } catch (e) {
      if (!mounted.current) return;
      const copy = accountErrorCopy(toApiError(e), 'limits');
      toast.show({ type: 'error', title: copy.title, message: copy.message });
    } finally {
      if (mounted.current) setStartingBreak(false);
    }
  };

  const usageColor = usage >= 1 ? colors.danger : usage >= 0.75 ? colors.gold : colors.success;
  const breakOptions: ChoiceOption<BreakDays>[] = COOL_OFF_OPTIONS.map((d) => ({
    value: d,
    label: coolOffLabel(d),
    disabled: !planCoolOff(d, limits, now).extends,
  }));

  return (
    <Screen header={header} scroll keyboardAvoiding refreshing={refreshing} onRefresh={onRefresh}>
      <AppText variant="body" tone="muted" style={styles.intro}>
        Tools to keep RipVault fun. Packs are random, so only spend what you can afford to lose.
      </AppText>

      {/* Current limit */}
      <Panel raised style={styles.block}>
        <AppText variant="label">Daily pack limit</AppText>
        <View style={styles.limitRow}>
          {current === null ? (
            <AppText variant="title" size={34}>
              No limit
            </AppText>
          ) : (
            <MoneyText pence={current} variant="display" size={38} trimWholePounds />
          )}
          {current !== null ? (
            <AppText variant="caption" tone="muted" style={styles.perDay}>
              per 24 hours
            </AppText>
          ) : null}
        </View>
        {current !== null ? (
          <>
            <ProgressBar
              value={usage}
              color={usageColor}
              style={styles.progress}
              accessibilityLabel={`${formatPence(limits.spentLast24hPence)} of ${formatPence(current)} used in the last 24 hours`}
            />
            <View style={styles.usageRow}>
              <AppText variant="caption" tone="muted">
                {formatPence(limits.spentLast24hPence)} spent in the last 24h
              </AppText>
              <AppText variant="caption" weight="700" color={usageColor}>
                {formatPence(left ?? 0)} left
              </AppText>
            </View>
          </>
        ) : (
          <AppText variant="caption" tone="muted" style={styles.usageText}>
            {formatPence(limits.spentLast24hPence)} spent on packs in the last 24 hours. A limit caps how much you can spend on packs in
            any 24 hours.
          </AppText>
        )}
        {hasPending && limits.pendingEffectiveAt ? (
          <Note
            icon="time-outline"
            color={colors.gold}
            style={styles.pending}
            action={
              current !== null ? (
                <Button title="Cancel it" variant="ghost" size="sm" loading={savingLimit} onPress={cancelPending} />
              ) : undefined
            }
          >
            <AppText variant="caption" tone="muted">
              Changing to <AppText variant="caption" weight="800">{limitLabel(limits.pendingDailySpendLimitPence)}</AppText> on{' '}
              {formatDateTime(limits.pendingEffectiveAt)} (in {formatTimeUntil(limits.pendingEffectiveAt, now)}).
            </AppText>
          </Note>
        ) : null}
      </Panel>

      {/* Change the limit */}
      <SectionHeader title={current === null ? 'Set a daily limit' : 'Change your limit'} style={styles.section} />
      <ChoiceChips
        options={LIMIT_OPTIONS}
        value={choice}
        onChange={(v) => {
          setChoice(v);
          setLimitError(null);
          setShowErrors(false);
        }}
        columns={3}
        accent={colors.gold}
        accessibilityLabel="Daily limit"
      />
      {choice === 'custom' ? (
        <TextField
          label="Daily limit"
          value={custom}
          onChangeText={(t) => {
            setCustom(t);
            setLimitError(null);
          }}
          placeholder="0.00"
          prefix="£"
          keyboardType="decimal-pad"
          autoFocus
          maxLength={10}
          error={limitError ?? customError}
          returnKeyType="done"
          onSubmitEditing={saveChoice}
          style={styles.fieldGap}
        />
      ) : limitError ? (
        <AppText variant="caption" tone="danger" style={styles.fieldGap}>
          {limitError}
        </AppText>
      ) : null}
      {change ? (
        <Note
          icon={change.kind === 'delayed' ? 'hourglass-outline' : change.kind === 'immediate' ? 'flash-outline' : 'information-circle-outline'}
          color={change.kind === 'delayed' ? colors.gold : change.kind === 'immediate' ? colors.success : colors.violet}
          style={styles.fieldGap}
        >
          <AppText variant="caption" tone="muted">
            {change.message}
          </AppText>
        </Note>
      ) : (
        <AppText variant="caption" tone="faint" style={styles.fieldGap}>
          Lowering your limit applies straight away. Raising or removing it takes 24 hours, so you have time to change your mind.
        </AppText>
      )}
      <Button
        title={choice === 'none' ? 'Remove limit' : 'Save limit'}
        variant="primary"
        block
        loading={savingLimit}
        disabled={choice === null || change?.kind === 'none'}
        onPress={saveChoice}
        style={styles.fieldGap}
      />

      {/* Take a break */}
      <SectionHeader title="Take a break" style={styles.section} />
      <Panel style={onBreak ? styles.breakActive : undefined} glowColor={onBreak ? colors.gold : undefined}>
        {onBreak && limits.coolingOffUntil ? (
          <View style={styles.breakStatus}>
            <AppText variant="label" tone="gold">
              On a break
            </AppText>
            <AppText variant="heading" style={styles.breakUntil}>
              Until {formatDateTime(limits.coolingOffUntil)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {formatTimeUntil(limits.coolingOffUntil, now)} to go. Pack opening and top-ups are paused; selling, shipping and
              cashing out still work.
            </AppText>
          </View>
        ) : (
          <AppText variant="body" tone="muted">
            Need time out? Pause pack opening and top-ups. You can still sell cards back, ship them and cash out.
          </AppText>
        )}
        <ChoiceChips
          options={breakOptions}
          value={breakDays}
          onChange={setBreakDays}
          columns={3}
          accent={colors.danger}
          accessibilityLabel="Break length"
          style={styles.fieldGap}
        />
        <Button
          title={breakDays ? `${onBreak ? 'Extend' : 'Start'} ${coolOffLabel(breakDays)} break` : onBreak ? 'Extend my break' : 'Start a break'}
          variant="danger"
          block
          icon="pause"
          loading={startingBreak}
          disabled={breakDays === null}
          onPress={() => breakDays && confirmBreak(breakDays)}
          style={styles.fieldGap}
        />
        <AppText variant="caption" tone="faint" align="center" style={styles.fieldGap}>
          A break can't be cancelled or shortened once it starts.
        </AppText>
      </Panel>

      {/* Support */}
      <SectionHeader title="Talk to someone" style={styles.section} />
      <ListGroup>
        <ListRow
          icon="help-buoy"
          iconColor={colors.info}
          title="BeGambleAware"
          subtitle="Free, confidential advice and support"
          onPress={() => openLink(SUPPORT_LINKS.beGambleAware)}
        />
        <ListRow
          icon="chatbubbles"
          iconColor={colors.success}
          title="GamCare"
          subtitle="National Gambling Helpline: 0808 8020 133, free, 24/7"
          onPress={() => openLink(SUPPORT_LINKS.gamCare)}
        />
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: spacing.xs },
  block: { marginTop: spacing.lg },
  limitRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.sm },
  perDay: { marginLeft: spacing.sm, marginBottom: 8 },
  progress: { marginTop: spacing.lg },
  usageRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  usageText: { marginTop: spacing.sm },
  pending: { marginTop: spacing.lg },
  section: { marginTop: spacing.xxl },
  fieldGap: { marginTop: spacing.md },
  breakActive: { borderColor: colors.gold },
  breakStatus: { marginBottom: spacing.xs },
  breakUntil: { marginTop: spacing.xs, marginBottom: spacing.xs },
});
