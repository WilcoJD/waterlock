/**
 * The rip (full-screen modal, swipe-to-dismiss off). Params: id (pack), qty.
 *
 *   opening   POST /packs/:id/open (exactly once per action); the pack trembles and glows
 *   tearing   the pack tears open, white flash
 *   revealing cards one by one: flip, tier glow, value count-up, haptics; Skip reveals all
 *   summary   value vs cost, per-card Sell / Keep, Sell all, Ship, Rip again, Done
 *   error     friendly explanation + next step (top up, limits, retry with the same key)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Animated, BackHandler, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPence } from '@ripvault/shared';
import type { Pull } from '@ripvault/shared';
import { getPack } from '../../src/api/client.ts';
import { useQuery } from '../../src/hooks/useQuery.ts';
import { useSession } from '../../src/state/session.tsx';
import { useAppConfig } from '../../src/state/config.tsx';
import { colors, spacing, withAlpha } from '../../src/theme.ts';
import { haptic } from '../../src/lib/haptics.ts';
import { plural } from '../../src/lib/format.ts';
import { AppHeader, AppText, EmptyState, Screen, goBackOrHome } from '../../src/components/index.ts';
import { PACK_ASPECT, PackBody } from '../../src/features/packs/PackArt.tsx';
import { RipStage } from '../../src/features/packs/RipStage.tsx';
import { RevealStage } from '../../src/features/packs/RevealStage.tsx';
import { RipErrorView } from '../../src/features/packs/RipErrorView.tsx';
import { RipSummary, RipSummaryFooter } from '../../src/features/packs/RipSummary.tsx';
import { ripErrorCopy } from '../../src/features/packs/ripErrors.ts';
import type { RipErrorAction } from '../../src/features/packs/ripErrors.ts';
import { useRip } from '../../src/features/packs/useRip.ts';
import { useNavLock } from '../../src/features/packs/useNavLock.ts';
import { leaveModalTo } from '../../src/features/packs/nav.ts';
import {
  firstParam,
  getRememberedPack,
  parseQuantityParam,
  revealOrder,
  safePackTheme,
  shipHref,
  toPackSummary,
} from '../../src/features/packs/packData.ts';

export default function OpenPackScreen() {
  const params = useLocalSearchParams<{ id: string; qty?: string }>();
  const packId = firstParam(params.id) ?? '';
  const { config } = useAppConfig();
  const { user } = useSession();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const navigateOnce = useNavLock();

  // Fixed for the life of the screen ("Rip again" repeats the same pack and quantity).
  const [quantity] = useState(() => parseQuantityParam(params.qty, config.maxOpenQuantity));
  const rip = useRip(packId, quantity);
  const { phase } = rip;

  // Pack art: from the shop's cache, or fetched when the screen was opened directly (deep link).
  const remembered = getRememberedPack(packId);
  const packQ = useQuery(() => getPack(packId), [packId], { enabled: remembered === undefined && packId !== '' });
  const packInfo = remembered ?? (packQ.data ? toPackSummary(packQ.data) : undefined);
  const result = phase.kind === 'tearing' || phase.kind === 'revealing' || phase.kind === 'summary' ? phase.result : null;
  const packName = result?.pack.name ?? packInfo?.name ?? '';
  const theme = safePackTheme(packInfo?.theme);
  const pricePence = result?.pack.pricePence ?? packInfo?.pricePence;
  const costPence = pricePence !== undefined ? pricePence * quantity : null;
  const buybackLabel = `${Number((config.buybackBps / 100).toFixed(2))}%`;
  const revealPulls = useMemo(() => (result ? revealOrder(result.pulls) : []), [result]);

  // White flash as the pack tears.
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (phase.kind !== 'tearing') return undefined;
    const anim = Animated.sequence([
      Animated.delay(320),
      Animated.timing(flash, { toValue: 0.85, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 560, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [phase.kind, flash]);

  // Android back: never mid-rip; during the reveal it skips to the summary.
  const phaseKindRef = useRef(phase.kind);
  phaseKindRef.current = phase.kind;
  const { finishReveal } = rip;
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const kind = phaseKindRef.current;
        if (kind === 'opening' || kind === 'tearing') return true;
        if (kind === 'revealing') {
          finishReveal();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [finishReveal]),
  );

  const onErrorAction = (action: RipErrorAction) => {
    if (action === 'retry') rip.retry();
    else if (action === 'topup') navigateOnce(() => router.push('/topup'));
    else if (action === 'limits') navigateOnce(() => leaveModalTo('/limits'));
    else goBackOrHome();
  };

  const confirmSellAll = (pulls: Pull[], totalPence: number) => {
    if (pulls.length === 0) return;
    haptic.warning();
    Alert.alert(
      `Sell ${plural(pulls.length, 'card')}?`,
      `${formatPence(totalPence)} goes to your balance (${buybackLabel} of market value). Sold cards leave your vault and this can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Sell for ${formatPence(totalPence)}`, style: 'destructive', onPress: () => void rip.sell(pulls) },
      ],
    );
  };

  const subtitle = `${plural(quantity, 'pack')}${costPence !== null ? ` · ${formatPence(costPence)}` : ''}`;
  const closable = phase.kind === 'error' || phase.kind === 'summary';
  const header = (
    <AppHeader
      title={phase.kind === 'summary' ? 'Your pulls' : packName || 'Ripping'}
      subtitle={phase.kind === 'summary' ? packName : subtitle}
      back={closable ? 'close' : false}
      onBack={goBackOrHome}
    />
  );

  if (packId === '') {
    return (
      <Screen header={<AppHeader title="Rip" back="close" onBack={goBackOrHome} />}>
        <EmptyState icon="help-circle-outline" title="Pack not found" message="This link doesn't point to a pack." actionLabel="Back to packs" onAction={goBackOrHome} />
      </Screen>
    );
  }

  const packWidth = Math.round(Math.min(windowWidth * 0.6, 250, (windowHeight * 0.46) / PACK_ASPECT));
  const backdrop =
    phase.kind !== 'summary' ? (
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(theme.accent, 0.24), withAlpha(theme.accent, 0)]}
        start={{ x: 0.5, y: 0.15 }}
        end={{ x: 0.5, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
    ) : null;

  let screen: ReactNode;
  if (phase.kind === 'opening' || phase.kind === 'tearing') {
    screen = (
      <Screen header={header}>
        {backdrop}
        <View style={styles.center}>
          <RipStage
            name={packName}
            theme={theme}
            pricePence={pricePence}
            width={packWidth}
            mode={phase.kind === 'tearing' ? 'tearing' : 'charging'}
            onTorn={rip.finishTear}
          />
          <View style={styles.caption} accessibilityLiveRegion="polite">
            <AppText variant="heading" align="center">
              {phase.kind === 'tearing' ? 'Here it comes…' : `Ripping ${plural(quantity, 'pack')}`}
            </AppText>
            <AppText variant="caption" tone="muted" align="center" style={styles.captionSub}>
              {phase.kind === 'tearing'
                ? 'Your cards are in your vault'
                : `Drawing ${quantity === 1 ? 'your card' : 'your cards'} from the vault, provably fair`}
            </AppText>
          </View>
        </View>
      </Screen>
    );
  } else if (phase.kind === 'error') {
    const copy = ripErrorCopy(phase.error, {
      quantity,
      costPence,
      balancePence: user?.balancePence ?? null,
      limits: user?.limits ?? null,
    });
    screen = (
      <Screen header={header} scroll contentStyle={styles.errorContent}>
        {backdrop}
        <View style={styles.errorPack}>
          <PackBody name={packName} theme={theme} width={96} shimmer={false} style={styles.errorPackArt} />
        </View>
        <RipErrorView copy={copy} onAction={onErrorAction} />
      </Screen>
    );
  } else if (phase.kind === 'revealing') {
    screen = (
      <Screen header={header} padded={false}>
        {backdrop}
        <RevealStage
          pulls={revealPulls}
          packPricePence={phase.result.pack.pricePence}
          onFinished={rip.finishReveal}
          bottomInset={insets.bottom + spacing.sm}
        />
      </Screen>
    );
  } else {
    const res = phase.result;
    screen = (
      <Screen
        header={header}
        scroll
        footer={
          <RipSummaryFooter
            result={res}
            rows={rip.rows}
            selling={rip.selling}
            onSellAll={confirmSellAll}
            onShip={(ids) => navigateOnce(() => leaveModalTo(shipHref(ids)))}
            onRipAgain={rip.ripAgain}
            onDone={goBackOrHome}
          />
        }
      >
        <RipSummary
          result={res}
          rows={rip.rows}
          selling={rip.selling}
          buybackLabel={buybackLabel}
          onSell={(pull) => void rip.sell([pull])}
          onKeep={(pull) => {
            haptic.selection();
            rip.keep(pull);
          }}
          onOpenHistory={() => navigateOnce(() => leaveModalTo('/history'))}
        />
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      {screen}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: spacing.xxxl },
  caption: { marginTop: spacing.xxl, alignItems: 'center', paddingHorizontal: spacing.xl },
  captionSub: { marginTop: spacing.xs },
  errorContent: { flexGrow: 1, justifyContent: 'center', paddingTop: spacing.xl },
  errorPack: { alignItems: 'center', marginBottom: spacing.xl },
  errorPackArt: { opacity: 0.7 },
  flash: { backgroundColor: colors.text },
});
