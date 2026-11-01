import React, { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { api, fmt } from '../api';
import { checkout } from '../checkout';
import { colors } from '../config';
import { Badge, Button, Card, H1, H2, Input, Muted, T, s } from '../ui';

export default function ShopScreen({ navigation }) {
  const [data, setData] = useState(null);
  const [buying, setBuying] = useState(null);
  const [hostname, setHostname] = useState('');
  const [sshKey, setSshKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('GET', '/shop/plans').then(setData).catch((e) => Alert.alert('Error', e.message)); }, []);

  const buy = async () => {
    setBusy(true);
    try {
      const r = await checkout({ kind: 'new', plan_id: buying.id, hostname: hostname.trim() || undefined, ssh_key: sshKey.trim() || undefined });
      if (!r) return;
      setBuying(null); setHostname(''); setSshKey('');
      if (r.order.status !== 'fulfilled' || !r.server) return Alert.alert('Order problem', 'Payment received but setup failed – please contact support.');
      navigation.navigate('Servers', { screen: 'Server', params: { id: r.server.id, hostname: r.server.hostname, rootPassword: r.root_password } });
    } catch (e) { Alert.alert('Checkout failed', e.message); } finally { setBusy(false); }
  };

  if (!data) return <View style={s.screen} />;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.pad}>
        <H1>Plans</H1>
        <Muted>No ads, never expire early, 30 days per purchase. Upgrade or renew any time from a server's page.</Muted>
        {data.plans.map((p) => (
          <Card key={p.id} highlight={p.id === 'micro'}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <View style={s.row}><H2 style={{ marginBottom: 0 }}>{p.name}</H2>{p.is_free ? <Badge label="free" /> : null}{p.id === 'micro' ? <Badge label="active" /> : null}</View>
              <T style={{ fontSize: 22, fontWeight: '800' }}>{fmt.money(p.price_cents)}</T>
            </View>
            <Muted style={{ marginTop: 6 }}>{p.cores} vCPU{p.cpulimit < p.cores ? ` (${Math.round(p.cpulimit * 100)}% cap)` : ''} · {fmt.mb(p.memory_mb)} RAM · {p.disk_gb} GB SSD · {p.net_rate_mbps} Mbit/s</Muted>
            {p.is_free
              ? <Muted style={{ marginTop: 6, color: colors.free }}>{data.free.hoursInitial}h to start, +{data.free.hoursPerAd}h per ad. Launch it from "My servers".</Muted>
              : <Button title={`Buy ${p.name}`} kind={p.id === 'micro' ? 'blue' : 'default'} style={{ marginTop: 12 }} onPress={() => setBuying(p)} />}
          </Card>
        ))}
      </ScrollView>

      <Modal visible={!!buying} animationType="slide" transparent onRequestClose={() => setBuying(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.6)' }}>
          <Card style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 32 }}>
            <H2>New {buying?.name} server – {buying && fmt.money(buying.price_cents)}</H2>
            <Input label="Hostname (optional)" value={hostname} onChangeText={setHostname} placeholder="my-server" maxLength={32} />
            <Input label="SSH public key (optional)" value={sshKey} onChangeText={setSshKey} placeholder="ssh-ed25519 AAAA..." multiline />
            <View style={[s.row, { marginTop: 16 }]}>
              <Button title="Continue to payment" kind="primary" onPress={buy} loading={busy} />
              <Button title="Cancel" onPress={() => setBuying(null)} disabled={busy} />
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}
