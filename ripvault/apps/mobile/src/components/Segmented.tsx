import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, HIT_SIZE, radii } from '../theme.ts';
import { haptic } from '../lib/haptics.ts';
import { AppText } from './AppText.tsx';
import type { IconName } from './icons.ts';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** Small count shown after the label, e.g. number of items. */
  count?: number;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  /** Screen-reader name for the whole control, e.g. "Vault filter". */
  accessibilityLabel?: string;
}

/**
 * Equal-width segmented control with a sliding highlight.
 *   <Segmented options={[{ value: 'vaulted', label: 'Vault' }, { value: 'sold', label: 'Sold' }]}
 *              value={status} onChange={setStatus} />
 */
export function Segmented<T extends string>({ options, value, onChange, style, accessibilityLabel }: SegmentedProps<T>) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segmentWidth = options.length > 0 ? width / options.length : 0;
  const position = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    Animated.spring(position, { toValue: index, useNativeDriver: true, speed: 22, bounciness: 4 }).start();
  }, [index, position]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - INSET * 2);

  return (
    <View style={[styles.track, style]} onLayout={onLayout} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              width: segmentWidth,
              transform: [
                {
                  translateX: position.interpolate({
                    inputRange: [0, Math.max(1, options.length - 1)],
                    outputRange: [0, segmentWidth * Math.max(1, options.length - 1)],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const active = option.value === value;
        const fg = active ? colors.text : colors.textMuted;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (!active) {
                haptic.selection();
                onChange(option.value);
              }
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.count !== undefined ? `${option.label}, ${option.count}` : option.label}
            style={styles.segment}
          >
            {option.icon ? <Ionicons name={option.icon} size={15} color={fg} style={styles.icon} /> : null}
            <AppText variant="caption" weight="700" color={fg} numberOfLines={1}>
              {option.label}
            </AppText>
            {option.count !== undefined ? (
              <View style={[styles.count, active ? styles.countActive : null]}>
                <AppText variant="caption" size={11} weight="800" color={active ? colors.textOnLight : colors.textMuted}>
                  {option.count}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const INSET = 4;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: INSET,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: {
    position: 'absolute',
    top: INSET,
    bottom: INSET,
    left: INSET,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  segment: {
    flex: 1,
    minHeight: HIT_SIZE - INSET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  icon: { marginRight: 6 },
  count: {
    marginLeft: 6,
    minWidth: 20,
    paddingHorizontal: 5,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
  },
  countActive: { backgroundColor: colors.gold },
});
