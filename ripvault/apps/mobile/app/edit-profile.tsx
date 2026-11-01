/**
 * Edit profile: display name (PATCH /me). Email is shown read-only.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { DISPLAY_NAME_MAX_LENGTH } from '@ripvault/shared';
import { toApiError, updateMe } from '../src/api/client.ts';
import { useSession } from '../src/state/session.tsx';
import { spacing } from '../src/theme.ts';
import { haptic } from '../src/lib/haptics.ts';
import { AppHeader, Button, LoadingState, Screen, TextField, useToast } from '../src/components/index.ts';
import { accountErrorCopy } from '../src/features/account/errors.ts';
import { useMountedRef } from '../src/features/account/hooks.ts';
import { Avatar } from '../src/features/account/ui.tsx';

export default function EditProfileScreen() {
  const { user, setUser } = useSession();
  const toast = useToast();
  const mounted = useMountedRef();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const header = <AppHeader title="Edit profile" back showBalance={false} />;
  if (!user) {
    return (
      <Screen header={header}>
        <LoadingState />
      </Screen>
    );
  }

  const value = name ?? user.displayName;
  const trimmed = value.trim();
  const unchanged = trimmed === user.displayName;
  const localError =
    trimmed.length === 0
      ? 'Enter a display name'
      : trimmed.length > DISPLAY_NAME_MAX_LENGTH
        ? `Keep it to ${DISPLAY_NAME_MAX_LENGTH} characters`
        : null;

  const save = async () => {
    if (saving) return;
    if (localError) {
      setError(localError);
      haptic.error();
      return;
    }
    if (unchanged) {
      router.back();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const me = await updateMe({ displayName: trimmed });
      setUser(me);
      toast.success('Profile updated');
      router.back();
    } catch (e) {
      if (!mounted.current) return;
      const copy = accountErrorCopy(toApiError(e), 'profile');
      haptic.error();
      if (copy.field) setError(copy.field.message);
      else toast.show({ type: 'error', title: copy.title, message: copy.message });
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <Screen
      scroll
      keyboardAvoiding
      header={header}
      footer={<Button title="Save" variant="holo" size="lg" block loading={saving} disabled={unchanged && !error} onPress={() => void save()} />}
    >
      <View style={styles.avatar}>
        <Avatar name={trimmed || user.displayName} size={88} />
      </View>
      <TextField
        label="Display name"
        value={value}
        onChangeText={(t) => {
          setName(t);
          setError(null);
        }}
        placeholder="What should we call you?"
        icon="person-outline"
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="nickname"
        textContentType="nickname"
        maxLength={DISPLAY_NAME_MAX_LENGTH + 8}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        error={error}
        hint={`Shown on your profile. ${trimmed.length}/${DISPLAY_NAME_MAX_LENGTH} characters.`}
      />
      <TextField
        label="Email"
        value={user.email}
        onChangeText={() => undefined}
        icon="mail-outline"
        editable={false}
        hint="Your sign-in email can't be changed in the app."
        style={styles.field}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', marginVertical: spacing.xl },
  field: { marginTop: spacing.lg },
});
