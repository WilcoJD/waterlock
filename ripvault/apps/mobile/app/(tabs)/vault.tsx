/**
 * Vault tab: every card the player owns, live value, instant sell-back and shipping.
 * - Hero: vault value + total sell-back offer (always from the "vaulted" list).
 * - Status filter (Vaulted / Shipping / Shipped / Sold) and sort (sorted on the client too, so it is instant).
 * - Multi-select (Select button or long-press) on vaulted cards -> sticky bar: sell N, ship N.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { BackHandler, FlatList, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { InventoryItem, InventoryResponse, InventorySort, InventoryStatus, SellResponse } from '@ripvault/shared';
import { getInventory } from '../../src/api/client.ts';
import { useAppConfig } from '../../src/state/config.tsx';
import { useQuery } from '../../src/hooks/useQuery.ts';
import { spacing } from '../../src/theme.ts';
import { plural } from '../../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  EmptyState,
  ErrorState,
  Screen,
  Segmented,
  themedRefreshControl,
  useScreenBottomPadding,
  useToast,
} from '../../src/components/index.ts';
import type { IconName, SegmentOption } from '../../src/components/index.ts';
import { SORT_OPTIONS, sortInventory, sortMeta, sumPence } from '../../src/features/vault/format.ts';
import { ChipButton } from '../../src/features/vault/components.tsx';
import { OptionSheet } from '../../src/features/vault/OptionSheet.tsx';
import { SelectionBar } from '../../src/features/vault/SelectionBar.tsx';
import { VaultHero } from '../../src/features/vault/VaultHero.tsx';
import { VaultTile, VaultTileSkeleton } from '../../src/features/vault/VaultTile.tsx';
import { useSellItems } from '../../src/features/vault/useSellItems.ts';
import { shipHref } from '../../src/features/vault/navigation.ts';

const STATUS_OPTIONS: readonly SegmentOption<InventoryStatus>[] = [
  { value: 'vaulted', label: 'Vaulted' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'sold', label: 'Sold' },
];

const EMPTY_COPY: Record<InventoryStatus, { title: string; message: string; icon: IconName }> = {
  vaulted: {
    title: 'Your vault is empty',
    message: 'Every pack holds one real card. Rip a pack and your pull lands here, ready to keep, ship or sell back.',
    icon: 'cube-outline',
  },
  shipping: {
    title: 'Nothing on its way',
    message: 'Cards you ask us to ship show here until they leave our vault.',
    icon: 'paper-plane-outline',
  },
  shipped: {
    title: 'No shipped cards yet',
    message: 'Cards we have posted to you will show here.',
    icon: 'home-outline',
  },
  sold: {
    title: 'No sold cards',
    message: 'Cards you sell back appear here with the price you got.',
    icon: 'cash-outline',
  },
};

const GRID_GAP = spacing.md;
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

function removeSold(prev: InventoryResponse | undefined, res: SellResponse): InventoryResponse | undefined {
  if (!prev) return prev;
  const soldIds = new Set(res.items.map((i) => i.id));
  const items = prev.items.filter((i) => !soldIds.has(i.id));
  return {
    items,
    totalValuePence: sumPence(items, (i) => i.currentValuePence),
    totalBuybackPence: sumPence(items, (i) => (i.status === 'vaulted' ? i.buybackPence : 0)),
  };
}

export default function VaultScreen() {
  const { config } = useAppConfig();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const bottomPadding = useScreenBottomPadding();

  const [status, setStatus] = useState<InventoryStatus>('vaulted');
  const [sort, setSort] = useState<InventorySort>('value_desc');
  const [sortOpen, setSortOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY_SET);

  // The vaulted list always loads: it feeds the hero and the "Vaulted" grid.
  const vault = useQuery(() => getInventory({ status: 'vaulted', sort }), [], { refetchOnFocus: true });
  // Other statuses load on demand; tag the response with its status so we never show the wrong list.
  const other = useQuery(
    async () => ({ status, res: await getInventory({ status, sort }) }),
    [status],
    { enabled: status !== 'vaulted', refetchOnFocus: true },
  );

  const isVaulted = status === 'vaulted';
  const rawItems: InventoryItem[] | undefined = isVaulted
    ? vault.data?.items
    : other.data && other.data.status === status
      ? other.data.res.items
      : undefined;
  const listError = isVaulted ? vault.error : other.error;
  const listFetching = isVaulted ? vault.fetching : other.fetching;
  const refreshing = isVaulted ? vault.refreshing : other.refreshing;

  const items = useMemo(() => (rawItems ? sortInventory(rawItems, sort) : undefined), [rawItems, sort]);

  // A failed silent refresh while we already show data: tell the player once per error.
  const lastToastedError = useRef<unknown>(null);
  useEffect(() => {
    if (listError && rawItems && lastToastedError.current !== listError) {
      lastToastedError.current = listError;
      toast.error(listError, "Couldn't refresh your vault");
    }
  }, [listError, rawItems, toast]);

  // ---------------------------------------------------------------------------
  // Selection

  const vaultItems = vault.data?.items;
  const selectedItems = useMemo(
    () => (vaultItems ?? []).filter((i) => i.status === 'vaulted' && selectedIds.has(i.id)),
    [vaultItems, selectedIds],
  );
  const selectedBuyback = sumPence(selectedItems, (i) => i.buybackPence);
  const selectedValue = sumPence(selectedItems, (i) => i.currentValuePence);

  const exitSelecting = useCallback(() => {
    setSelecting(false);
    setSelectedIds(EMPTY_SET);
  }, []);

  const toggle = useCallback((item: InventoryItem) => {
    if (item.status !== 'vaulted') return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const onTilePress = useCallback(
    (item: InventoryItem) => {
      if (selecting) toggle(item);
      else router.push(`/item/${encodeURIComponent(item.id)}`);
    },
    [selecting, toggle],
  );

  const onTileLongPress = useCallback(
    (item: InventoryItem) => {
      if (item.status !== 'vaulted') return;
      setSelecting(true);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
    },
    [],
  );

  const allSelected = !!vaultItems && vaultItems.length > 0 && selectedItems.length === vaultItems.length;
  const toggleAll = () => {
    if (allSelected) setSelectedIds(EMPTY_SET);
    else setSelectedIds(new Set((vaultItems ?? []).map((i) => i.id)));
  };

  // Selected cards all left the vault (shipped from the ship screen, sold elsewhere): leave select mode.
  useEffect(() => {
    if (selecting && selectedIds.size > 0 && vaultItems && selectedItems.length === 0) exitSelecting();
  }, [selecting, selectedIds, vaultItems, selectedItems.length, exitSelecting]);

  // Android back exits select mode first.
  useFocusEffect(
    useCallback(() => {
      if (!selecting) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        exitSelecting();
        return true;
      });
      return () => sub.remove();
    }, [selecting, exitSelecting]),
  );

  const changeStatus = (next: InventoryStatus) => {
    if (selecting) exitSelecting();
    setStatus(next);
  };

  // ---------------------------------------------------------------------------
  // Actions

  const { confirmSell, selling } = useSellItems({
    onSold: (res) => {
      exitSelecting();
      vault.setData((prev) => removeSold(prev, res));
      void vault.refetch();
    },
    onStale: () => {
      void vault.refetch();
    },
  });

  const shipSelected = () => {
    const max = config.shipping.maxItemsPerShipment;
    if (selectedItems.length > max) {
      toast.error(`You can ship up to ${plural(max, 'card')} in one shipment. Deselect a few and try again.`);
      return;
    }
    router.push(shipHref(selectedItems.map((i) => i.id)));
  };

  const onRefresh = () => {
    if (!isVaulted) void vault.refetch();
    void (isVaulted ? vault.refresh() : other.refresh());
  };

  // ---------------------------------------------------------------------------
  // Layout

  const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const tileWidth = Math.floor((width - spacing.gutter * 2 - GRID_GAP * (columns - 1)) / columns);
  const currentSort = sortMeta(sort);
  const canSelect = isVaulted && !!vaultItems && vaultItems.length > 0;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<InventoryItem>) => (
      <VaultTile
        item={item}
        width={tileWidth}
        selecting={selecting}
        selected={selecting && selectedIds.has(item.id)}
        onPress={onTilePress}
        onLongPress={isVaulted ? onTileLongPress : undefined}
      />
    ),
    [tileWidth, selecting, selectedIds, onTilePress, onTileLongPress, isVaulted],
  );

  const header = (
    <View style={styles.header}>
      <VaultHero
        totalValuePence={vault.data?.totalValuePence}
        totalBuybackPence={vault.data?.totalBuybackPence}
        cardCount={vault.data?.items.length}
        buybackBps={config.buybackBps}
        onShipments={() => router.push('/shipments')}
      />
      <Segmented
        options={STATUS_OPTIONS}
        value={status}
        onChange={changeStatus}
        accessibilityLabel="Filter cards by status"
        style={styles.segmented}
      />
      <View style={styles.toolbar}>
        <ChipButton
          label={currentSort.short}
          icon="swap-vertical"
          iconRight="chevron-down"
          onPress={() => setSortOpen(true)}
          accessibilityLabel={`Sort: ${currentSort.label}`}
          accessibilityHint="Changes the order of your cards"
        />
        <View style={styles.toolbarRight}>
          {selecting ? (
            <>
              <ChipButton
                label={allSelected ? 'Clear' : 'Select all'}
                icon={allSelected ? 'close-circle-outline' : 'checkmark-done'}
                onPress={toggleAll}
                style={styles.toolbarGap}
              />
              <ChipButton label="Done" active onPress={exitSelecting} accessibilityLabel="Done selecting" />
            </>
          ) : canSelect ? (
            <ChipButton
              label="Select"
              icon="checkmark-circle-outline"
              onPress={() => setSelecting(true)}
              accessibilityHint="Select cards to sell back or ship together"
            />
          ) : items ? (
            <AppText variant="caption" tone="faint">
              {plural(items.length, 'card')}
            </AppText>
          ) : null}
        </View>
      </View>
    </View>
  );

  let empty: ReactElement;
  if (items === undefined && (listFetching || !listError)) {
    empty = (
      <View style={styles.skeletonGrid} accessibilityLabel="Loading cards">
        {Array.from({ length: columns * 2 }, (_, i) => (
          <VaultTileSkeleton key={i} width={tileWidth} />
        ))}
      </View>
    );
  } else if (items === undefined) {
    empty = (
      <ErrorState
        error={listError}
        title="Couldn't load your cards"
        onRetry={() => void (isVaulted ? vault.refetch() : other.refetch())}
        retrying={listFetching}
        fill={false}
      />
    );
  } else {
    const copy = EMPTY_COPY[status];
    empty = (
      <EmptyState
        icon={copy.icon}
        title={copy.title}
        message={copy.message}
        actionLabel={isVaulted ? 'Rip a pack' : undefined}
        onAction={isVaulted ? () => router.navigate('/') : undefined}
        fill={false}
      />
    );
  }

  return (
    <Screen
      header={<AppHeader />}
      padded={false}
      footer={
        selecting ? (
          <View style={styles.footer}>
            <SelectionBar
              count={selectedItems.length}
              buybackPence={selectedBuyback}
              valuePence={selectedValue}
              selling={selling}
              onSell={() => confirmSell(selectedItems)}
              onShip={shipSelected}
            />
          </View>
        ) : undefined
      }
    >
      <FlatList
        key={`grid-${columns}`}
        data={items ?? []}
        keyExtractor={(item: InventoryItem) => item.id}
        numColumns={columns}
        renderItem={renderItem}
        columnWrapperStyle={styles.row}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        extraData={selectedIds}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
        refreshControl={themedRefreshControl(refreshing, onRefresh)}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={9}
        removeClippedSubviews={Platform.OS === 'android'}
      />
      <OptionSheet
        visible={sortOpen}
        title="Sort cards"
        options={SORT_OPTIONS}
        value={sort}
        onSelect={(next) => {
          setSort(next);
          setSortOpen(false);
        }}
        onClose={() => setSortOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, flexGrow: 1 },
  header: { marginBottom: spacing.lg },
  segmented: { marginTop: spacing.lg },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    minHeight: 44,
  },
  toolbarRight: { flexDirection: 'row', alignItems: 'center' },
  toolbarGap: { marginRight: spacing.sm },
  footer: { paddingHorizontal: spacing.gutter },
  row: { gap: GRID_GAP },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
});
