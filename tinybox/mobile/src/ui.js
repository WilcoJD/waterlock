import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from './config';

export function Button({ title, onPress, kind = 'default', small, disabled, loading, style }) {
  const bg = { primary: colors.accent, blue: colors.accent2, danger: 'transparent', default: colors.panel2 }[kind];
  const fg = { primary: '#052e14', blue: '#032636', danger: colors.danger, default: colors.text }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: bg, borderColor: kind === 'danger' ? '#5b2a2a' : kind === 'default' ? colors.line : bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }, small && { fontSize: 13 }]}>{title}</Text>}
    </Pressable>
  );
}

export const Card = ({ children, style, highlight }) => <View style={[s.card, highlight && { borderColor: colors.accent }, style]}>{children}</View>;
export const H1 = ({ children, style }) => <Text style={[s.h1, style]}>{children}</Text>;
export const H2 = ({ children, style }) => <Text style={[s.h2, style]}>{children}</Text>;
export const Muted = ({ children, style }) => <Text style={[s.muted, style]}>{children}</Text>;
export const T = ({ children, style }) => <Text style={[{ color: colors.text, fontSize: 15 }, style]}>{children}</Text>;
export const Mono = ({ children, style, ...p }) => <Text {...p} style={[{ color: colors.text, fontFamily: 'Courier', fontSize: 13 }, style]}>{children}</Text>;

export function Input({ label, ...props }) {
  return (
    <View style={{ marginTop: 12 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} {...props} style={[s.input, props.multiline && { minHeight: 80, textAlignVertical: 'top' }]} />
    </View>
  );
}

const badgeColors = {
  active: ['#12341f', colors.accent], running: ['#12341f', colors.accent], provisioning: ['#10293a', colors.accent2],
  suspended: ['#3a2e10', colors.warn], stopped: ['#3a2e10', colors.warn], error: ['#3a1414', colors.danger], free: ['#2a1f3d', colors.free],
};
export function Badge({ label }) {
  const [bg, fg] = badgeColors[label] || [colors.panel2, colors.muted];
  return <View style={[s.badge, { backgroundColor: bg }]}><Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</Text></View>;
}

export function Meter({ value }) {
  return <View style={s.meter}><View style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, height: '100%', backgroundColor: colors.accent }} /></View>;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 14, padding: 16 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '800' },
  h2: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  muted: { color: colors.muted, fontSize: 14 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: '#0d1320', color: colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12 },
  btnText: { fontWeight: '700', fontSize: 15 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, alignSelf: 'flex-start' },
  meter: { height: 8, backgroundColor: colors.panel2, borderRadius: 99, overflow: 'hidden', marginTop: 4, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
});
