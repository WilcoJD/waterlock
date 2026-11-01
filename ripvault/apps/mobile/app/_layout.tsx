/**
 * Root layout: providers + the root Stack.
 * Presentation: "topup" and "pack/[id]" are modals (iOS sheet), "open/[id]" is a full-screen modal
 * with swipe-to-dismiss disabled (the rip animation must not be dismissed halfway). Everything else
 * is a normal card push.
 */
import { useEffect } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../src/theme.ts';
import { ToastProvider } from '../src/components/Toast.tsx';
import { AppConfigProvider } from '../src/state/config.tsx';
import { SessionProvider, useSession } from '../src/state/session.tsx';

/**
 * Sends signed-out players to /login from screens outside the (tabs) group (e.g. a deep link to
 * /pack/x, or a 401 while a modal is open). (tabs)/_layout.tsx handles its own redirect.
 */
function AuthGuard() {
  const { status } = useSession();
  const segments = useSegments();
  const group = segments[0];
  useEffect(() => {
    if (status === 'signedOut' && group !== '(auth)' && group !== '(tabs)') {
      router.replace('/login');
    }
  }, [status, group]);
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: colors.bg }}>
      <ToastProvider>
        <AppConfigProvider>
          <SessionProvider>
            <StatusBar style="light" />
            <AuthGuard />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'default',
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
              <Stack.Screen name="topup" options={{ presentation: 'modal' }} />
              <Stack.Screen name="pack/[id]" options={{ presentation: 'modal' }} />
              <Stack.Screen
                name="open/[id]"
                options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }}
              />
            </Stack>
          </SessionProvider>
        </AppConfigProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
