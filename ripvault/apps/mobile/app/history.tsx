/**
 * Pull history: every pack opening (newest first, infinite scroll) with an on-device fairness chip.
 * Tap a pull to see its full proof on /verify/[id].
 */
import { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { router } from 'expo-router';
import type { Opening, OpeningsResponse } from '@ripvault/shared';
import { listOpenings } from '../src/api/client.ts';
import { colors, spacing } from '../src/theme.ts';
import { plural } from '../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  Button,
  EmptyState,
  ErrorState,
  Screen,
  themedRefreshControl,
  useScreenBottomPadding,
} from '../src/components/index.ts';
import { useCursorPages } from '../src/features/account/useCursorPages.ts';
import { OpeningRow } from '../src/features/account/OpeningRow.tsx';
import { withRevealedSeeds } from '../src/features/account/verification.ts';
import { Note, PageFooter, RowSkeletons, StaleBanner } from '../src/features/account/ui.tsx';

const PAGE_SIZE = 30;

const fetchOpenings = (before: string | null) => listOpenings(before, PAGE_SIZE);
const openingsPage = (res: OpeningsResponse) => ({ items: res.openings, nextCursor: res.nextCursor });
const openingKey = (o: Opening) => o.id;

export default function HistoryScreen() {
  const bottomPadding = useScreenBottomPadding();
  const list = useCursorPages(fetchOpenings, openingsPage, openingKey, { refetchOnFocus: true });
  // Rows loaded before a seed rotation pick up the revealed seed from newer rows with the same hash.
  const items = useMemo(() => withRevealedSeeds(list.items), [list.items]);
  const pending = useMemo(() => items.filter((o) => !o.serverSeed).length, [items]);

  const openVerify = useCallback((id: string) => {
    router.push({ pathname: '/verify/[id]', params: { id } });
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Opening>) => <OpeningRow opening={item} onPress={openVerify} />,
    [openVerify],
  );

  const header = (
    <View style={styles.header}>
      <AppText variant="body" tone="muted">
        Every pack you've opened. Tap a pull to recompute it on your phone.
      </AppText>
      {pending > 0 ? (
        <Note
          icon="lock-closed-outline"
          color={colors.gold}
          style={styles.note}
          action={<Button title="Seeds" variant="ghost" size="sm" onPress={() => router.push('/fairness')} />}
        >
          <AppText variant="caption" tone="muted">
            {plural(pending, 'pull')} {pending === 1 ? 'uses' : 'use'} your current seeds. Rotate them to reveal the server
            seed and verify {pending === 1 ? 'it' : 'them'}.
          </AppText>
        </Note>
      ) : null}
      {list.error && items.length > 0 ? (
        <StaleBanner error={list.error} onRetry={() => void list.refresh()} style={styles.note} />
      ) : null}
    </View>
  );

  const empty = list.loading ? (
    <RowSkeletons count={6} height={96} />
  ) : list.error ? (
    <ErrorState error={list.error} onRetry={() => void list.refetch()} fill={false} />
  ) : (
    <EmptyState
      fill={false}
      icon="layers-outline"
      title="No pulls yet"
      message="Rip your first pack and it shows up here with its fairness proof."
      actionLabel="Browse packs"
      onAction={() => router.navigate('/')}
    />
  );

  return (
    <Screen header={<AppHeader title="Pull history" back />} padded={false}>
      <FlatList
        data={items}
        keyExtractor={openingKey}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          items.length > 0 ? (
            <PageFooter
              loadingMore={list.loadingMore}
              error={list.loadMoreError}
              hasMore={list.hasMore}
              count={items.length}
              onRetry={list.retryMore}
              endLabel="That's every pack you've opened"
            />
          ) : null
        }
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={themedRefreshControl(list.refreshing, () => void list.refresh())}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        windowSize={11}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xs },
  header: { marginBottom: spacing.lg },
  note: { marginTop: spacing.md },
});
