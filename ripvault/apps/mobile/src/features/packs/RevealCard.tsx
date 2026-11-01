import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { CardSummary } from '@ripvault/shared';
import { CARD_ASPECT, tierColors, tierLabels, tierRank, withAlpha } from '../../theme.ts';
import { CardArt, PressableScale } from '../../components/index.ts';
import { CardBack } from './CardBack.tsx';

export interface RevealCardProps {
  card: CardSummary;
  /** Card width in points. */
  width: number;
  /** Flip from the back to the face when this becomes true. */
  revealed: boolean;
  /** Tap: reveal, or move on once revealed (decided by the parent). */
  onPress?: () => void;
  /** Called once the flip has finished (fire haptics / show the value here). */
  onFlipped?: () => void;
  /** Screen reader hint for the current tap action. */
  accessibilityHint?: string;
}

const FLIP_MS = 640;

/**
 * A card that rises in face-down, then flips (rotateY) to its face with a tier-coloured bloom.
 * Epic and legendary pulls keep a slow pulsing glow. Both faces use backfaceVisibility hidden plus
 * an opacity switch at 90 degrees (Android does not always honour backfaceVisibility).
 */
export function RevealCard({ card, width, revealed, onPress, onFlipped, accessibilityHint }: RevealCardProps) {
  const height = Math.round(width * CARD_ASPECT);
  const tierColor = tierColors[card.tier];
  const strong = tierRank[card.tier] >= tierRank.epic;

  const enter = useRef(new Animated.Value(0)).current;
  const flip = useRef(new Animated.Value(revealed ? 1 : 0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const onFlippedRef = useRef(onFlipped);
  onFlippedRef.current = onFlipped;

  // Rise in from the deck.
  useEffect(() => {
    const anim = Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 11, bounciness: 7 });
    anim.start();
    return () => anim.stop();
  }, [enter]);

  // Flip once `revealed` turns true.
  useEffect(() => {
    if (!revealed) return undefined;
    let pulseLoop: { stop: () => void } | null = null;
    const flipAnim = Animated.timing(flip, { toValue: 1, duration: FLIP_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: true });
    const popAnim = Animated.sequence([
      Animated.timing(pop, { toValue: 1.07, duration: FLIP_MS / 2, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 9, bounciness: 13 }),
    ]);
    flipAnim.start(({ finished }: { finished: boolean }) => {
      if (!finished) return;
      onFlippedRef.current?.();
      if (strong) {
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        );
        pulseLoop = loop;
        loop.start();
      }
    });
    popAnim.start();
    return () => {
      flipAnim.stop();
      popAnim.stop();
      pulseLoop?.stop();
    };
  }, [revealed, flip, pop, pulse, strong]);

  const backRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const frontRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['-180deg', '0deg'] });
  const backOpacity = flip.interpolate({ inputRange: [0, 0.5, 0.501, 1], outputRange: [1, 1, 0, 0] });
  const frontOpacity = flip.interpolate({ inputRange: [0, 0.5, 0.501, 1], outputRange: [0, 0, 1, 1] });
  const bloomOpacity = Animated.multiply(
    flip.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] }),
    pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
  );
  const bloomScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const enterY = enter.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });
  const enterOpacity = enter.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });

  const label = revealed ? `${card.name}, ${tierLabels[card.tier]}` : 'Face-down card. Reveal it';

  return (
    <PressableScale onPress={onPress} scaleTo={0.98} accessibilityLabel={label} accessibilityHint={accessibilityHint}>
      <Animated.View
        style={{
          width,
          height,
          opacity: enterOpacity,
          transform: [{ translateY: enterY }, { scale: Animated.multiply(enterScale, pop) }],
        }}
      >
        {/* Tier bloom: layered translucent halos (consistent on iOS and Android, unlike coloured shadows). */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: bloomOpacity, transform: [{ scale: bloomScale }] }]}
        >
          {[1.34, 1.2, 1.08].map((s, i) => (
            <View
              key={s}
              style={[
                styles.halo,
                {
                  width: width * s,
                  height: height * (1 + (s - 1) * 0.75),
                  left: (width - width * s) / 2,
                  top: (height - height * (1 + (s - 1) * 0.75)) / 2,
                  borderRadius: width * 0.12 * s,
                  backgroundColor: withAlpha(tierColor, [0.1, 0.18, 0.32][i] ?? 0.2),
                },
              ]}
            />
          ))}
        </Animated.View>

        <Animated.View style={[styles.face, { opacity: backOpacity, transform: [{ perspective: 1200 }, { rotateY: backRotate }] }]}>
          <CardBack width={width} />
        </Animated.View>
        <Animated.View style={[styles.face, { opacity: frontOpacity, transform: [{ perspective: 1200 }, { rotateY: frontRotate }] }]}>
          <CardArt card={card} width={width} highRes glow={false} />
        </Animated.View>
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    backfaceVisibility: 'hidden',
  },
  halo: { position: 'absolute' },
});
