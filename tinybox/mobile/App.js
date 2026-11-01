import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, loadToken, setToken, setUnauthorizedHandler } from './src/api';
import { initAds } from './src/ads';
import { colors } from './src/config';
import { Session } from './src/session';
import AuthScreen from './src/screens/AuthScreen';
import ServersScreen from './src/screens/ServersScreen';
import ServerScreen from './src/screens/ServerScreen';
import ShopScreen from './src/screens/ShopScreen';
import AccountScreen from './src/screens/AccountScreen';


const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.panel, border: colors.line, primary: colors.accent, text: colors.text },
};
const header = { headerStyle: { backgroundColor: colors.panel }, headerTintColor: colors.text, headerShadowVisible: false };
const icon = (glyph) => ({ color }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

function ServersStack() {
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="ServerList" component={ServersScreen} options={{ title: 'My servers' }} />
      <Stack.Screen name="Server" component={ServerScreen} options={({ route }) => ({ title: route.params?.hostname || 'Server' })} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={{ ...header, tabBarActiveTintColor: colors.accent, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.panel, borderTopColor: colors.line } }}>
      <Tabs.Screen name="Servers" component={ServersStack} options={{ headerShown: false, tabBarIcon: icon('▣') }} />
      <Tabs.Screen name="Shop" component={ShopScreen} options={{ tabBarIcon: icon('🛒') }} />
      <Tabs.Screen name="Account" component={AccountScreen} options={{ tabBarIcon: icon('👤') }} />
    </Tabs.Navigator>
  );
}

const linking = { prefixes: ['tinybox://'], config: { screens: { Shop: 'order' } } };

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out

  const signOut = useCallback(async () => { await setToken(null); setUser(null); }, []);
  const signIn = useCallback(async (token, u) => { await setToken(token); setUser(u); }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    initAds();
    (async () => {
      if (!(await loadToken())) return setUser(null);
      try { setUser((await api('GET', '/auth/me')).user); } catch { setUser(null); }
    })();
  }, [signOut]);

  const session = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);

  if (user === undefined) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>;
  }
  return (
    <SafeAreaProvider>
      <Session.Provider value={session}>
        <NavigationContainer theme={theme} linking={linking}>
          <StatusBar style="light" />
          {user ? <MainTabs /> : <AuthScreen />}
        </NavigationContainer>
      </Session.Provider>
    </SafeAreaProvider>
  );
}
