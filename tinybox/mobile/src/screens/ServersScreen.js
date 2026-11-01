import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, fmt } from '../api';
import { Banner } from '../ads';
import { colors } from '../config';
import { Badge, Button, Card, H2, Input, Mono, Muted, T, s } from '../ui';

export default function ServersScreen({ navigation }) {
  const [servers, setServers] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [hostname, setHostname] = useState('');
  const [sshKey, setSshKey] = useState('');

  const load = useCallback(async () => {
    try { setServers((await api('GET', '/servers')).servers); } catch (e) { Alert.alert('Error', e.message); }
  }, []);

  // Refresh on focus, and poll while anything is provisioning.
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]));

  const createFree = async () => {
    setCreating(true);
    try {
      const r = await api('POST', '/servers/free', { hostname: hostname.trim() || undefined, ssh_key: sshKey.trim() || undefined });
      setShowForm(false); setHostname(''); setSshKey('');
      navigation.navigate('Server', { id: r.server.id, hostname: r.server.hostname, rootPassword: r.root_password });
    } catch (e) { Alert.alert("Couldn't create server", e.message); } finally { setCreating(false); }
  };

  const hasFree = servers?.some((x) => x.is_free);
  const hasPaid = servers?.some((x) => !x.is_free);

  return (
    <View style={s.screen}>
      <FlatList
        data={servers || []}
        keyExtractor={(x) => String(x.id)}
        contentContainerStyle={s.pad}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            {servers && !hasFree && !showForm ? <Button title="+ Launch a free server" kind="primary" onPress={() => setShowForm(true)} /> : null}
            {showForm ? (
              <Card>
                <H2>Launch a free server</H2>
                <Muted>Alpine Linux · 128 MB RAM · 1 GB disk. Lasts a few hours – watch ads to keep it alive.</Muted>
                <Input label="Hostname (optional)" value={hostname} onChangeText={setHostname} placeholder="my-box" maxLength={32} />
                <Input label="SSH public key (optional)" value={sshKey} onChangeText={setSshKey} placeholder="ssh-ed25519 AAAA..." multiline />
                <View style={[s.row, { marginTop: 14 }]}>
                  <Button title="Launch" kind="primary" onPress={createFree} loading={creating} />
                  <Button title="Cancel" onPress={() => setShowForm(false)} />
                </View>
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={servers ? <Card><Muted>No servers yet. Launch a free one – it takes a few seconds.</Muted></Card> : null}
        renderItem={({ item: x }) => (
          <Pressable onPress={() => navigation.navigate('Server', { id: x.id, hostname: x.hostname })}>
            <Card>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <View style={s.row}><H2 style={{ marginBottom: 0 }}>{x.hostname}</H2><Badge label={x.state} />{x.is_free ? <Badge label="free" /> : null}</View>
                <T style={{ fontWeight: '700' }}>{fmt.left(x.expires_at)}</T>
              </View>
              <Muted style={{ marginTop: 4 }}>{x.plan.name} · {x.plan.cores} vCPU · {fmt.mb(x.plan.memory_mb)} · {x.plan.disk_gb} GB</Muted>
              {x.ssh ? <Mono style={{ color: colors.muted, marginTop: 4 }}>{x.ssh.command}</Mono> : null}
            </Card>
          </Pressable>
        )}
      />
      {servers && !hasPaid ? <Banner /> : null}
    </View>
  );
}
