/**
 * Saved delivery addresses: list + delete, and the "new address" form.
 * Opened from the ship screen as /addresses?select=1: the form is shown first and, once saved, we go
 * back so the ship screen (which refetches on focus) can select the new address.
 */
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { Address } from '@ripvault/shared';
import { deleteAddress, listAddresses } from '../src/api/client.ts';
import { useAppConfig } from '../src/state/config.tsx';
import { useQuery } from '../src/hooks/useQuery.ts';
import { spacing } from '../src/theme.ts';
import { haptic } from '../src/lib/haptics.ts';
import { AppHeader, AppText, Button, ErrorState, LoadingState, Panel, Screen, SectionHeader, useToast } from '../src/components/index.ts';
import { presentActionError } from '../src/features/vault/actions.ts';
import { AddressCard } from '../src/features/shipping/AddressCard.tsx';
import { AddressForm } from '../src/features/shipping/AddressForm.tsx';
import { addressSummary, countryList } from '../src/features/shipping/address.ts';

export default function AddressesScreen() {
  const params = useLocalSearchParams<{ select: string }>();
  const selectMode = params.select === '1';
  const { config } = useAppConfig();
  const toast = useToast();

  const q = useQuery(() => listAddresses(), [], { refetchOnFocus: true });
  const [formOpen, setFormOpen] = useState(selectMode);
  // Remount the form after each save so it starts empty.
  const [formKey, setFormKey] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const list = q.data;
  const showForm = formOpen || (list !== undefined && list.length === 0);
  const countries = config.shipping.countries;

  const onSaved = (address: Address) => {
    toast.success(`Delivering to ${address.fullName}, ${address.postcode}`, 'Address saved');
    if (selectMode && router.canGoBack()) {
      router.back();
      return;
    }
    q.setData((prev) => [address, ...(prev ?? []).filter((a) => a.id !== address.id)]);
    setFormOpen(false);
    setFormKey((k) => k + 1);
  };

  const remove = async (address: Address) => {
    setDeletingId(address.id);
    try {
      await deleteAddress(address.id);
      q.setData((prev) => prev?.filter((a) => a.id !== address.id));
      toast.success('Address deleted');
    } catch (e) {
      presentActionError(e, 'deleteAddress', {
        toast,
        onStale: () => {
          void q.refetch();
        },
      });
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDelete = (address: Address) => {
    haptic.warning();
    Alert.alert('Delete this address?', `${address.fullName}\n${addressSummary(address)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove(address) },
    ]);
  };

  const header = <AppHeader title={selectMode ? 'Add address' : 'Addresses'} back showBalance={false} />;

  if (!list) {
    return (
      <Screen header={header}>
        {q.error && !q.fetching ? (
          <ErrorState error={q.error} title="Couldn't load your addresses" onRetry={() => void q.refetch()} />
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  }

  const form = showForm ? (
    <View style={styles.section}>
      <SectionHeader title="New address" />
      <Panel>
        <AddressForm
          key={formKey}
          countries={countries}
          onSaved={onSaved}
          onCancel={list.length > 0 && !selectMode ? () => setFormOpen(false) : undefined}
          submitLabel={selectMode ? 'Save and use this address' : 'Save address'}
        />
      </Panel>
    </View>
  ) : null;

  const saved =
    list.length > 0 ? (
      <View style={styles.section}>
        <SectionHeader title={`Saved addresses · ${list.length}`} />
        {list.map((address) => (
          <AddressCard
            key={address.id}
            address={address}
            onDelete={() => confirmDelete(address)}
            deleting={deletingId === address.id}
            style={styles.card}
          />
        ))}
        {!showForm ? (
          <Button
            title="Add new address"
            icon="add"
            variant="secondary"
            block
            onPress={() => setFormOpen(true)}
            style={styles.addButton}
          />
        ) : null}
      </View>
    ) : null;

  return (
    <Screen header={header} scroll keyboardAvoiding refreshing={q.refreshing} onRefresh={() => void q.refresh()}>
      <AppText variant="body" tone="muted" style={styles.intro}>
        {selectMode
          ? 'Where should we send your cards? We will use this address for your shipment.'
          : `Your saved delivery addresses. We currently ship to ${countryList(countries)}.`}
      </AppText>
      {selectMode ? (
        <>
          {form}
          {saved}
        </>
      ) : (
        <>
          {saved}
          {form}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: spacing.xl },
  section: { marginBottom: spacing.xl },
  card: { marginBottom: spacing.sm },
  addButton: { marginTop: spacing.sm },
});
