import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import { colors } from '../config';
import { useSession } from '../session';
import { Button, Card, H1, Input, Muted, s } from '../ui';

export default function AuthScreen() {
  const { signIn } = useSession();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await api('POST', `/auth/${mode}`, { email, password });
      await signIn(r.token, r.user);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { flexGrow: 1, justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <Text style={{ fontSize: 48, color: colors.accent }}>▣</Text>
          <H1>TinyBox</H1>
          <Muted style={{ textAlign: 'center', marginTop: 6 }}>Free tiny Linux servers.{'\n'}Watch an ad, keep your box alive.</Muted>
        </View>
        <Card>
          <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
          <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'login' ? 'password' : 'new-password'} />
          {error ? <Text style={{ color: colors.danger, marginTop: 10 }}>{error}</Text> : null}
          <Button title={mode === 'login' ? 'Log in' : 'Create account'} kind="primary" onPress={submit} loading={busy} style={{ marginTop: 16 }} />
          <Button title={mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'} onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} style={{ marginTop: 10, backgroundColor: 'transparent', borderColor: 'transparent' }} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
