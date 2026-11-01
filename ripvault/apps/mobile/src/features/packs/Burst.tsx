import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, gradients } from '../../theme.ts';

const PALETTE: readonly string[] = [colors.gold, gradients.holo[1], colors.violet, gradients.holo[2], colors.text, gradients.holo[0]];

export interface BurstProps {
  /** Diameter of the burst in points (particles travel up to about half of it). */
  size: number;
  /** Number of particles (default 18). */
  count?: number;
  /** Ring colour (default gold). */
  color?: string;
}

/**
 * One-shot celebration: a shockwave ring and holo-coloured confetti diamonds flying outward.
 * Plays once on mount (remount with a new `key` to replay). Purely decorative, ignores touches.
 */
export function Burst({ size, count = 18, color = colors.gold }: BurstProps) {
  const progress = useRef(new Animated.Value(0)).current;

  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + (i % 2 === 0 ? 0.15 : -0.1);
        const distance = size * (i % 3 === 0 ? 0.52 : i % 3 === 1 ? 0.42 : 0.33);
        const dot = 6 + (i % 3) * 3;
        return {
          dot,
          color: PALETTE[i % PALETTE.length] ?? colors.gold,
          translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * distance] }),
          translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * distance + size * 0.06] }),
        };
      }),
    [count, size, progress],
  );

  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: 1, duration: 1150, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [progress]);

  const opacity = progress.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, 1, 0] });
  const scale = progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.3, 1.25, 0.7] });
  const ringScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1.5] });
  const ringOpacity = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] });
  const ring = size * 0.7;

  return (
    <View pointerEvents="none" style={[styles.wrap, { width: size, height: size }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          styles.ring,
          { width: ring, height: ring, borderRadius: ring / 2, borderColor: color, opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
      />
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.particle,
            {
              width: p.dot,
              height: p.dot,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateX: p.translateX }, { translateY: p.translateY }, { rotate: '45deg' }, { scale }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 3 },
  particle: { position: 'absolute', borderRadius: 2 },
});
