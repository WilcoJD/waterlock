import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, HIT_SIZE, radii, spacing } from '../../theme.ts';
import { AppText, IconButton, MoneyText, Panel, PressableScale } from '../../components/index.ts';
import { haptic } from '../../lib/haptics.ts';
import { clampQuantity, quantityPresets } from './packData.ts';

export interface QuantitySelectorProps {
  value: number;
  /** AppConfig.maxOpenQuantity. */
  max: number;
  onChange: (quantity: number) => void;
  /** Price of one pack, for the running total. */
  unitPricePence: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** How many packs to rip: a -/+ stepper with a big count, plus quick-pick chips (1x, 3x, 5x, 10x). */
export function QuantitySelector({ value, max, onChange, unitPricePence, disabled = false, style }: QuantitySelectorProps) {
  const presets = useMemo(() => quantityPresets(max), [max]);
  const bump = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    bump.setValue(1.18);
    Animated.spring(bump, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 12 }).start();
  }, [value, bump]);

  const set = (next: number) => {
    const clamped = clampQuantity(next, max);
    if (clamped === value || disabled) return;
    haptic.selection();
    onChange(clamped);
  };

  const unit = value === 1 ? 'pack' : 'packs';

  return (
    <Panel style={[styles.panel, style]}>
      <View style={styles.header}>
        <AppText variant="label">How many</AppText>
        <View style={styles.total}>
          <AppText variant="caption" tone="muted" style={styles.totalLabel}>
            Total
          </AppText>
          <MoneyText pence={unitPricePence * value} size={16} tone="gold" />
        </View>
      </View>

      <View style={styles.stepper}>
        <IconButton
          icon="remove"
          accessibilityLabel="One pack fewer"
          onPress={() => set(value - 1)}
          disabled={disabled || value <= 1}
        />
        <View
          style={styles.count}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Number of packs"
          accessibilityValue={{ min: 1, max, now: value, text: `${value} ${unit}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e: { nativeEvent: { actionName: string } }) => {
            if (e.nativeEvent.actionName === 'increment') set(value + 1);
            else if (e.nativeEvent.actionName === 'decrement') set(value - 1);
          }}
        >
          <Animated.View style={[styles.countRow, { transform: [{ scale: bump }] }]}>
            <AppText variant="display" size={38} style={styles.countNumber}>
              {value}
            </AppText>
            <AppText variant="heading" tone="gold" size={22} style={styles.times}>
              ×
            </AppText>
          </Animated.View>
          <AppText variant="caption" tone="muted">
            {unit}
          </AppText>
        </View>
        <IconButton
          icon="add"
          accessibilityLabel="One pack more"
          onPress={() => set(value + 1)}
          disabled={disabled || value >= max}
        />
      </View>

      {presets.length > 1 ? (
        <View style={styles.chips}>
          {presets.map((n) => {
            const selected = n === value;
            return (
              <PressableScale
                key={n}
                onPress={() => set(n)}
                disabled={disabled}
                scaleTo={0.94}
                accessibilityLabel={`${n} ${n === 1 ? 'pack' : 'packs'}`}
                accessibilityState={{ selected }}
                style={[styles.chip, selected ? styles.chipSelected : null]}
              >
                <AppText variant="body" weight="800" size={15} color={selected ? colors.gold : colors.textMuted}>
                  {n}×
                </AppText>
              </PressableScale>
            );
          })}
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { flexDirection: 'row', alignItems: 'baseline' },
  totalLabel: { marginRight: spacing.xs },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  count: { flex: 1, alignItems: 'center' },
  countRow: { flexDirection: 'row', alignItems: 'baseline' },
  countNumber: { fontVariant: ['tabular-nums'] },
  times: { marginLeft: 2 },
  chips: { flexDirection: 'row', marginTop: spacing.md, marginHorizontal: -spacing.xs },
  chip: {
    flex: 1,
    minHeight: HIT_SIZE,
    marginHorizontal: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
});
