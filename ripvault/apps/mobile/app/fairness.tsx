/**
 * Provably fair: plain-English explanation, current server seed hash / client seed / next nonce,
 * seed rotation (reveals the current server seed, sets a new client seed) and revealed seed history.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { CLIENT_SEED_MAX_LENGTH, isValidClientSeed } from '@ripvault/shared';
import type { FairnessState, RevealedSeed } from '@ripvault/shared';
import { getFairness, rotateSeed, toApiError } from '../src/api/client.ts';
import { useQuery } from '../src/hooks/useQuery.ts';
import { colors, spacing } from '../src/theme.ts';
import { haptic } from '../src/lib/haptics.ts';
import { formatDateTime, plural } from '../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  Button,
  ErrorState,
  IconButton,
  LoadingState,
  Panel,
  Screen,
  SectionHeader,
  TextField,
  useToast,
} from '../src/components/index.ts';
import { accountErrorCopy } from '../src/features/account/errors.ts';
import { formatCount } from '../src/features/account/format.ts';
import { clientSeedFromUuid } from '../src/features/account/verification.ts';
import { useMountedRef } from '../src/features/account/hooks.ts';
import { CopyField, MonoText, Note } from '../src/features/account/ui.tsx';

const HISTORY_PAGE = 10;
const SEED_RULE = `1-${CLIENT_SEED_MAX_LENGTH} letters, numbers, "-" or "_"`;

function randomClientSeed(): string {
  return clientSeedFromUuid(Crypto.randomUUID());
}

function noncesUsed(finalNonce: number): string {
  if (finalNonce <= 0) return 'No packs opened';
  if (finalNonce === 1) return 'Nonce 0 (1 pack)';
  return `Nonces 0-${finalNonce - 1} (${formatCount(finalNonce)} packs)`;
}

export default function FairnessScreen() {
  const toast = useToast();
  const mounted = useMountedRef();
  const q = useQuery(() => getFairness(), [], { refetchOnFocus: true });

  const [seedInput, setSeedInput] = useState<string>(randomClientSeed);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [justRevealed, setJustRevealed] = useState<RevealedSeed | null>(null);
  const [historyCount, setHistoryCount] = useState(HISTORY_PAGE);

  const header = <AppHeader title="Provably fair" back />;

  if (q.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Loading your seeds" />
      </Screen>
    );
  }
  if (!q.data) {
    return (
      <Screen header={header}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const state: FairnessState = q.data;

  const doRotate = async (seed: string) => {
    setRotating(true);
    try {
      const res = await rotateSeed(seed);
      if (!mounted.current) return;
      q.setData(res.current);
      setJustRevealed(res.revealed);
      setSeedInput(randomClientSeed());
      setSeedError(null);
      toast.success('Your old server seed is revealed and a new pair is ready.', 'Seeds rotated');
    } catch (e) {
      if (!mounted.current) return;
      const copy = accountErrorCopy(toApiError(e), 'rotate');
      haptic.error();
      if (copy.field) setSeedError(copy.field.message);
      else toast.show({ type: 'error', title: copy.title, message: copy.message });
    } finally {
      if (mounted.current) setRotating(false);
    }
  };

  const confirmRotate = () => {
    if (rotating) return;
    const seed = seedInput.trim();
    if (!isValidClientSeed(seed)) {
      setSeedError(`Use ${SEED_RULE}`);
      haptic.error();
      return;
    }
    const used =
      state.nonce > 0
        ? `so you can verify the ${plural(state.nonce, 'pack')} opened with it`
        : 'No packs have been opened with it yet';
    haptic.warning();
    Alert.alert(
      'Rotate seeds?',
      `Your current server seed will be revealed (${used}). We'll create a new secret server seed, your client seed becomes "${seed}" and the nonce starts again at 0.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rotate and reveal', onPress: () => void doRotate(seed) },
      ],
    );
  };

  const history = state.revealed.filter((r) => r.serverSeedHash !== justRevealed?.serverSeedHash);

  return (
    <Screen header={header} scroll keyboardAvoiding refreshing={q.refreshing} onRefresh={() => void q.refresh()}>
      <Panel raised glowColor={colors.success} style={styles.intro}>
        <View style={styles.introHead}>
          <View style={styles.introIcon}>
            <Ionicons name="shield-checkmark" size={22} color={colors.success} />
          </View>
          <AppText variant="heading" style={styles.flex}>
            Every pull is provable
          </AppText>
        </View>
        <AppText variant="body" tone="muted">
          Each card you pull is decided by numbers we lock in before you open the pack, so nobody can change the result
          afterwards. You can recheck any pull yourself.
        </AppText>
      </Panel>

      <SectionHeader title="How a pull is decided" style={styles.section} />
      <Panel>
        <Step n={1} title="We commit first">
          We create a secret server seed and show you its SHA-256 hash before you open anything. The hash locks the seed in
          without giving it away.
        </Step>
        <Step n={2} title="You add your own randomness">
          You choose the client seed. Every pack you open uses the next nonce: 0, 1, 2 and so on.
        </Step>
        <Step n={3} title="The roll">
          We compute HMAC-SHA256 with the server seed as the key and "client seed:nonce:0" as the message. The first 13 hex
          digits divided by 2^52 give a roll between 0 and 1.
        </Step>
        <Step n={4} title="The roll picks the card">
          The pack's odds table is sorted by card id, and each card owns a slice of 0 to 1 as big as its chance. The roll
          lands in exactly one slice: that's your card.
        </Step>
        <Step n={5} title="Check it" last>
          Rotate your seeds to reveal the server seed. Its hash must match the one you saw, and every roll and card can be
          recomputed. Your pull history does this on your phone.
        </Step>
      </Panel>

      <SectionHeader title="Current seeds" style={styles.section} />
      <Panel>
        <CopyField label="Server seed hash" value={state.serverSeedHash} what="Server seed hash" />
        <AppText variant="caption" tone="faint" style={styles.caption}>
          The server seed itself stays secret until you rotate.
        </AppText>
        <CopyField label="Client seed" value={state.clientSeed} style={styles.fieldGap} />
        <View style={styles.nonceRow}>
          <View style={styles.flex}>
            <AppText variant="label">Next nonce</AppText>
            <AppText variant="caption" tone="muted" style={styles.nonceCaption}>
              {state.nonce === 0 ? 'No packs opened with these seeds yet' : `${plural(state.nonce, 'pack')} opened with these seeds`}
            </AppText>
          </View>
          <AppText variant="money" size={32} color={colors.gold} accessibilityLabel={`Next nonce ${state.nonce}`}>
            {formatCount(state.nonce)}
          </AppText>
        </View>
      </Panel>

      <SectionHeader title="Rotate seeds" style={styles.section} />
      <Panel>
        <AppText variant="body" tone="muted">
          Rotating reveals your current server seed so you can verify past pulls, then starts a fresh pair with the nonce back
          at 0.
        </AppText>
        <TextField
          label="New client seed"
          value={seedInput}
          onChangeText={(t) => {
            setSeedInput(t);
            setSeedError(null);
          }}
          placeholder="your-lucky-seed"
          icon="key-outline"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={CLIENT_SEED_MAX_LENGTH}
          error={seedError}
          hint={SEED_RULE}
          right={
            <IconButton
              icon="shuffle"
              variant="plain"
              size={20}
              color={colors.gold}
              accessibilityLabel="Randomise client seed"
              onPress={() => {
                setSeedInput(randomClientSeed());
                setSeedError(null);
              }}
            />
          }
          style={styles.fieldGap}
        />
        <Button
          title="Rotate and reveal"
          icon="refresh"
          variant="primary"
          block
          loading={rotating}
          onPress={confirmRotate}
          style={styles.fieldGap}
        />
      </Panel>

      {justRevealed ? (
        <Panel glowColor={colors.gold} style={styles.block}>
          <View style={styles.revealHead}>
            <Ionicons name="lock-open" size={18} color={colors.gold} />
            <AppText variant="label" tone="gold" style={styles.revealTitle}>
              Just revealed
            </AppText>
          </View>
          <SeedDetails seed={justRevealed} accent={colors.gold} />
          {justRevealed.finalNonce > 0 ? (
            <Button
              title="Verify these pulls"
              icon="checkmark-done"
              variant="holo"
              block
              onPress={() => router.push('/history')}
              style={styles.fieldGap}
            />
          ) : null}
        </Panel>
      ) : null}

      <SectionHeader title={`Revealed seeds${history.length > 0 ? ` (${history.length})` : ''}`} style={styles.section} />
      {history.length === 0 ? (
        <Note icon="information-circle-outline" color={colors.violet}>
          <AppText variant="caption" tone="muted">
            No revealed seeds yet. When you rotate, the old server seed shows up here so you can check every pull made with
            it.
          </AppText>
        </Note>
      ) : (
        <>
          {history.slice(0, historyCount).map((seed, i) => (
            <Panel key={`${seed.serverSeedHash}-${seed.revealedAt}`} style={i > 0 ? styles.historyGap : null}>
              <SeedDetails seed={seed} />
            </Panel>
          ))}
          {history.length > historyCount ? (
            <Button
              title={`Show ${Math.min(HISTORY_PAGE, history.length - historyCount)} more`}
              variant="ghost"
              block
              onPress={() => setHistoryCount((c) => c + HISTORY_PAGE)}
              style={styles.fieldGap}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Step({ n, title, last = false, children }: { n: number; title: string; last?: boolean; children?: ReactNode }) {
  return (
    <View style={[styles.step, !last ? styles.stepGap : null]}>
      <View style={styles.stepBadge}>
        <AppText variant="caption" weight="800" color={colors.textOnLight}>
          {n}
        </AppText>
      </View>
      <View style={styles.flex}>
        <AppText variant="body" weight="700">
          {title}
        </AppText>
        <AppText variant="caption" tone="muted" style={styles.stepText}>
          {children}
        </AppText>
      </View>
    </View>
  );
}

function SeedDetails({ seed, accent }: { seed: RevealedSeed; accent?: string }) {
  return (
    <View>
      <CopyField label="Server seed" value={seed.serverSeed} accent={accent} />
      <CopyField label="Server seed hash" value={seed.serverSeedHash} style={styles.fieldGapSm} />
      <View style={styles.seedMeta}>
        <View style={styles.flex}>
          <AppText variant="label">Client seed</AppText>
          <MonoText size={13} numberOfLines={1}>
            {seed.clientSeed}
          </MonoText>
        </View>
        <View style={styles.seedMetaRight}>
          <AppText variant="caption" weight="700">
            {noncesUsed(seed.finalNonce)}
          </AppText>
          <AppText variant="caption" tone="faint">
            Revealed {formatDateTime(seed.revealedAt)}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  intro: { marginTop: spacing.sm },
  introHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  introIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successSoft,
    marginRight: spacing.md,
  },
  section: { marginTop: spacing.xxl },
  block: { marginTop: spacing.lg },
  caption: { marginTop: spacing.xs + 2 },
  fieldGap: { marginTop: spacing.lg },
  fieldGapSm: { marginTop: spacing.md },
  nonceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  nonceCaption: { marginTop: 2 },
  step: { flexDirection: 'row' },
  stepGap: { marginBottom: spacing.lg },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    marginRight: spacing.md,
    marginTop: 1,
  },
  stepText: { marginTop: 2 },
  revealHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  revealTitle: { marginLeft: spacing.sm },
  historyGap: { marginTop: spacing.md },
  seedMeta: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  seedMetaRight: { alignItems: 'flex-end', marginLeft: spacing.md },
});
