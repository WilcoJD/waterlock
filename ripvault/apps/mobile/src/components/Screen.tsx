import { createContext, useContext } from 'react';
import type { ElementRef, ReactNode, Ref } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, spacing } from '../theme.ts';

/**
 * True inside the (tabs) navigator. The tab bar already sits above the home indicator, so tab
 * screens must not add the bottom safe-area inset again. Provided by app/(tabs)/_layout.tsx.
 */
export const InTabsContext = createContext(false);

/** Themed pull-to-refresh for ScrollView/FlatList: refreshControl={themedRefreshControl(q.refreshing, q.refresh)}. */
export function themedRefreshControl(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.gold}
      colors={[colors.gold]}
      progressBackgroundColor={colors.surfaceRaised}
    />
  );
}

/** Bottom padding a scrolling list needs inside a Screen (home indicator outside tabs + breathing room). */
export function useScreenBottomPadding(): number {
  const inTabs = useContext(InTabsContext);
  const insets = useSafeAreaInsets();
  return (inTabs ? 0 : insets.bottom) + spacing.xl;
}

export interface ScreenProps {
  children?: ReactNode;
  /** Fixed above the content, e.g. <AppHeader />. Sits below the status bar. */
  header?: ReactNode;
  /** Fixed below the content, e.g. a CTA button. Gets the bottom safe-area inset. */
  footer?: ReactNode;
  /** Wrap children in a ScrollView. Leave false when the screen renders its own FlatList. */
  scroll?: boolean;
  /** Pull-to-refresh (scroll mode). */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Horizontal gutter around children (default true). */
  padded?: boolean;
  /** Keep inputs above the keyboard (forms). */
  keyboardAvoiding?: boolean;
  /** Set on screens presented as iOS sheet modals (topup, pack/[id]): skips the status-bar inset there. */
  modal?: boolean;
  /** Extra style for the content container (ScrollView contentContainerStyle in scroll mode). */
  contentStyle?: StyleProp<ViewStyle>;
  scrollRef?: Ref<ElementRef<typeof ScrollView>>;
  testID?: string;
}

/**
 * Screen shell: gradient background with a soft violet glow, safe areas, optional header/footer,
 * optional scroll + pull-to-refresh, optional keyboard avoidance.
 *
 *   <Screen header={<AppHeader />} scroll refreshing={q.refreshing} onRefresh={q.refresh}>...</Screen>
 *   <Screen header={<AppHeader title="Vault" />}><FlatList ... /></Screen>
 */
export function Screen({
  children,
  header,
  footer,
  scroll = false,
  refreshing = false,
  onRefresh,
  padded = true,
  keyboardAvoiding = false,
  modal = false,
  contentStyle,
  scrollRef,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const inTabs = useContext(InTabsContext);
  const topInset = modal && Platform.OS === 'ios' ? spacing.sm : insets.top;
  const bottomInset = inTabs ? 0 : insets.bottom;
  const gutter = padded ? spacing.gutter : 0;

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={[
        { paddingHorizontal: gutter, paddingTop: spacing.sm, paddingBottom: footer ? spacing.lg : bottomInset + spacing.xl },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? themedRefreshControl(refreshing, onRefresh) : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, { paddingHorizontal: gutter }, contentStyle]}>{children}</View>
  );

  const inner = (
    <>
      {header}
      {body}
      {footer ? (
        <View style={[styles.footer, { paddingHorizontal: gutter, paddingBottom: bottomInset + spacing.md }]}>{footer}</View>
      ) : null}
    </>
  );

  return (
    <View style={styles.root} testID={testID}>
      <LinearGradient colors={gradients.background} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <LinearGradient
        colors={gradients.backgroundGlow}
        start={{ x: 0.8, y: 0 }}
        end={{ x: 0.3, y: 1 }}
        style={styles.glow}
        pointerEvents="none"
      />
      <View style={[styles.flex, { paddingTop: topInset }]}>
        {keyboardAvoiding ? (
          <KeyboardAvoidingView style={styles.flex} behavior="padding">
            {inner}
          </KeyboardAvoidingView>
        ) : (
          inner
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  footer: {
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: 'rgba(7, 6, 26, 0.92)',
  },
});
