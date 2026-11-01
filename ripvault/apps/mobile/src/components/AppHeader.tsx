import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, gradients, spacing } from '../theme.ts';
import { AppText } from './AppText.tsx';
import { BalancePill } from './BalancePill.tsx';
import { IconButton } from './IconButton.tsx';

export interface WordmarkProps {
  /** "sm" for headers (default), "lg" for the sign-in hero. */
  size?: 'sm' | 'lg';
}

/** RIPVAULT logo: holo tile with a diamond glyph + two-tone wordmark. Built from text, no assets. */
export function Wordmark({ size = 'sm' }: WordmarkProps) {
  const lg = size === 'lg';
  const tile = lg ? 56 : 30;
  return (
    <View style={[styles.wordmark, lg ? styles.wordmarkLg : null]} accessible accessibilityRole="header" accessibilityLabel="RipVault">
      <View style={[styles.tile, { width: tile, height: tile, borderRadius: lg ? 18 : 10 }]}>
        <LinearGradient
          colors={gradients.holo}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: lg ? 18 : 10 }]}
        />
        <Ionicons name="diamond" size={lg ? 28 : 16} color={colors.textOnLight} />
      </View>
      <View style={[styles.letters, lg ? styles.lettersLg : null]}>
        <AppText variant="heading" size={lg ? 32 : 17} weight="900" style={[styles.letterSpacing, lg ? styles.letterSpacingLg : null]}>
          RIP
        </AppText>
        <AppText
          variant="heading"
          size={lg ? 32 : 17}
          weight="900"
          color={colors.gold}
          style={[styles.letterSpacing, lg ? styles.letterSpacingLg : null]}
        >
          VAULT
        </AppText>
      </View>
    </View>
  );
}

export interface AppHeaderProps {
  /** Title text. Without it (and without `back`) the RIPVAULT wordmark is shown. */
  title?: string;
  subtitle?: string;
  /** Show a back chevron ('back' or true) or a close X ('close') on the left. */
  back?: boolean | 'close';
  /** Custom back action. Default: router.back(), or go home when there is no history. */
  onBack?: () => void;
  /** Show the BalancePill on the right (default true). */
  showBalance?: boolean;
  /** Custom right content (replaces the balance pill). */
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Default back behaviour: pop, or go to the Packs tab if this screen was opened directly. */
export function goBackOrHome(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Top bar used by every screen (place it in <Screen header={...}>).
 *   Tab roots:   <AppHeader />                       wordmark + balance
 *   Sub-screens: <AppHeader title="Shipments" back />
 *   Modals:      <AppHeader title="Top up" back="close" showBalance={false} />
 */
export function AppHeader({ title, subtitle, back = false, onBack, showBalance = true, right, style }: AppHeaderProps) {
  const handleBack = onBack ?? goBackOrHome;
  return (
    <View style={[styles.bar, style]}>
      <View style={styles.left}>
        {back ? (
          <IconButton
            icon={back === 'close' ? 'close' : 'chevron-back'}
            accessibilityLabel={back === 'close' ? 'Close' : 'Back'}
            onPress={handleBack}
            style={styles.backButton}
          />
        ) : null}
        {title ? (
          <View style={styles.titleWrap}>
            <AppText variant="heading" numberOfLines={1} accessibilityRole="header">
              {title}
            </AppText>
            {subtitle ? (
              <AppText variant="caption" numberOfLines={1}>
                {subtitle}
              </AppText>
            ) : null}
          </View>
        ) : !back ? (
          <Wordmark />
        ) : null}
      </View>
      <View style={styles.right}>{right ?? (showBalance ? <BalancePill /> : null)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  right: { marginLeft: spacing.md, flexDirection: 'row', alignItems: 'center' },
  backButton: { marginRight: spacing.md },
  titleWrap: { flex: 1, minWidth: 0 },
  wordmark: { flexDirection: 'row', alignItems: 'center' },
  wordmarkLg: { flexDirection: 'column' },
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  letters: { flexDirection: 'row', marginLeft: 10 },
  lettersLg: { marginLeft: 0, marginTop: spacing.lg },
  letterSpacing: { letterSpacing: 2.2 },
  letterSpacingLg: { letterSpacing: 5 },
});
