import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { api, fmt } from '../api';
import { Banner, showRewarded } from '../ads';
import { checkout } from '../checkout';
import { colors } from '../config';
import { useSession } from '../session';
import { Badge, Button, Card, H2, Meter, Mono, Muted, T, s } from '../ui';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function ServerScreen({ route, navigation }) {
  const { id } = route.params;
  const { user } = useSession();
  const [data, setData] = useState(null);
  const [ads, setAds] = useState(null);
  const [plans, setPlans] = useState([]);
  const [password, setPassword] = useState(route.params.rootPassword || null);
  const [busy, setBusy] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api('GET', `/servers/${id}`);
      setData(d);
      if (d.server.is_free) setAds(await api('GET', '/ads/status'));
      return d;
    } catch (e) {
      Alert.alert('Error', e.message);
      navigation.goBack();
    }
  }, [id, navigation]);

  useEffect(() => { api('GET', '/shop/plans').then((r) => setPlans(r.plans)).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]));

  if (!data) return <View style={s.screen} />;
  const { server: x, live } = data;
  const current = plans.find((p) => p.id === x.plan.id);
  const upgrades = current ? plans.filter((p) => p.price_cents > current.price_cents) : [];
  const canPay = ['active', 'suspended'].includes(x.state);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { Alert.alert('Oops', e.message); } finally { setBusy(null); }
  };

  const power = (action) => run(action, async () => { await api('POST', `/servers/${id}/${action}`); await load(); });

  const remove = () => Alert.alert(`Delete ${x.hostname}?`, 'All data on this server will be destroyed. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => run('delete', async () => { await api('DELETE', `/servers/${id}`); navigation.goBack(); }) },
  ]);

  const watchAd = () => run('ad', async () => {
    const before = x.expires_at;
    const earned = await showRewarded({ userId: user.id, serverId: x.id });
    if (!earned) return Alert.alert('No reward', 'Watch the whole ad to get extra time.');
    if (ads?.dev_rewards && __DEV__) {
      // Local dev: SSV callbacks can't reach localhost, so grant directly.
      await api('POST', '/ads/dev-reward', { server_id: x.id });
    } else {
      // Wait for Google's server-side verification callback to land.
      for (let i = 0; i < 10; i++) {
        await sleep(1500);
        const d = await api('GET', `/servers/${id}`);
        if (d.server.expires_at !== before) break;
      }
    }
    const d = await load();
    Alert.alert('Thanks! 🎉', `Your server now has ${fmt.left(d.server.expires_at)} left.`);
  });

  const pay = (body, key) => run(key, async () => {
    const r = await checkout({ server_id: x.id, ...body });
    if (r) { await load(); Alert.alert(r.order.status === 'fulfilled' ? 'Done! 🎉' : 'Order failed', r.order.status === 'fulfilled' ? 'Your server has been updated.' : 'Please contact support.'); }
  });

  const pickUpgrade = () => Alert.alert('Upgrade to…', 'Your files stay, the server just gets bigger.', [
    ...upgrades.map((p) => ({
      text: `${p.name} – ${fmt.money(x.is_free ? p.price_cents : Math.max(50, p.price_cents - current.price_cents))}`,
      onPress: () => pay({ kind: 'upgrade', plan_id: p.id }, 'upgrade'),
    })),
    { text: 'Cancel', style: 'cancel' },
  ]);

  const st = live?.status || x.state;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <View style={s.row}><Badge label={st} />{x.is_free ? <Badge label="free" /> : null}<Muted>{x.plan.name} · expires in {fmt.left(x.expires_at)}</Muted></View>

        {password ? (
          <Card style={{ backgroundColor: '#2b2210', borderColor: '#5c4718' }}>
            <T style={{ fontWeight: '700' }}>Root password – save it now, it won't be shown again:</T>
            <Mono selectable style={{ fontSize: 18, marginVertical: 10 }}>{password}</Mono>
            <View style={s.row}>
              <Button small title="Copy" onPress={() => Clipboard.setStringAsync(password)} />
              <Button small title="I saved it" onPress={() => setPassword(null)} />
            </View>
          </Card>
        ) : null}
        {x.state === 'provisioning' ? <Card><Muted>⏳ Creating your container… usually under a minute.</Muted></Card> : null}
        {x.state === 'error' ? <Card><Text style={{ color: colors.danger }}>{x.error}</Text></Card> : null}
        {x.state === 'suspended' ? <Card><Text style={{ color: colors.warn }}>Expired and stopped. Renew within 7 days to keep your data.</Text></Card> : null}

        {x.is_free && x.state !== 'error' ? (
          <Card highlight>
            <H2>Keep it alive</H2>
            <Muted>Watch a short ad to add {ads?.hours_per_ad ?? 1}h (up to {ads?.max_hours_ahead ?? 24}h ahead). {ads ? `${ads.remaining} left today.` : ''}</Muted>
            <Button title="▶ Watch ad  (+1h)" kind="primary" style={{ marginTop: 12 }} onPress={watchAd} loading={busy === 'ad'} disabled={ads?.remaining === 0} />
          </Card>
        ) : null}

        {x.state === 'active' ? (
          <Card>
            <H2>Power</H2>
            <View style={s.row}>
              <Button small title="Start" onPress={() => power('start')} loading={busy === 'start'} disabled={st === 'running'} />
              <Button small title="Reboot" onPress={() => power('reboot')} loading={busy === 'reboot'} disabled={st !== 'running'} />
              <Button small title="Stop" onPress={() => power('stop')} loading={busy === 'stop'} disabled={st !== 'running'} />
            </View>
          </Card>
        ) : null}

        <Card>
          <H2>Connect</H2>
          {x.ssh ? <>
            <Mono selectable>{x.ssh.command}</Mono>
            <Button small title="Copy SSH command" style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={() => Clipboard.setStringAsync(x.ssh.command)} />
          </> : <Muted>—</Muted>}
          <Muted style={{ marginTop: 10 }}>Private IP: {x.private_ip || '—'}</Muted>
          <Muted>{x.plan.cores} vCPU · {fmt.mb(x.plan.memory_mb)} RAM · {x.plan.disk_gb} GB disk</Muted>
        </Card>

        {live && live.maxmem ? (
          <Card>
            <H2>Usage</H2>
            <Muted>CPU {(live.cpu * 100).toFixed(1)}%</Muted><Meter value={live.cpu} />
            <Muted>Memory {fmt.bytes(live.mem)} / {fmt.bytes(live.maxmem)}</Muted><Meter value={live.mem / live.maxmem} />
            <Muted>Disk {fmt.bytes(live.disk)} / {fmt.bytes(live.maxdisk)}</Muted><Meter value={live.disk / live.maxdisk} />
          </Card>
        ) : null}

        {canPay ? (
          <Card>
            <H2>{x.is_free ? 'Go bigger' : 'Renew & upgrade'}</H2>
            <View style={s.row}>
              {!x.is_free && current ? <Button small kind="primary" title={`Renew 30 days – ${fmt.money(current.price_cents)}`} onPress={() => pay({ kind: 'renew' }, 'renew')} loading={busy === 'renew'} /> : null}
              {upgrades.length ? <Button small kind="blue" title="Upgrade" onPress={pickUpgrade} loading={busy === 'upgrade'} /> : null}
            </View>
          </Card>
        ) : null}

        <Button title="Delete server" kind="danger" onPress={remove} loading={busy === 'delete'} disabled={x.state === 'deleting'} />
      </ScrollView>
      {x.is_free ? <Banner /> : null}
    </View>
  );
}
