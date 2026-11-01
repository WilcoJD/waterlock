import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

export interface FadeSwapProps {
  /** When this changes, the content fades and slides in again. */
  swapKey: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Re-plays a short fade/slide-in whenever `swapKey` changes (e.g. the focused pack's details). */
export function FadeSwap({ swapKey, children, style }: FadeSwapProps) {
  const anim = useRef(new Animated.Value(1)).current;
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return undefined;
    }
    anim.setValue(0);
    const timing = Animated.timing(anim, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    timing.start();
    return () => timing.stop();
  }, [swapKey, anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={[style, { opacity: anim, transform: [{ translateY }] }]}>{children}</Animated.View>;
}
