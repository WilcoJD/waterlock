/**
 * Odds sheet (modal): pack art + price, min/max/hit rate/card count (no EV), the provably-fair note,
 * and every card grouped by tier with its value, chance and "1 in N". "Rip" closes the sheet and
 * opens the rip screen.
 */
import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { OddsRow, PackSummary } from '@ripvault/shared';
import { getPack } from '../../src/api/client.ts';
import { useQuery } from '../../src/hooks/useQuery.ts';
import { useAppConfig } from '../../src/state/config.tsx';
import { radii, spacing } from '../../src/theme.ts';
import {
  AppHeader,
  AppText,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Skeleton,
  goBackOrHome,
  themedRefreshControl,
  useToast,
} from '../../src/components/index.ts';
import { OddsHeader } from '../../src/features/packs/OddsHeader.tsx';
import { OddsListRow, TierSectionHeader } from '../../src/features/packs/OddsListRow.tsx';
import { leaveModalTo } from '../../src/features/packs/nav.ts';
import { useNavLock } from '../../src/features/packs/useNavLock.ts';
import {
  firstParam,
  getRememberedPack,
  groupDigits,
  groupOddsByTier,
  openHref,
  parseQuantityParam,
  rememberPacks,
  ripLabel,
  toPackSummary,
} from '../../src/features/packs/packData.ts';
import type { TierSection } from '../../src/features/packs/packData.ts';

export default function PackOddsScreen() {
  const params = useLocalSearchParams<{ id: string; qty?: string }>();
  const packId = firstParam(params.id) ?? '';
  const { config } = useAppConfig();
  const quantity = parseQuantityParam(params.qty, config.maxOpenQuantity);
  const navigateOnce = useNavLock();

  const q = useQuery(() => getPack(packId), [packId], { enabled: packId !== '' });
  const remembered = getRememberedPack(packId);
  const pack: PackSummary | undefined = q.data ? toPackSummary(q.data) : remembered;

  useEffect(() => {
    if (q.data) rememberPacks([q.data]);
  }, [q.data]);

  // A failed pull-to-refresh keeps the odds on screen; say so with a toast.
  const toast = useToast();
  const hasData = q.data !== undefined;
  useEffect(() => {
    if (q.error && hasData) toast.error(q.error, "Couldn't refresh the odds");
  }, [q.error, hasData, toast]);

  const sections = useMemo(() => (q.data ? groupOddsByTier(q.data.odds) : []), [q.data]);

  const header = <AppHeader title={pack?.name ?? 'Pack odds'} subtitle="Odds & every card inside" back="close" />;

  if (packId === '') {
    return (
      <Screen modal header={header}>
        <EmptyState icon="help-circle-outline" title="Pack not found" message="This link doesn't point to a pack." actionLabel="Back to packs" onAction={goBackOrHome} />
      </Screen>
    );
  }
  if (!pack) {
    return (
      <Screen modal header={header}>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : <LoadingState label="Loading odds" />}
      </Screen>
    );
  }

  const footer = (
    <Button
      title={pack.soldOut ? 'Sold out' : ripLabel(quantity, pack.pricePence)}
      variant="holo"
      size="lg"
      block
      icon={pack.soldOut ? 'close-circle-outline' : 'flash'}
      haptic="medium"
      disabled={pack.soldOut}
      onPress={() => navigateOnce(() => leaveModalTo(openHref(pack.id, quantity)))}
      accessibilityLabel={pack.soldOut ? `${pack.name} is sold out` : `Rip this pack: ${ripLabel(quantity, pack.pricePence)}`}
    />
  );

  const renderRow = ({ item }: { item: OddsRow }) => <OddsListRow row={item} packPricePence={pack.pricePence} />;
  // Typed from the section objects themselves (groupOddsByTier), not from SectionList's generics.
  const renderSectionHeader = (info: { section: { tier: TierSection['tier']; chance: number; data: readonly OddsRow[] } }) => (
    <TierSectionHeader tier={info.section.tier} count={info.section.data.length} chance={info.section.chance} />
  );

  let empty: ReactNode;
  if (q.error && !q.data) {
    empty = <ErrorState error={q.error} onRetry={q.refetch} fill={false} />;
  } else if (!q.data) {
    empty = <OddsSkeleton />;
  } else {
    empty = <EmptyState icon="albums-outline" title="No cards listed" message="This pack has no odds table right now." fill={false} />;
  }

  return (
    <Screen modal header={header} footer={footer}>
      <SectionList
        sections={sections}
        keyExtractor={(row: OddsRow) => row.card.id}
        renderItem={renderRow}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={<OddsHeader pack={pack} onOpenFairness={() => navigateOnce(() => leaveModalTo('/fairness'))} />}
        ListEmptyComponent={empty}
        ListFooterComponent={
          q.data ? (
            <AppText variant="caption" tone="faint" style={styles.disclaimer}>
              Chances are exact: each card's weight divided by the pack's total weight ({groupDigits(q.data.totalWeight)}).
              Values are live market prices and move over time. "Hit" means worth at least the pack price; "Big hit" means 3× or
              more. Sell-back offers are {Number((config.buybackBps / 100).toFixed(2))}% of current market value.
            </AppText>
          ) : null
        }
        stickySectionHeadersEnabled={false}
        refreshControl={themedRefreshControl(q.refreshing, q.refresh)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
      />
    </Screen>
  );
}

function OddsSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading odds">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} height={92} radius={radii.md} style={styles.skeletonRow} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.xl },
  disclaimer: { marginTop: spacing.lg },
  skeletonRow: { marginTop: spacing.sm },
});
