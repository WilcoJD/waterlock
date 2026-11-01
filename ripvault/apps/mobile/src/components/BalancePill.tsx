import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { formatPence } from '@ripvault/shared';
import { colors, gradients, HIT_SIZE, radii } from '../theme.ts';
import { useSession } from '../state/session.tsx';
import { AppText } from './AppText.tsx';
import { PressableScale } from './PressableScale.tsx';

/** Small gold "£" coin. */
export function Coin({ size = 22 }: { size?: number }) {
  return (
    <View style={[styles.coin, { width: size, height: size, borderRadius: size / 2 }]}>
      <LinearGradient colors={gradients.gold} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} />
      <AppText variant="money" size={Math.round(size * 0.58)} color={colors.textOnLight} style={styles.coinText}>
        £
      </AppText>
    </View>
  );
}

export interface BalancePillProps {
  /** Hide the "+" top-up affordance (e.g. on the top-up screen itself). */
  hideTopUp?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Wallet balance from the session with a gold coin and a "+" that opens /topup.
 * Pulses when the balance changes. Renders nothing when signed out.
 */
export function BalancePill({ hideTopUp = false, style }: BalancePillProps) {
  const { user } = useSession();
  const balance = user?.balancePence ?? null;
  const pulse = useRef(new Animated.Value(1)).current;
  const previous = useRef<number | null>(balance);

  useEffect(() => {
    if (balance !== null && previous.current !== null && balance !== previous.current) {
      pulse.setValue(1.12);
      Animated.spring(pulse, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 12 }).start();
    }
    previous.current = balance;
  }, [balance, pulse]);

  if (balance === null) return null;
  const text = formatPence(balance);
  const content = (
    <>
      <Coin />
      <Animated.View style={[styles.amount, { transform: [{ scale: pulse }] }]}>
        <AppText variant="money" size={15} numberOfLines={1}>
          {text}
        </AppText>
      </Animated.View>
    </>
  );

  if (hideTopUp) {
    return (
      <View style={[styles.pill, styles.pillStatic, style]} accessible accessibilityLabel={`Balance ${text}`}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      onPress={() => router.push('/topup')}
      haptic="tap"
      scaleTo={0.95}
      accessibilityLabel={`Balance ${text}. Top up`}
      style={[styles.pill, style]}
    >
      {content}
      <View style={styles.plus}>
        <Ionicons name="add" size={16} color="#FFFFFF" />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HIT_SIZE - 4,
    paddingLeft: 6,
    paddingRight: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillStatic: { paddingRight: 6 },
  coin: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coinText: { includeFontPadding: false, textAlignVertical: 'center', lineHeight: undefined },
  amount: { marginHorizontal: 8 },
  plus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
