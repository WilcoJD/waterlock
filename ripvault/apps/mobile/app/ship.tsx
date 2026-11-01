/**
 * Ship cards home. Route param `items` = comma-separated inventory item ids (from the Vault
 * multi-select or the item screen). Pick a saved address, see the quote, confirm -> POST /shipments
 * (idempotent per action) -> balance updated -> replaced by the shipment detail screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { formatPence } from '@ripvault/shared';
import type { InventoryItem } from '@ripvault/shared';
import { createShipment, getInventory, getShippingQuote, listAddresses } from '../src/api/client.ts';
import type { ApiError } from '../src/api/client.ts';
import { useSession } from '../src/state/session.tsx';
import { useAppConfig } from '../src/state/config.tsx';
import { useQuery } from '../src/hooks/useQuery.ts';
import { colors, radii, spacing, withAlpha } from '../src/theme.ts';
import { plural } from '../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  Button,
  CardArt,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  MoneyText,
  Panel,
  Screen,
  SectionHeader,
  Skeleton,
  useToast,
} from '../src/components/index.ts';
import type { IconName } from '../src/components/index.ts';
import { presentActionError, useActionKey } from '../src/features/vault/actions.ts';
import { goToVault } from '../src/features/vault/navigation.ts';
import { sumPence } from '../src/features/vault/format.ts';
import { AddressCard } from '../src/features/shipping/AddressCard.tsx';

/** "a,b,,c" / ["a,b", "c"] -> unique non-empty ids in order. */
function parseIds(raw: string | string[] | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((s) => s.split(','));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    let id = part.trim();
    try {
      id = decodeURIComponent(id);
    } catch {
      // keep as-is
    }
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export default function ShipScreen() {
  const params = useLocalSearchParams<{ items: string }>();
  const rawItems: string | string[] | undefined = params.items;
  const requestedIds = useMemo(() => parseIds(rawItems), [Array.isArray(rawItems) ? rawItems.join(',') : rawItems]);

  const { user, setBalance, refreshUser } = useSession();
  const { config } = useAppConfig();
  const toast = useToast();
  const actionKey = useActionKey();

  const inventory = useQuery(() => getInventory({ status: 'vaulted' }), [], {
    enabled: requestedIds.length > 0,
    refetchOnFocus: true,
  });
  // Refetched on focus so a new address added on /addresses shows up (and gets selected) on return.
  const addresses = useQuery(() => listAddresses(), [], { refetchOnFocus: true });

  // Cards that are still in the vault, in the order they were chosen.
  const items: InventoryItem[] = useMemo(() => {
    const vaulted = new Map((inventory.data?.items ?? []).map((i) => [i.id, i] as const));
    const out: InventoryItem[] = [];
    for (const id of requestedIds) {
      const item = vaulted.get(id);
      if (item) out.push(item);
    }
    return out;
  }, [inventory.data, requestedIds]);
  const missingCount = inventory.data ? requestedIds.length - items.length : 0;
  // Sorted so retries send a byte-identical body (the idempotency key is bound to it).
  const itemIds = useMemo(() => items.map((i) => i.id).sort(), [items]);
  const idsKey = itemIds.join(',');
  const maxItems = config.shipping.maxItemsPerShipment;
  const tooMany = items.length > maxItems;

  const quote = useQuery(() => getShippingQuote(itemIds), [idsKey], { enabled: itemIds.length > 0 && !tooMany });

  // The quote says some cards are no longer vaulted: refresh the selection once per error.
  const handledQuoteError = useRef<ApiError | null>(null);
  const refetchInventory = inventory.refetch;
  useEffect(() => {
    const err = quote.error;
    if (err && err !== handledQuoteError.current && (err.code === 'invalid_state' || err.code === 'not_found')) {
      handledQuoteError.current = err;
      void refetchInventory();
    }
  }, [quote.error, refetchInventory]);

  // ---------------------------------------------------------------------------
  // Address selection: keep the current choice, pick a newly added address, else the newest.

  const [addressId, setAddressId] = useState<string | null>(null);
  const knownAddressIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const list = addresses.data;
    if (!list) return;
    const known = knownAddressIds.current;
    const added = known ? list.find((a) => !known.has(a.id)) : undefined;
    knownAddressIds.current = new Set(list.map((a) => a.id));
    setAddressId((current) => {
      if (added) return added.id;
      if (current && list.some((a) => a.id === current)) return current;
      return list[0]?.id ?? null;
    });
  }, [addresses.data]);

  const openAddresses = () => router.push('/addresses?select=1');

  // ---------------------------------------------------------------------------
  // Confirm

  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const fee = quote.data?.feePence;
  const balance = user?.balancePence ?? 0;
  const shortfall = fee !== undefined && fee > balance ? fee - balance : 0;
  const totalValue = quote.data?.totalValuePence ?? sumPence(items, (i) => i.currentValuePence);
  const canConfirm = !!addressId && !!quote.data && items.length > 0 && !tooMany && !quote.fetching;

  const confirm = async () => {
    if (submittingRef.current || !canConfirm || !addressId) return;
    submittingRef.current = true;
    setSubmitting(true);
    const key = actionKey.keyFor(`ship:${addressId}:${idsKey}`);
    try {
      const res = await createShipment({ itemIds, addressId }, key);
      actionKey.reset();
      setBalance(res.balancePence);
      void refreshUser();
      const count = plural(res.shipment.itemCount, 'card');
      toast.success(
        res.shipment.feePence > 0 ? `${count} requested. ${formatPence(res.shipment.feePence)} paid from your balance.` : `${count} requested. Shipping is free.`,
        'Shipment requested',
      );
      router.replace(`/shipments/${encodeURIComponent(res.shipment.id)}`);
    } catch (e) {
      presentActionError(e, 'ship', {
        toast,
        onStale: () => {
          void inventory.refetch();
          void addresses.refetch();
        },
      });
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const header = <AppHeader title="Ship to me" back />;

  // ---------------------------------------------------------------------------
  // Whole-screen states

  if (requestedIds.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          icon="paper-plane-outline"
          title="No cards selected"
          message="Choose the cards you want delivered from your vault, then tap Ship."
          actionLabel="Go to vault"
          onAction={goToVault}
        />
      </Screen>
    );
  }
  if (!inventory.data) {
    return (
      <Screen header={header}>
        {inventory.error && !inventory.fetching ? (
          <ErrorState error={inventory.error} title="Couldn't load your cards" onRetry={() => void inventory.refetch()} />
        ) : (
          <LoadingState label="Getting your cards ready" />
        )}
      </Screen>
    );
  }
  if (items.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          icon="alert-circle-outline"
          title="Nothing left to ship"
          message="These cards are no longer in your vault. They may already be shipping or have been sold."
          actionLabel="Back to vault"
          actionVariant="secondary"
          onAction={goToVault}
        />
      </Screen>
    );
  }

  const freeOver = config.shipping.freeOverPence;
  const footer = (
    <Button
      title={fee === undefined ? 'Confirm shipment' : `Confirm shipment • ${fee === 0 ? 'FREE' : formatPence(fee)}`}
      variant="holo"
      size="lg"
      block
      icon="paper-plane"
      disabled={!canConfirm}
      loading={submitting}
      haptic="medium"
      onPress={() => void confirm()}
      accessibilityHint={addressId ? undefined : 'Add a delivery address first'}
    />
  );

  return (
    <Screen
      header={header}
      scroll
      refreshing={inventory.refreshing}
      onRefresh={() => {
        void inventory.refresh();
        void addresses.refetch();
        void quote.refetch();
      }}
      footer={footer}
    >
      {missingCount > 0 ? (
        <Notice
          icon="information-circle"
          color={colors.warning}
          text={`${plural(missingCount, 'card')} ${missingCount === 1 ? 'is' : 'are'} no longer in your vault and ${
            missingCount === 1 ? 'was' : 'were'
          } left out.`}
        />
      ) : null}

      {/* Cards ---------------------------------------------------------------- */}
      <SectionHeader title={`Cards · ${items.length}`} />
      <Panel padded={false} style={styles.section}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
          {items.map((item) => (
            <CardArt key={item.id} card={item.card} size="sm" showValue valuePence={item.currentValuePence} style={styles.thumb} />
          ))}
        </ScrollView>
        <View style={styles.totalRow}>
          <AppText variant="label">Total card value</AppText>
          <MoneyText pence={totalValue} size={20} />
        </View>
      </Panel>
      {tooMany ? (
        <Notice
          icon="alert-circle"
          color={colors.danger}
          text={`You can ship up to ${plural(maxItems, 'card')} in one shipment. Go back and select fewer cards.`}
        />
      ) : null}

      {/* Address --------------------------------------------------------------- */}
      <SectionHeader
        title="Deliver to"
        actionLabel={addresses.data && addresses.data.length > 0 ? 'Manage' : undefined}
        onAction={() => router.push('/addresses')}
      />
      <View style={styles.section}>
        {addresses.data === undefined ? (
          addresses.error && !addresses.fetching ? (
            <Panel>
              <ErrorState error={addresses.error} title="Couldn't load addresses" onRetry={() => void addresses.refetch()} fill={false} />
            </Panel>
          ) : (
            <Skeleton height={96} radius={radii.lg} />
          )
        ) : addresses.data.length === 0 ? (
          <Panel style={styles.noAddress}>
            <Ionicons name="location-outline" size={28} color={colors.gold} />
            <AppText variant="body" weight="700" align="center" style={styles.noAddressTitle}>
              Where should we send them?
            </AppText>
            <AppText variant="caption" tone="muted" align="center" style={styles.noAddressText}>
              Add a delivery address to continue.
            </AppText>
            <Button title="Add address" icon="add" variant="primary" onPress={openAddresses} />
          </Panel>
        ) : (
          <>
            {addresses.data.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                selected={address.id === addressId}
                onPress={() => setAddressId(address.id)}
                style={styles.addressGap}
              />
            ))}
            <Panel padded={false}>
              <ListRow title="Add new address" icon="add-circle-outline" iconColor={colors.gold} onPress={openAddresses} />
            </Panel>
          </>
        )}
      </View>

      {/* Quote ------------------------------------------------------------------ */}
      <SectionHeader title="Shipping" />
      <Panel raised style={styles.section}>
        <View style={styles.quoteRow}>
          <AppText variant="body" weight="600">
            Shipping fee
          </AppText>
          {quote.data ? (
            quote.data.feePence === 0 ? (
              <AppText variant="money" size={20} tone="success">
                FREE
              </AppText>
            ) : (
              <MoneyText pence={quote.data.feePence} size={20} />
            )
          ) : quote.error && !quote.fetching ? (
            <Button title="Retry" icon="refresh" variant="ghost" size="sm" onPress={() => void quote.refetch()} />
          ) : tooMany ? (
            <AppText variant="caption" tone="faint">
              n/a
            </AppText>
          ) : (
            <Skeleton width={64} height={20} />
          )}
        </View>
        {quote.error && !quote.data && !quote.fetching ? (
          <AppText variant="caption" tone="danger" style={styles.quoteNote}>
            {quote.error.code === 'invalid_state' ? 'Some cards changed. Refreshing your selection.' : quote.error.message}
          </AppText>
        ) : null}
        {quote.data && freeOver !== null ? (
          <AppText variant="caption" tone={quote.data.feePence === 0 ? 'success' : 'muted'} style={styles.quoteNote}>
            {quote.data.feePence === 0
              ? `Your cards are worth ${formatPence(freeOver, { trimWholePounds: true })} or more, so shipping is on us.`
              : `Free shipping on orders over ${formatPence(freeOver, { trimWholePounds: true })} in card value.`}
          </AppText>
        ) : null}
        <View style={styles.divider} />
        <View style={styles.quoteRow}>
          <AppText variant="caption" tone="muted">
            Your balance
          </AppText>
          <MoneyText pence={balance} size={15} tone="muted" />
        </View>
        {fee !== undefined && fee > 0 ? (
          <View style={[styles.quoteRow, styles.quoteRowGap]}>
            <AppText variant="caption" tone="muted">
              After shipping
            </AppText>
            <MoneyText pence={balance - fee} size={15} tone={shortfall > 0 ? 'danger' : 'default'} />
          </View>
        ) : null}
      </Panel>

      {shortfall > 0 ? (
        <Panel glowColor={colors.danger} style={styles.section}>
          <View style={styles.shortfall}>
            <Ionicons name="wallet-outline" size={22} color={colors.danger} />
            <View style={styles.shortfallText}>
              <AppText variant="body" weight="700">
                Top up {formatPence(shortfall)} to ship
              </AppText>
              <AppText variant="caption" tone="muted">
                Your balance doesn't cover the shipping fee yet.
              </AppText>
            </View>
          </View>
          <Button title="Top up" icon="add" variant="primary" size="sm" onPress={() => router.push('/topup')} style={styles.topUp} />
        </Panel>
      ) : null}

      <Notice
        icon="shield-checkmark-outline"
        color={colors.violet}
        text={
          'Every shipment is tracked and insured for the full market value of the cards. You can cancel for a full refund ' +
          'while it is still "Requested". Once shipped, cards leave your vault and can no longer be sold back.'
        }
      />
    </Screen>
  );
}

function Notice({ icon, color, text }: { icon: IconName; color: string; text: string }) {
  return (
    <View style={[styles.notice, { borderColor: withAlpha(color, 0.45) }]} accessible accessibilityLabel={text}>
      <Ionicons name={icon} size={18} color={color} style={styles.noticeIcon} />
      <AppText variant="caption" tone="muted" style={styles.noticeText}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.xl },
  thumbs: { padding: spacing.lg, paddingRight: spacing.sm },
  thumb: { marginRight: spacing.md },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addressGap: { marginBottom: spacing.sm },
  noAddress: { alignItems: 'center', paddingVertical: spacing.xl },
  noAddressTitle: { marginTop: spacing.sm },
  noAddressText: { marginTop: spacing.xs, marginBottom: spacing.lg },
  quoteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 },
  quoteRowGap: { marginTop: spacing.xs },
  quoteNote: { marginTop: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginVertical: spacing.md },
  shortfall: { flexDirection: 'row', alignItems: 'flex-start' },
  shortfallText: { flex: 1, marginLeft: spacing.md },
  topUp: { marginTop: spacing.md, marginLeft: 22 + spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  noticeIcon: { marginRight: spacing.sm, marginTop: 1 },
  noticeText: { flex: 1 },
});
