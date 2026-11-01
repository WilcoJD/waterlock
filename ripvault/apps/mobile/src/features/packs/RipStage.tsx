/**
 * The pack being ripped:
 *   - "charging" (waiting for the server): the pack trembles, glows and light leaks from its seam.
 *   - "tearing" (result arrived): the seam flares, the top strip flies off and the pack drops away.
 * Calls onTorn() when the tear animation has finished.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { PackTheme } from '@ripvault/shared';
import { gradients, withAlpha } from '../../theme.ts';
import { haptic } from '../../lib/haptics.ts';
import { PackBody, packBodyHeight } from './PackArt.tsx';
import { safePackTheme } from './packData.ts';

export interface RipStageProps {
  name: string;
  theme: PackTheme;
  pricePence?: number;
  /** Pack width in points. */
  width: number;
  mode: 'charging' | 'tearing' | 'idle';
  onTorn?: () => void;
}

/** Fraction of the pack height where it tears. */
const TEAR_AT = 0.17;

export function RipStage({ name, theme: rawTheme, pricePence, width, mode, onTorn }: RipStageProps) {
  const theme = safePackTheme(rawTheme);
  const height = packBodyHeight(width);
  const tearY = Math.round(height * TEAR_AT);

  const shake = useRef(new Animated.Value(0)).current;
  const charge = useRef(new Animated.Value(0)).current;
  const tear = useRef(new Animated.Value(0)).current;
  const onTornRef = useRef(onTorn);
  onTornRef.current = onTorn;

  // Charging: tremble + breathing glow.
  useEffect(() => {
    if (mode !== 'charging') return undefined;
    tear.setValue(0);
    const tremble = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 55, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 110, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0.6, duration: 90, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 70, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(260),
      ]),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(charge, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(charge, { toValue: 0.25, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    tremble.start();
    breathe.start();
    return () => {
      tremble.stop();
      breathe.stop();
    };
  }, [mode, shake, charge, tear]);

  // Tearing: flare, rip, drop.
  useEffect(() => {
    if (mode !== 'tearing') return undefined;
    shake.setValue(0);
    haptic.heavy();
    const anim = Animated.parallel([
      Animated.timing(charge, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.timing(tear, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    anim.start(({ finished }: { finished: boolean }) => {
      if (finished) onTornRef.current?.();
    });
    return () => anim.stop();
  }, [mode, shake, charge, tear]);

  const rotate = shake.interpolate({ inputRange: [-1, 1], outputRange: ['-2.5deg', '2.5deg'] });
  const shiftX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-3, 3] });
  const glowScale = charge.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
  const glowOpacity = Animated.multiply(
    charge.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }),
    tear.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1, 0] }),
  );
  const seamOpacity = Animated.multiply(
    charge.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
    tear.interpolate({ inputRange: [0, 0.3, 0.6], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
  );
  const seamScaleY = tear.interpolate({ inputRange: [0, 0.15, 0.4], outputRange: [1, 3.2, 1], extrapolate: 'clamp' });

  // Top strip: lifts and spins off to the upper right.
  const topY = tear.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, -8, -height * 0.9], extrapolate: 'clamp' });
  const topX = tear.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 4, width * 0.75], extrapolate: 'clamp' });
  const topRotate = tear.interpolate({ inputRange: [0, 0.15, 1], outputRange: ['0deg', '-4deg', '38deg'], extrapolate: 'clamp' });
  const topOpacity = tear.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
  // Body: a beat later, sinks and fades so the first card can rise.
  const bodyY = tear.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0, height * 0.85], extrapolate: 'clamp' });
  const bodyOpacity = tear.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 1, 0] });
  const bodyScale = tear.interpolate({ inputRange: [0, 0.3, 1], outputRange: [1, 1.02, 0.9], extrapolate: 'clamp' });

  return (
    <View style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Glow behind the pack (layered halos). */}
      <Animated.View pointerEvents="none" style={[styles.glowWrap, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}>
        {[1.45, 1.28, 1.12].map((s, i) => (
          <View
            key={s}
            style={[
              styles.halo,
              {
                width: width * s,
                height: height * (1 + (s - 1) * 0.6),
                left: (width - width * s) / 2,
                top: (height - height * (1 + (s - 1) * 0.6)) / 2,
                borderRadius: width * 0.18 * s,
                backgroundColor: withAlpha(theme.accent, [0.08, 0.14, 0.22][i] ?? 0.12),
              },
            ]}
          />
        ))}
      </Animated.View>

      <Animated.View style={{ width, height, transform: [{ translateX: shiftX }, { rotate }] }}>
        {/* Body (below the tear line). */}
        <Animated.View
          style={[
            styles.piece,
            { top: tearY, width, height: height - tearY, opacity: bodyOpacity, transform: [{ translateY: bodyY }, { scale: bodyScale }] },
          ]}
        >
          <View style={{ position: 'absolute', top: -tearY, left: 0 }}>
            <PackBody name={name} theme={theme} width={width} pricePence={pricePence} />
          </View>
        </Animated.View>
        {/* Top strip (above the tear line). */}
        <Animated.View
          style={[
            styles.piece,
            { top: 0, width, height: tearY, opacity: topOpacity, transform: [{ translateX: topX }, { translateY: topY }, { rotate: topRotate }] },
          ]}
        >
          <PackBody name={name} theme={theme} width={width} pricePence={pricePence} shimmer={false} />
        </Animated.View>
        {/* Light leaking from the seam. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.seam, { top: tearY - 2, width, opacity: seamOpacity, transform: [{ scaleY: seamScaleY }] }]}
        >
          <LinearGradient colors={gradients.holo} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  glowWrap: { ...StyleSheet.absoluteFillObject },
  halo: { position: 'absolute' },
  piece: { position: 'absolute', left: 0, overflow: 'hidden' },
  seam: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
});
