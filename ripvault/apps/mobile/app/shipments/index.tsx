/** Shipment requests, newest first (the API already orders them). Tap one for tracking and items. */
import { useCallback, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { router } from 'expo-router';
import { formatPence } from '@ripvault/shared';
import type { Shipment } from '@ripvault/shared';
import { listShipments } from '../../src/api/client.ts';
import { useQuery } from '../../src/hooks/useQuery.ts';
import { useAppConfig } from '../../src/state/config.tsx';
import { radii, spacing } from '../../src/theme.ts';
import {
  AppHeader,
  EmptyState,
  ErrorState,
  Screen,
  Skeleton,
  themedRefreshControl,
  useScreenBottomPadding,
  useToast,
} from '../../src/components/index.ts';
import { ShipmentCard } from '../../src/features/shipping/ShipmentCard.tsx';
import { goToVault } from '../../src/features/vault/navigation.ts';

export default function ShipmentsScreen() {
  const q = useQuery(() => listShipments(), [], { refetchOnFocus: true });
  const toast = useToast();
  const { config } = useAppConfig();
  const freeOver = config.shipping.freeOverPence;
  const bottomPadding = useScreenBottomPadding();

  // A failed background refresh while we already show the list: say so once.
  const lastToasted = useRef<unknown>(null);
  useEffect(() => {
    if (q.error && q.data && lastToasted.current !== q.error) {
      lastToasted.current = q.error;
      toast.error(q.error, "Couldn't refresh shipments");
    }
  }, [q.error, q.data, toast]);

  const open = useCallback((shipment: Shipment) => {
    router.push(`/shipments/${encodeURIComponent(shipment.id)}`);
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Shipment>) => <ShipmentCard shipment={item} onPress={open} />,
    [open],
  );

  let empty: ReactElement;
  if (!q.data && q.error && !q.fetching) {
    empty = <ErrorState error={q.error} title="Couldn't load shipments" onRetry={() => void q.refetch()} />;
  } else if (!q.data) {
    empty = (
      <>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={104} radius={radii.lg} style={styles.skeleton} />
        ))}
      </>
    );
  } else {
    empty = (
      <EmptyState
        icon="paper-plane-outline"
        title="No shipments yet"
        message={`Want a card in your hands? Select cards in your vault and tap Ship.${
          freeOver !== null ? ` Orders worth ${formatPence(freeOver, { trimWholePounds: true })} or more ship free.` : ''
        }`}
        actionLabel="Go to vault"
        onAction={goToVault}
      />
    );
  }

  return (
    <Screen header={<AppHeader title="Shipments" back />} padded={false}>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(s: Shipment) => s.id}
        renderItem={renderItem}
        ListEmptyComponent={empty}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
        refreshControl={themedRefreshControl(q.refreshing, () => void q.refresh())}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, flexGrow: 1 },
  skeleton: { marginBottom: spacing.md },
});
