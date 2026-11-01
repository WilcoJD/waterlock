/**
 * Shipment detail: status timeline, tracking (copyable), address snapshot, fee, the cards in it,
 * and "Cancel shipment" while it is still "requested" (refunds the fee, cards go back to the vault).
 */
import { useRef, useState } from 'react';
import { Alert, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { formatPence } from '@ripvault/shared';
import type { InventoryItem } from '@ripvault/shared';
import { cancelShipment, getShipment } from '../../src/api/client.ts';
import { useSession } from '../../src/state/session.tsx';
import { useQuery } from '../../src/hooks/useQuery.ts';
import { colors, spacing } from '../../src/theme.ts';
import { formatDateTime, plural } from '../../src/lib/format.ts';
import { haptic } from '../../src/lib/haptics.ts';
import {
  AppHeader,
  AppText,
  Button,
  CardArt,
  ErrorState,
  IconButton,
  LoadingState,
  MoneyText,
  Panel,
  Pill,
  PressableScale,
  Screen,
  SectionHeader,
  useToast,
} from '../../src/components/index.ts';
import { presentActionError } from '../../src/features/vault/actions.ts';
import { AddressCard } from '../../src/features/shipping/AddressCard.tsx';
import { StatusTimeline } from '../../src/features/shipping/StatusTimeline.tsx';
import { canPlayerCancel, SHIPMENT_STATUS_META, shipmentRef } from '../../src/features/shipping/status.ts';

const GRID_GAP = spacing.md;

export default function ShipmentScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' && params.id !== '' ? params.id : undefined;
  const { setBalance, refreshUser } = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();

  const q = useQuery(() => getShipment(id ?? ''), [id], { enabled: !!id, refetchOnFocus: true });
  const shipment = q.data;

  const [cancelling, setCancelling] = useState(false);
  const cancellingRef = useRef(false);

  const header = <AppHeader title={shipment ? `Shipment ${shipmentRef(shipment.id)}` : 'Shipment'} back />;

  if (!id) {
    return (
      <Screen header={header}>
        <ErrorState title="Shipment not found" message="This link doesn't point to one of your shipments." />
      </Screen>
    );
  }
  if (!shipment) {
    return (
      <Screen header={header}>
        {q.error && !q.fetching ? (
          <ErrorState
            error={q.error}
            title={q.error.code === 'not_found' ? 'Shipment not found' : "Couldn't load this shipment"}
            onRetry={q.error.code === 'not_found' ? undefined : () => void q.refetch()}
          />
        ) : (
          <LoadingState label="Loading shipment" />
        )}
      </Screen>
    );
  }

  const meta = SHIPMENT_STATUS_META[shipment.status];
  const cancellable = canPlayerCancel(shipment.status);
  const tileWidth = Math.floor((width - spacing.gutter * 2 - GRID_GAP * 2) / 3);

  const copyTracking = async (value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      haptic.selection();
      toast.info('Tracking number copied');
    } catch {
      toast.error("Couldn't copy the tracking number");
    }
  };

  const doCancel = async () => {
    if (cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    try {
      const res = await cancelShipment(shipment.id);
      setBalance(res.balancePence);
      void refreshUser();
      q.setData(res.shipment);
      const fee = res.shipment.feePence;
      toast.success(
        fee > 0
          ? `${formatPence(fee)} refunded to your balance. Your cards are back in your vault.`
          : 'Your cards are back in your vault.',
        'Shipment cancelled',
      );
    } catch (e) {
      presentActionError(e, 'cancel', {
        toast,
        onStale: () => {
          void q.refetch();
        },
      });
    } finally {
      cancellingRef.current = false;
      setCancelling(false);
    }
  };

  const confirmCancel = () => {
    haptic.warning();
    const cards = plural(shipment.itemCount, 'card');
    Alert.alert(
      'Cancel this shipment?',
      `Your ${cards} will go back to your vault${
        shipment.feePence > 0 ? ` and the ${formatPence(shipment.feePence)} shipping fee will be refunded to your balance` : ''
      }.`,
      [
        { text: 'Keep shipment', style: 'cancel' },
        { text: 'Cancel shipment', style: 'destructive', onPress: () => void doCancel() },
      ],
    );
  };

  return (
    <Screen header={header} scroll refreshing={q.refreshing} onRefresh={() => void q.refresh()}>
      {/* Summary -------------------------------------------------------------- */}
      <Panel raised glowColor={shipment.status === 'cancelled' ? undefined : meta.color} style={styles.section}>
        <Pill label={meta.label} color={meta.color} icon={meta.icon} size="md" />
        <AppText variant="caption" tone="faint" style={styles.requested}>
          Requested {formatDateTime(shipment.createdAt)}
        </AppText>
        <View style={styles.stats}>
          <Stat label="Cards" value={String(shipment.itemCount)} />
          <View style={styles.statDivider} />
          <Stat label="Card value" pence={shipment.totalValuePence} />
          <View style={styles.statDivider} />
          {shipment.feePence === 0 ? (
            <Stat label="Shipping" value="FREE" color={colors.success} />
          ) : (
            <Stat label={shipment.status === 'cancelled' ? 'Fee (refunded)' : 'Shipping'} pence={shipment.feePence} />
          )}
        </View>
      </Panel>

      {/* Progress ------------------------------------------------------------- */}
      <SectionHeader title="Progress" />
      <Panel style={styles.section}>
        <StatusTimeline shipment={shipment} />
      </Panel>

      {/* Tracking ------------------------------------------------------------- */}
      {shipment.status !== 'cancelled' ? (
        <>
          <SectionHeader title="Tracking" />
          <Panel style={styles.section}>
            {shipment.trackingNumber ? (
              <View style={styles.trackingRow}>
                <View style={styles.trackingText}>
                  <AppText variant="label">{shipment.carrier ?? 'Carrier'}</AppText>
                  <AppText variant="money" size={18} selectable numberOfLines={1} adjustsFontSizeToFit style={styles.trackingNumber}>
                    {shipment.trackingNumber}
                  </AppText>
                </View>
                <IconButton
                  icon="copy-outline"
                  accessibilityLabel={`Copy tracking number ${shipment.trackingNumber}`}
                  onPress={() => void copyTracking(shipment.trackingNumber ?? '')}
                />
              </View>
            ) : (
              <AppText variant="caption" tone="muted">
                {shipment.carrier ? `Sending with ${shipment.carrier}. ` : ''}
                {shipment.status === 'delivered'
                  ? 'This parcel has been delivered.'
                  : 'Your tracking number will appear here as soon as your parcel ships.'}
              </AppText>
            )}
          </Panel>
        </>
      ) : null}

      {/* Address -------------------------------------------------------------- */}
      <SectionHeader title={shipment.status === 'cancelled' ? 'Was going to' : 'Delivering to'} />
      <AddressCard address={shipment.address} style={styles.section} />

      {/* Cards ---------------------------------------------------------------- */}
      <SectionHeader title={`Cards · ${shipment.items.length}`} />
      <View style={[styles.grid, styles.section]}>
        {shipment.items.map((item) => (
          <ShipmentItemTile key={item.id} item={item} width={tileWidth} />
        ))}
      </View>

      {/* Cancel --------------------------------------------------------------- */}
      {cancellable ? (
        <View style={styles.section}>
          <Button
            title="Cancel shipment"
            icon="close-circle-outline"
            variant="danger"
            block
            haptic={false}
            loading={cancelling}
            onPress={confirmCancel}
          />
          <AppText variant="caption" tone="faint" align="center" style={styles.cancelNote}>
            You can cancel until we start packing.{' '}
            {shipment.feePence > 0 ? `The ${formatPence(shipment.feePence)} fee is refunded in full.` : ''}
          </AppText>
        </View>
      ) : null}

      <AppText variant="caption" tone="faint" align="center" style={styles.footnote}>
        Every shipment is tracked and insured for the full market value of the cards.
      </AppText>
    </Screen>
  );
}

