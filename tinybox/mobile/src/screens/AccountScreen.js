import React, { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AdsConsent } from 'react-native-google-mobile-ads';
import { api, fmt } from '../api';
import { API_URL } from '../config';
import { useSession } from '../session';
import { Badge, Button, Card, H2, Input, Muted, T, s } from '../ui';

export default function AccountScreen() {
  const { user, signOut } = useSession();
  const [orders, setOrders] = useState([]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => { api('GET', '/shop/orders').then((r) => setOrders(r.orders)).catch(() => {}); }, []));

  const changePw = async () => {
    setBusy(true);
    try { await api('POST', '/auth/change-password', { current, password: next }); setCurrent(''); setNext(''); Alert.alert('Password updated'); }
    catch (e) { Alert.alert('Error', e.message); } finally { setBusy(false); }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <H2>{user.email}</H2>
        <Button title="Log out" onPress={signOut} style={{ marginTop: 8 }} />
      </Card>
      <Card>
        <H2>Change password</H2>
        <Input label="Current password" value={current} onChangeText={setCurrent} secureTextEntry />
        <Input label="New password" value={next} onChangeText={setNext} secureTextEntry />
        <Button title="Update" onPress={changePw} loading={busy} style={{ marginTop: 12 }} />
      </Card>
      <Card>
        <H2>Orders</H2>
        {orders.length ? orders.map((o) => (
          <View key={o.id} style={[s.row, { justifyContent: 'space-between', paddingVertical: 6 }]}>
            <T>#{o.id} {o.kind} {o.plan_id}</T>
            <View style={s.row}><Muted>{fmt.money(o.amount_cents)}</Muted><Badge label={o.status === 'fulfilled' ? 'active' : o.status === 'failed' ? 'error' : o.status} /></View>
          </View>
        )) : <Muted>No orders yet.</Muted>}
      </Card>
      <Card>
        <H2>Privacy</H2>
        <Button small title="Ad privacy choices" onPress={() => AdsConsent.showPrivacyOptionsForm().catch(() => Alert.alert('Not required in your region'))} />
        <Button small title="Terms & fair use" style={{ marginTop: 8 }} onPress={() => Linking.openURL(`${API_URL}/#/terms`)} />
      </Card>
    </ScrollView>
  );
}
