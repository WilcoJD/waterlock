/**
 * Main tabs (auth-gated): Packs, Vault, Wallet, Profile.
 * While the saved session is being checked: spinner (or an error + retry if offline).
 * Signed out: redirect to /login.
 */
import { StyleSheet, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../src/theme.ts';
import { useSession } from '../../src/state/session.tsx';
import { haptic } from '../../src/lib/haptics.ts';
import { Button, ErrorState, InTabsContext, LoadingState, Screen } from '../../src/components/index.ts';
import type { IconName } from '../../src/components/index.ts';

interface TabIconProps {
  color: string;
  size: number;
  focused: boolean;
}

function tabIcon(active: IconName, inactive: IconName) {
  return ({ color, size, focused }: TabIconProps) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color} />
  );
}

function TabBarBackground() {
  return (
    <LinearGradient
      colors={[colors.bgAlt, colors.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

export default function TabsLayout() {
  const { status, restoreError, retryRestore, signOut } = useSession();

  if (status === 'loading') {
    return (
      <Screen>
        {restoreError ? (
          <View style={styles.flex}>
            <ErrorState error={restoreError} onRetry={retryRestore} />
            <Button title="Sign out" variant="ghost" onPress={() => void signOut()} style={styles.signOut} />
          </View>
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  }
  if (status === 'signedOut') return <Redirect href="/login" />;

  return (
    <InTabsContext.Provider value={true}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.gold,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: styles.tabBar,
          tabBarBackground: () => <TabBarBackground />,
          tabBarLabelStyle: styles.tabLabel,
          tabBarHideOnKeyboard: true,
          sceneStyle: { backgroundColor: colors.bg },
        }}
        screenListeners={{ tabPress: () => haptic.selection() }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: 'Packs', tabBarAccessibilityLabel: 'Packs', tabBarIcon: tabIcon('layers', 'layers-outline') }}
        />
        <Tabs.Screen
          name="vault"
          options={{ title: 'Vault', tabBarAccessibilityLabel: 'Vault', tabBarIcon: tabIcon('cube', 'cube-outline') }}
        />
        <Tabs.Screen
          name="wallet"
          options={{ title: 'Wallet', tabBarAccessibilityLabel: 'Wallet', tabBarIcon: tabIcon('wallet', 'wallet-outline') }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarAccessibilityLabel: 'Profile',
            tabBarIcon: tabIcon('person-circle', 'person-circle-outline'),
          }}
        />
      </Tabs>
    </InTabsContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  signOut: { alignSelf: 'center', marginBottom: 32 },
  tabBar: {
    backgroundColor: colors.bg,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
