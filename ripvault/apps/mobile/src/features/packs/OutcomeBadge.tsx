import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { PullOutcome, Tier } from '@ripvault/shared';
import { colors, glow, gradients, radii } from '../../theme.ts';
import { AppText, Pill, TierBadge } from '../../components/index.ts';

export interface OutcomeBadgeProps {
  outcome: PullOutcome;
  tier: Tier;
  /** Pop in with a spring when mounted (default true). */
  animated?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

/**
 * How a pull compares to the pack price: holo "BIG HIT!" (3x+), green "HIT!" (worth at least the
 * pack), otherwise just the rarity tier.
 */
export function OutcomeBadge({ outcome, tier, animated = true, size = 'md', style }: OutcomeBadgeProps) {
  const scale = useRef(new Animated.Value(animated ? 0.4 : 1)).current;
  useEffect(() => {
    if (!animated) return undefined;
    const anim = Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 });
    anim.start();
    return () => anim.stop();
  }, [animated, scale]);

  let content: ReactNode;
  if (outcome === 'big_win') {
    content = (
      <View style={[styles.holo, size === 'sm' ? styles.holoSm : null, glow(gradients.holo[1], 'soft')]}>
        <LinearGradient colors={gradients.holo} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.holoFill]} />
        <Ionicons name="sparkles" size={size === 'sm' ? 11 : 15} color={colors.textOnLight} />
        <AppText variant="label" size={size === 'sm' ? 10 : 14} weight="900" color={colors.textOnLight} style={styles.holoText}>
          Big hit!
        </AppText>
      </View>
    );
  } else if (outcome === 'win') {
    content = <Pill label="Hit!" color={colors.success} icon="flash" variant="solid" size={size} />;
  } else {
    content = <TierBadge tier={tier} size={size} />;
  }

  return <Animated.View style={[styles.wrap, { transform: [{ scale }] }, style]}>{content}</Animated.View>;
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center' },
  holo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  holoSm: { paddingHorizontal: 8, paddingVertical: 3 },
  holoFill: { borderRadius: radii.pill },
  holoText: { marginLeft: 6, letterSpacing: 2 },
});
