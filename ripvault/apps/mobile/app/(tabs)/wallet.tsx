/**
 * Wallet tab: balance hero (Top up / Cash out), link to the vault's value, and the full ledger with
 * infinite scroll, pull-to-refresh and refetch on focus. Also handles the Stripe return deep link
 * ripvault://wallet?topup=success|cancel.
 */
import { useCallback, useEffect, useRef } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { Transaction, WalletResponse } from '@ripvault/shared';
import { getWallet } from '../../src/api/client.ts';
import { useSession } from '../../src/state/session.tsx';
import { useAppConfig } from '../../src/state/config.tsx';
import { spacing } from '../../src/theme.ts';
import {
  AppHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  SectionHeader,
  themedRefreshControl,
  useScreenBottomPadding,
  useToast,
} from '../../src/components/index.ts';
import { useCursorPages } from '../../src/features/account/useCursorPages.ts';
import { BalanceHero } from '../../src/features/account/BalanceHero.tsx';
import { TransactionRow } from '../../src/features/account/TransactionRow.tsx';
import { PageFooter, RowSkeletons, StaleBanner } from '../../src/features/account/ui.tsx';

const PAGE_SIZE = 30;
/** After a Stripe return, check again a little later (the webhook can land after the redirect). */
const RECHECK_MS = 4_000;

const fetchWalletPage = (before: string | null) => getWallet(before, PAGE_SIZE);
const walletPage = (res: WalletResponse) => ({ items: res.transactions, nextCursor: res.nextCursor });
const transactionKey = (t: Transaction) => t.id;

export default function WalletScreen() {
  const { user, setBalance, refreshUser } = useSession();
  const { config } = useAppConfig();
  const toast = useToast();
  const bottomPadding = useScreenBottomPadding();
  const list = useCursorPages(fetchWalletPage, walletPage, transactionKey, { refetchOnFocus: true });

  // The ledger response carries the authoritative balance: keep the header pill in step.
  useEffect(() => {
    if (list.firstPage) setBalance(list.firstPage.balancePence);
  }, [list.firstPage, setBalance]);

  // Stripe Checkout return page links to ripvault://wallet?topup=success|cancel.
  const { topup } = useLocalSearchParams<{ topup?: string }>();
  const recheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refetch } = list;
  useEffect(() => {
    if (topup !== 'success' && topup !== 'cancel') return;
    router.setParams({ topup: undefined });
    if (topup === 'cancel') {
      toast.info('Top-up cancelled. You have not been charged.');
      return;
    }
    toast.success('Payment received. Your balance updates as soon as it clears.', 'Top-up');
    void refreshUser();
    void refetch();
    if (recheckTimer.current) clearTimeout(recheckTimer.current);
    recheckTimer.current = setTimeout(() => {
      void refreshUser();
      void refetch();
    }, RECHECK_MS);
  }, [topup, refetch, refreshUser, toast]);
  useEffect(
    () => () => {
      if (recheckTimer.current) clearTimeout(recheckTimer.current);
    },
    [],
  );

  const count = list.items.length;
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Transaction>) => (
      <TransactionRow tx={item} first={index === 0} last={index === count - 1} />
    ),
    [count],
  );

  if (!user) {
    return (
      <Screen header={<AppHeader />}>
        <LoadingState />
      </Screen>
    );
  }

  const header = (
    <View>
      <BalanceHero
        balancePence={user.balancePence}
        vaultValuePence={user.stats.vaultValuePence}
        cardsInVault={user.stats.cardsInVault}
        canCashOut={config.withdrawals.enabled}
        onTopUp={() => router.push('/topup')}
        onCashOut={() => router.push('/withdraw')}
        onOpenVault={() => router.navigate('/vault')}
      />
      <SectionHeader title="Activity" />
      {list.error && count > 0 ? <StaleBanner error={list.error} onRetry={() => void list.refresh()} style={styles.banner} /> : null}
    </View>
  );

  const empty = list.loading ? (
    <RowSkeletons count={6} />
  ) : list.error ? (
    <ErrorState error={list.error} onRetry={() => void list.refetch()} fill={false} />
  ) : (
    <EmptyState
      fill={false}
      icon="receipt-outline"
      title="No activity yet"
      message="Top-ups, rips, sell-backs and shipping all show up here."
      actionLabel="Top up"
      onAction={() => router.push('/topup')}
    />
  );

  return (
    <Screen header={<AppHeader />} padded={false}>
      <FlatList
        data={list.items}
        keyExtractor={transactionKey}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          count > 0 ? (
            <PageFooter
              loadingMore={list.loadingMore}
              error={list.loadMoreError}
              hasMore={list.hasMore}
              count={count}
              onRetry={list.retryMore}
              endLabel="That's your whole history"
            />
          ) : null
        }
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={themedRefreshControl(list.refreshing, () => {
          void list.refresh();
          void refreshUser();
        })}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        windowSize={11}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  banner: { marginBottom: spacing.md },
});