function Stat({ label, value, pence, color }: { label: string; value?: string; pence?: number; color?: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="label" size={10} numberOfLines={1}>
        {label}
      </AppText>
      {pence !== undefined ? (
        <MoneyText pence={pence} size={17} color={color} adjustsFontSizeToFit style={styles.statValue} />
      ) : (
        <AppText variant="money" size={17} color={color} numberOfLines={1} style={styles.statValue}>
          {value}
        </AppText>
      )}
    </View>
  );
}

function ShipmentItemTile({ item, width }: { item: InventoryItem; width: number }) {
  return (
    <PressableScale
      onPress={() => router.push(`/item/${encodeURIComponent(item.id)}`)}
      haptic="tap"
      scaleTo={0.96}
      accessibilityLabel={`${item.card.name}, worth ${formatPence(item.currentValuePence)}`}
      accessibilityHint="Opens card details"
      style={{ width }}
    >
      <CardArt card={item.card} width={width} />
      <AppText variant="caption" size={11} weight="700" tone="default" numberOfLines={1} style={styles.tileName}>
        {item.card.name}
      </AppText>
      <MoneyText pence={item.currentValuePence} size={13} tone="muted" />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.xl },
  requested: { marginTop: spacing.sm },
  stats: { flexDirection: 'row', alignItems: 'stretch', marginTop: spacing.lg },
  stat: { flex: 1, minWidth: 0 },
  statValue: { marginTop: spacing.xs },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginHorizontal: spacing.md },
  trackingRow: { flexDirection: 'row', alignItems: 'center' },
  trackingText: { flex: 1, minWidth: 0, marginRight: spacing.md },
  trackingNumber: { marginTop: spacing.xs, letterSpacing: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tileName: { marginTop: spacing.sm },
  cancelNote: { marginTop: spacing.sm },
  footnote: { marginTop: spacing.sm, paddingHorizontal: spacing.lg },
});
