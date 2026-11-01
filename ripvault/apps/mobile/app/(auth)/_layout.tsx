import { Redirect, Stack } from 'expo-router';
import { colors } from '../../src/theme.ts';
import { useSession } from '../../src/state/session.tsx';

/** Auth screens (login/register). Signed-in players are sent to the Packs tab. */
export default function AuthLayout() {
  const { status } = useSession();
  if (status === 'signedIn') return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'fade',
      }}
    />
  );
}
