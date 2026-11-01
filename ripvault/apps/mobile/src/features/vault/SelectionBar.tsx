import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { formatPence } from '@ripvault/shared';
import { spacing } from '../../theme.ts';
import { AppText, Button, MoneyText } from '../../components/index.ts';
import { plural } from '../../lib/format.ts';

export interface SelectionBarProps {
  count: number;
  /** Sum of the selected cards' buyback offers. */
  buybackPence: number;
  /** Sum of the selected cards' market values. */
  valuePence: number;
  selling: boolean;
  onSell: () => void;
  onShip: () => void;
}

/** Sticky action bar shown while multi-selecting vaulted cards (render it as the Screen footer). */
export function SelectionBar({ count, buybackPence, valuePence, selling, onSell, onShip }: SelectionBarProps) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
  }, [enter]);

  const none = count === 0;
  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
      }}
    >
      <View style={styles.summary} accessibilityLiveRegion="polite">
        <AppText variant="label" tone={none ? 'muted' : 'gold'}>
          {none ? 'Tap cards to select' : `${plural(count, 'card')} selected`}
        </AppText>
        {none ? null : (
          <View style={styles.summaryValue}>
            <AppText variant="caption" tone="faint">
              Worth{' '}
            </AppText>
            <MoneyText pence={valuePence} size={13} tone="muted" />
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <Button
          title={none ? 'Ship' : `Ship ${count}`}
          icon="paper-plane-outline"
          variant="secondary"
          disabled={none || selling}
          onPress={onShip}
          accessibilityLabel={none ? 'Ship selected cards' : `Ship ${plural(count, 'card')}`}
          style={styles.ship}
        />
        <Button
          title={none ? 'Sell' : `Sell ${count} for ${formatPence(buybackPence)}`}
          icon="flash"
          variant="holo"
          disabled={none}
          loading={selling}
          onPress={onSell}
          haptic={false}
          accessibilityLabel={none ? 'Sell selected cards' : `Sell ${plural(count, 'card')} for ${formatPence(buybackPence)}`}
          style={styles.sell}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    minHeight: 18,
  },
  summaryValue: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'stretch' },
  ship: { flex: 1, marginRight: spacing.sm },
  sell: { flex: 1.8 },
});
