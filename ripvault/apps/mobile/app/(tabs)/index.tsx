/**
 * Packs tab: the pack shop. Snapping carousel of packs, the focused pack's details, odds stats,
 * quantity, and the holo "Rip" call to action (pinned in the footer).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatPence } from '@ripvault/shared';
import type { PackSummary } from '@ripvault/shared';
import { listPacks } from '../../src/api/client.ts';
import { useQuery } from '../../src/hooks/useQuery.ts';
import { useSession } from '../../src/state/session.tsx';
import { useAppConfig } from '../../src/state/config.tsx';
import { colors, radii, spacing, withAlpha } from '../../src/theme.ts';
import { formatDateTime } from '../../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  Panel,
  Pill,
  PressableScale,
  Screen,
  Skeleton,
} from '../../src/components/index.ts';
import { PackCarousel, carouselMetrics } from '../../src/features/packs/PackCarousel.tsx';
import { packArtHeight } from '../../src/features/packs/PackArt.tsx';
import { PackStatRow } from '../../src/features/packs/PackStats.tsx';
import { QuantitySelector } from '../../src/features/packs/QuantitySelector.tsx';
import { FadeSwap } from '../../src/features/packs/FadeSwap.tsx';
import { useNavLock } from '../../src/features/packs/useNavLock.ts';
import { clampQuantity, oddsHref, openHref, rememberPacks, ripLabel } from '../../src/features/packs/packData.ts';

export default function PacksScreen() {
  const packsQ = useQuery(() => listPacks(), [], { refetchOnFocus: true });
  const { user, refreshUser } = useSession();
  const { config } = useAppConfig();
  const navigateOnce = useNavLock();
  const [index, setIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);

  const packs = packsQ.data ?? [];
  const safeIndex = packs.length > 0 ? Math.min(index, packs.length - 1) : 0;
  const pack: PackSummary | undefined = packs[safeIndex];
  const maxQuantity = Math.max(1, config.maxOpenQuantity);
  const qty = clampQuantity(quantity, maxQuantity);

  useEffect(() => {
    if (packsQ.data) rememberPacks(packsQ.data, { replace: true });
  }, [packsQ.data]);

  useEffect(() => {
    if (index !== safeIndex) setIndex(safeIndex);
  }, [index, safeIndex]);

  const onRefresh = useCallback(() => {
    void refreshUser();
    void packsQ.refresh();
  }, [refreshUser, packsQ.refresh]);

  const openOdds = useCallback(
    (p: PackSummary) => navigateOnce(() => router.push(oddsHref(p.id, qty))),
    [navigateOnce, qty],
  );

  const coolingOffUntil = user?.limits.coolingOffUntil ?? null;
  const coolingOff = coolingOffUntil !== null && Date.parse(coolingOffUntil) > Date.now();

  let body: ReactNode;
  if (packsQ.loading) {
    body = <ShopSkeleton />;
  } else if (packsQ.error && !packsQ.data) {
    body = <ErrorState error={packsQ.error} onRetry={packsQ.refetch} />;
  } else if (!pack) {
    body = (
      <EmptyState
        icon="layers-outline"
        title="No packs on the shelf"
        message="New packs are being restocked. Pull down to refresh or check back soon."
        actionLabel="Refresh"
        actionVariant="secondary"
        onAction={packsQ.refetch}
      />
    );
  } else {
    body = (
      <>
        <View style={styles.intro}>
          <AppText variant="title">Pick a pack</AppText>
          <AppText variant="caption" tone="muted" style={styles.introText}>
            Every pack holds one real card from our vault. Rip it and see its live market value.
          </AppText>
        </View>

        {packsQ.error ? (
          <PressableScale onPress={packsQ.refetch} style={styles.staleBanner} accessibilityLabel="Couldn't refresh packs. Tap to try again">
            <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
            <AppText variant="caption" color={colors.text} style={styles.staleText}>
              Couldn't refresh. Showing the last packs we loaded.
            </AppText>
            <AppText variant="caption" weight="800" tone="gold">
              Retry
            </AppText>
          </PressableScale>
        ) : null}

        <PackCarousel packs={packs} index={safeIndex} onIndexChange={setIndex} onPressPack={openOdds} />

        <View style={styles.gutter}>
          <FadeSwap swapKey={pack.id}>
            <View style={styles.infoRow}>
              <View style={styles.infoText}>
                <AppText variant="title" size={26} numberOfLines={1} adjustsFontSizeToFit>
                  {pack.name}
                </AppText>
                {pack.tagline ? (
                  <AppText variant="body" tone="muted" numberOfLines={2} style={styles.tagline}>
                    {pack.tagline}
                  </AppText>
                ) : null}
              </View>
              <PressableScale
                onPress={() => openOdds(pack)}
                haptic="tap"
                scaleTo={0.94}
                style={styles.oddsButton}
                accessibilityLabel={`View odds for ${pack.name}`}
                accessibilityHint="Shows every card in this pack and its chance"
              >
                <Ionicons name="eye-outline" size={18} color={colors.gold} />
                <AppText variant="caption" weight="800" color={colors.gold} style={styles.oddsLabel}>
                  Odds
                </AppText>
              </PressableScale>
            </View>
            <View style={styles.pills}>
              <Pill label={`${formatPence(pack.pricePence)} per pack`} color={colors.gold} icon="pricetag-outline" size="md" />
              <Pill label={`${pack.cardCount} cards`} color={colors.violet} icon="albums-outline" size="md" style={styles.pillGap} />
              {pack.soldOut ? <Pill label="Sold out" color={colors.danger} size="md" style={styles.pillGap} /> : null}
            </View>
            <PackStatRow
              minPullPence={pack.minPullPence}
              maxPullPence={pack.maxPullPence}
              hitChance={pack.hitChance}
              style={styles.stats}
            />
            <AppText variant="caption" tone="faint" size={11} style={styles.hitNote}>
              Hit rate: chance one card is worth at least the pack price.
            </AppText>
          </FadeSwap>

          <QuantitySelector
            value={qty}
            max={maxQuantity}
            onChange={setQuantity}
            unitPricePence={pack.pricePence}
            disabled={pack.soldOut}
            style={styles.quantity}
          />

          <Perks buybackBps={config.buybackBps} />

          <Panel padded={false} style={styles.fairRow}>
            <ListRow
              icon="shield-checkmark-outline"
              title="Provably fair"
              subtitle="Every pull can be checked against your seeds"
              onPress={() => navigateOnce(() => router.push('/fairness'))}
            />
          </Panel>
        </View>
      </>
    );
  }

  const cost = pack ? pack.pricePence * qty : 0;
  const balance = user?.balancePence ?? null;
  const footer = pack ? (
    <View>
      <Button
        title={pack.soldOut ? 'Sold out' : coolingOff ? 'On a break' : ripLabel(qty, pack.pricePence)}
        variant="holo"
        size="lg"
        block
        icon={pack.soldOut ? 'close-circle-outline' : coolingOff ? 'cafe-outline' : 'flash'}
        haptic="medium"
        disabled={pack.soldOut || coolingOff}
        onPress={() => navigateOnce(() => router.push(openHref(pack.id, qty)))}
        accessibilityLabel={pack.soldOut ? `${pack.name} is sold out` : `Rip ${qty} ${pack.name} ${qty === 1 ? 'pack' : 'packs'} for ${formatPence(cost)}`}
      />
      <FooterNote
        soldOut={pack.soldOut}
        coolingOffUntil={coolingOff ? coolingOffUntil : null}
        shortfallPence={balance !== null && balance < cost ? cost - balance : 0}
        onTopUp={() => router.push('/topup')}
        onLimits={() => navigateOnce(() => router.push('/limits'))}
      />
    </View>
  ) : undefined;

  return (
    <Screen
      header={<AppHeader />}
      scroll
      padded={false}
      refreshing={packsQ.refreshing}
      onRefresh={onRefresh}
      footer={footer}
      contentStyle={styles.content}
    >
      {body}
    </Screen>
  );
}

function FooterNote({
  soldOut,
  coolingOffUntil,
  shortfallPence,
  onTopUp,
  onLimits,
}: {
  soldOut: boolean;
  coolingOffUntil: string | null;
  shortfallPence: number;
  onTopUp: () => void;
  onLimits: () => void;
}) {
  let text: string;
  let action: { label: string; onPress: () => void } | null = null;
  if (soldOut) {
    text = 'A card in this pack is out of stock. Pick another pack or check back soon.';
  } else if (coolingOffUntil) {
    text = `You're taking a break until ${formatDateTime(coolingOffUntil)}.`;
    action = { label: 'Safer play', onPress: onLimits };
  } else if (shortfallPence > 0) {
    text = `You need ${formatPence(shortfallPence)} more for this rip.`;
    action = { label: 'Top up', onPress: onTopUp };
  } else {
    text = '18+ only. Play within your means.';
    action = { label: 'Set limits', onPress: onLimits };
  }
  return (
    <View style={styles.note}>
      <AppText variant="caption" tone={action ? 'muted' : 'faint'} align="center" style={styles.noteText}>
        {text}
      </AppText>
      {action ? <Button title={action.label} variant="ghost" size="sm" haptic="tap" onPress={action.onPress} style={styles.noteAction} /> : null}
    </View>
  );
}

function Perks({ buybackBps }: { buybackBps: number }) {
  const pct = `${Number((buybackBps / 100).toFixed(2))}%`;
  const items: { icon: 'cube-outline' | 'cash-outline' | 'paper-plane-outline'; title: string; body: string }[] = [
    { icon: 'cube-outline', title: 'Real cards', body: 'Held in our vault' },
    { icon: 'cash-outline', title: `Sell back ${pct}`, body: 'Instantly, any time' },
    { icon: 'paper-plane-outline', title: 'Ship it home', body: 'Tracked UK delivery' },
  ];
  return (
    <View style={styles.perks}>
      {items.map((item) => (
        <View key={item.icon} style={styles.perk} accessible accessibilityLabel={`${item.title}. ${item.body}`}>
          <View style={styles.perkIcon}>
            <Ionicons name={item.icon} size={18} color={colors.gold} />
          </View>
          <AppText variant="caption" weight="800" color={colors.text} align="center" numberOfLines={1} adjustsFontSizeToFit>
            {item.title}
          </AppText>
          <AppText variant="caption" tone="faint" size={11} align="center" numberOfLines={2}>
            {item.body}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function ShopSkeleton() {
  const { width } = useWindowDimensions();
  const { packWidth } = carouselMetrics(width);
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading packs" accessibilityRole="progressbar">
      <View style={styles.gutter}>
        <Skeleton width="55%" height={30} />
        <Skeleton width="85%" height={14} style={styles.skeletonGap} />
      </View>
      <View style={styles.skeletonPack}>
        <Skeleton width={packWidth} height={packArtHeight(packWidth, true)} radius={radii.lg} />
      </View>
      <View style={styles.gutter}>
        <Skeleton width="60%" height={26} />
        <View style={[styles.skeletonRow, styles.skeletonGap]}>
          <Skeleton width="31%" height={76} radius={radii.md} />
          <Skeleton width="31%" height={76} radius={radii.md} />
          <Skeleton width="31%" height={76} radius={radii.md} />
        </View>
        <Skeleton height={150} radius={radii.lg} style={styles.skeletonGap} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingTop: 0 },
  gutter: { paddingHorizontal: spacing.gutter },
  intro: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xs },
  introText: { marginTop: spacing.xs },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.gutter,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: withAlpha(colors.warning, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.warning, 0.3),
  },
  staleText: { flex: 1, marginHorizontal: spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md },
  infoText: { flex: 1, minWidth: 0 },
  tagline: { marginTop: spacing.xs },
  oddsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    marginLeft: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.45),
    backgroundColor: colors.goldSoft,
  },
  oddsLabel: { marginLeft: 6 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  pillGap: { marginLeft: spacing.sm },
  stats: { marginTop: spacing.lg },
  hitNote: { marginTop: spacing.sm },
  quantity: { marginTop: spacing.lg },
  perks: { flexDirection: 'row', marginTop: spacing.lg, marginHorizontal: -spacing.xs },
  perk: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgAlt,
  },
  perkIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
    marginBottom: spacing.sm,
  },
  fairRow: { marginTop: spacing.lg },
  note: { marginTop: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', minHeight: 36 },
  noteText: { flexShrink: 1 },
  noteAction: { marginLeft: -spacing.xs },
  skeleton: { paddingTop: spacing.xs },
  skeletonPack: { alignItems: 'center', paddingVertical: spacing.xl },
  skeletonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  skeletonGap: { marginTop: spacing.md },
});
