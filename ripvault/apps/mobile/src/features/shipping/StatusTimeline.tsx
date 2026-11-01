import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Shipment, ShipmentStatus } from '@ripvault/shared';
import { colors, spacing, withAlpha } from '../../theme.ts';
import { AppText } from '../../components/index.ts';
import type { IconName } from '../../components/index.ts';
import { formatDateTime } from '../../lib/format.ts';
import { SHIPMENT_FLOW, SHIPMENT_STATUS_META } from './status.ts';

const DOT = 28;

/**
 * Vertical progress: Requested -> Processing -> Shipped -> Delivered, or Requested -> Cancelled.
 * Completed steps are filled, the current step pulses, future steps are hollow.
 */
export function StatusTimeline({ shipment }: { shipment: Shipment }) {
  const steps: readonly ShipmentStatus[] = shipment.status === 'cancelled' ? ['requested', 'cancelled'] : SHIPMENT_FLOW;
  const current = Math.max(0, steps.indexOf(shipment.status));

  return (
    <View accessibilityRole="list" accessibilityLabel="Shipment progress">
      {steps.map((step, index) => {
        const meta = SHIPMENT_STATUS_META[step];
        const done = index < current;
        const active = index === current;
        const reached = done || active;
        const color = reached ? meta.color : colors.textFaint;
        const last = index === steps.length - 1;
        const when =
          index === 0 ? formatDateTime(shipment.createdAt) : active ? formatDateTime(shipment.updatedAt) : null;
        const state = done ? 'done' : active ? 'current step' : 'not yet';
        return (
          <View
            key={step}
            style={styles.step}
            accessible
            accessibilityLabel={`${meta.label}, ${state}${when ? `, ${when}` : ''}`}
          >
            <View style={styles.rail}>
              <StepDot color={color} icon={meta.icon} filled={reached} pulsing={active && !last} />
              {!last ? <View style={[styles.line, { backgroundColor: done ? withAlpha(meta.color, 0.7) : colors.border }]} /> : null}
            </View>
            <View style={[styles.body, last ? null : styles.bodySpacing]}>
              <AppText variant="body" weight={active ? '800' : '600'} color={reached ? colors.text : colors.textFaint}>
                {meta.label}
              </AppText>
              {when ? (
                <AppText variant="caption" tone="faint">
                  {when}
                </AppText>
              ) : null}
              {active ? (
                <AppText variant="caption" tone="muted" style={styles.description}>
                  {meta.description}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function StepDot({ color, icon, filled, pulsing }: { color: string; icon: IconName; filled: boolean; pulsing: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!pulsing) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulsing, pulse]);

  return (
    <View style={styles.dotWrap}>
      {pulsing ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              borderColor: color,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
            },
          ]}
        />
      ) : null}
      <View
        style={[
          styles.dot,
          filled ? { backgroundColor: withAlpha(color, 0.18), borderColor: color } : { borderColor: colors.border },
        ]}
      >
        <Ionicons name={icon} size={14} color={color} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row' },
  rail: { width: DOT, alignItems: 'center', marginRight: spacing.md },
  line: { flex: 1, width: 2, minHeight: 18, marginVertical: 4, borderRadius: 1 },
  body: { flex: 1, minWidth: 0, paddingTop: 3 },
  bodySpacing: { paddingBottom: spacing.lg },
  description: { marginTop: spacing.xs },
  dotWrap: { width: DOT, height: DOT, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
