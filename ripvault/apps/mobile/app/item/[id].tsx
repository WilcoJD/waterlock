/**
 * Inventory item detail: big card art, value at pull vs now, the live sell-back offer, status,
 * and (while vaulted) "Sell for £X" / "Ship" actions. Links to the shipment when it is in one.
 */
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { formatPence } from '@ripvault/shared';
import type { InventoryItem } from '@ripvault/shared';
import { getInventoryItem } from '../../src/api/client.ts';
import { useAppConfig } from '../../src/state/config.tsx';
import { useQuery } from '../../src/hooks/useQuery.ts';
import { colors, radii, spacing, tierColors, withAlpha } from '../../src/theme.ts';
import { formatDate, formatDateTime } from '../../src/lib/format.ts';
import {
  AppHeader,
  AppText,
  Button,
  CardArt,
  ErrorState,
  ListRow,
  LoadingState,
  MoneyText,
  Panel,
  Screen,
  TierBadge,
} from '../../src/components/index.ts';
import { formatBps } from '../../src/features/vault/format.ts';
import { ItemStatusPill, ValueChangeText } from '../../src/features/vault/components.tsx';
import { useSellItems } from '../../src/features/vault/useSellItems.ts';
import { shipHref } from '../../src/features/vault/navigation.ts';

export default function ItemScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' && params.id !== '' ? params.id : undefined;
  const { config } = useAppConfig();
  const { width } = useWindowDimensions();

  const q = useQuery(() => getInventoryItem(id ?? ''), [id], { enabled: !!id, refetchOnFocus: true });
  const item = q.data;

  const { confirmSell, selling } = useSellItems({
    onSold: (res) => {
      const updated = res.items.find((i) => i.id === id);
      if (updated) q.setData(updated);
      else void q.refetch();
    },
    onStale: () => {
      void q.refetch();
    },
  });

  const header = <AppHeader title="Card" back />;

  if (!id) {
    return (
      <Screen header={header}>
        <ErrorState title="Card not found" message="This link doesn't point to a card in your vault." />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen header={header}>
        {q.error && !q.fetching ? (
          <ErrorState
            error={q.error}
            title={q.error.code === 'not_found' ? 'Card not found' : "Couldn't load this card"}
            message={q.error.code === 'not_found' ? "This card isn't in your collection." : undefined}
            onRetry={q.error.code === 'not_found' ? undefined : () => void q.refetch()}
          />
        ) : (
          <LoadingState label="Loading card" />
        )}
      </Screen>
    );
  }

  const artWidth = Math.min(width - spacing.gutter * 2 - 64, 280);
  const vaulted = item.status === 'vaulted';

  return (
    <Screen
      header={header}
      scroll
      refreshing={q.refreshing}
      onRefresh={() => void q.refresh()}
      footer={vaulted ? <ItemActions item={item} selling={selling} onSell={() => confirmSell([item])} /> : undefined}
    >
      <View style={styles.hero}>
        <LinearGradient
          colors={[withAlpha(tierColors[item.card.tier], 0.3), withAlpha(tierColors[item.card.tier], 0)]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.heroGlow}
          pointerEvents="none"
        />
        <CardArt card={item.card} width={artWidth} highRes dimmed={item.status === 'sold'} />
      </View>

      <View style={styles.titleBlock}>
        <View style={styles.badges}>
          <TierBadge tier={item.card.tier} size="md" />
          <ItemStatusPill status={item.status} size="md" style={styles.badgeGap} />
        </View>
        <AppText variant="title" align="center" style={styles.name}>
          {item.card.name}
        </AppText>
        <AppText variant="body" tone="muted" align="center">
          {item.card.setName} · #{item.card.number}
        </AppText>
        {item.card.rarity ? (
          <AppText variant="caption" tone="faint" align="center" style={styles.rarity}>
            {item.card.rarity}
          </AppText>
        ) : null}
      </View>

      <Panel raised style={styles.section}>
        <View style={styles.valueRow}>
          <View style={styles.valueCol}>
            <AppText variant="label">Value at pull</AppText>
            <MoneyText pence={item.valueAtPullPence} size={22} style={styles.valueAmount} />
            <AppText variant="caption" tone="faint">
              {formatDate(item.acquiredAt)}
            </AppText>
          </View>
          <View style={styles.valueDivider} />
          <View style={styles.valueCol}>
            <AppText variant="label">Current value</AppText>
            <MoneyText pence={item.currentValuePence} size={22} style={styles.valueAmount} />
            <ValueChangeText currentPence={item.currentValuePence} atPullPence={item.valueAtPullPence} size={12} />
          </View>
        </View>
      </Panel>

      {vaulted ? (
        <Panel glowColor={colors.gold} style={styles.section}>
          <AppText variant="label" tone="gold">
            Instant sell-back offer
          </AppText>
          <MoneyText pence={item.buybackPence} variant="display" size={34} color={colors.gold} style={styles.offer} />
          <AppText variant="caption" tone="muted">
            {formatBps(config.buybackBps)} of today's market value, credited to your balance the moment you sell. Or keep it
            safe in the vault and ship it home whenever you like.
          </AppText>
        </Panel>
      ) : null}

      {item.status === 'sold' ? (
        <Panel style={styles.section}>
          <AppText variant="label">Sold back for</AppText>
          <MoneyText pence={item.soldForPence ?? 0} variant="display" size={34} color={colors.gold} style={styles.offer} />
          {item.soldAt ? (
            <AppText variant="caption" tone="muted">
              Credited to your balance on {formatDateTime(item.soldAt)}
            </AppText>
          ) : null}
        </Panel>
      ) : null}

      {item.shipmentId && (item.status === 'shipping' || item.status === 'shipped') ? (
        <Panel padded={false} style={styles.section}>
          <ListRow
            title={item.status === 'shipping' ? 'On its way to you' : 'Shipped to you'}
            subtitle="View shipment and tracking"
            icon="paper-plane-outline"
            iconColor={colors.info}
            onPress={() => router.push(`/shipments/${encodeURIComponent(item.shipmentId ?? '')}`)}
          />
        </Panel>
      ) : null}

      <Panel padded={false} style={styles.section}>
        <ListRow title={formatDateTime(item.acquiredAt)} subtitle="Pulled" icon="sparkles-outline" iconColor={colors.gold} />
        <View style={styles.rowDivider} />
        <ListRow title={item.card.setName} subtitle="Set" icon="albums-outline" />
        <View style={styles.rowDivider} />
        <ListRow title={`#${item.card.number}`} subtitle="Card number" icon="pricetag-outline" />
        {item.packId ? (
          <>
            <View style={styles.rowDivider} />
            <ListRow
              title="From pack"
              subtitle="See the odds and rip another"
              icon="layers-outline"
              onPress={() => router.push(`/pack/${encodeURIComponent(item.packId ?? '')}`)}
            />
          </>
        ) : null}
      </Panel>

      <AppText variant="caption" tone="faint" align="center" style={styles.footnote}>
        Market values follow live card prices, so they can go up as well as down. Every pull is a real card held securely
        in the RipVault vault until you ship or sell it.
      </AppText>
    </Screen>
  );
}

function ItemActions({ item, selling, onSell }: { item: InventoryItem; selling: boolean; onSell: () => void }) {
  return (
    <View style={styles.actions}>
      <Button
        title="Ship"
        icon="paper-plane-outline"
        variant="secondary"
        size="lg"
        disabled={selling}
        onPress={() => router.push(shipHref([item.id]))}
        accessibilityLabel={`Ship ${item.card.name} home`}
        style={styles.shipButton}
      />
      <Button
        title={`Sell for ${formatPence(item.buybackPence)}`}
        icon="flash"
        variant="holo"
        size="lg"
        haptic={false}
        loading={selling}
        onPress={onSell}
        accessibilityLabel={`Sell ${item.card.name} for ${formatPence(item.buybackPence)}`}
        style={styles.sellButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: spacing.lg, paddingBottom: spacing.xl },
  heroGlow: { position: 'absolute', top: 0, left: -spacing.gutter, right: -spacing.gutter, height: 320, borderRadius: radii.xl },
  titleBlock: { alignItems: 'center', marginBottom: spacing.xl },
  badges: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  badgeGap: { marginLeft: spacing.sm },
  name: { marginBottom: spacing.xs },
  rarity: { marginTop: spacing.xs },
  section: { marginBottom: spacing.lg },
  valueRow: { flexDirection: 'row', alignItems: 'stretch' },
  valueCol: { flex: 1, minWidth: 0 },
  valueAmount: { marginTop: spacing.xs, marginBottom: 2 },
  valueDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginHorizontal: spacing.lg },
  offer: { marginTop: spacing.xs, marginBottom: spacing.sm },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.lg },
  footnote: { marginTop: spacing.sm, paddingHorizontal: spacing.lg },
  actions: { flexDirection: 'row' },
  shipButton: { flex: 1, marginRight: spacing.sm },
  sellButton: { flex: 2 },
});
