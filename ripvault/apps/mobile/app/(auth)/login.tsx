import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../../src/theme.ts';
import { useSession } from '../../src/state/session.tsx';
import { toApiError } from '../../src/api/client.ts';
import { haptic } from '../../src/lib/haptics.ts';
import { isEmail } from '../../src/lib/validation.ts';
import { AppText, Button, Panel, Pill, Screen, TextField, useToast } from '../../src/components/index.ts';
import type { TextFieldHandle } from '../../src/components/index.ts';
import { AuthHero, SaferPlayFooter } from '../../src/components/AuthChrome.tsx';

const DEMO_EMAIL = 'demo@ripvault.dev';
const DEMO_PASSWORD = 'ripvault-demo';

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function LoginScreen() {
  const { signIn } = useSession();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextFieldHandle>(null);

  const submit = async () => {
    if (submitting) return;
    const next: FieldErrors = {};
    if (!isEmail(email)) next.email = 'Enter a valid email address';
    if (password.length === 0) next.password = 'Enter your password';
    setErrors(next);
    setFormError(null);
    if (next.email || next.password) {
      haptic.error();
      return;
    }
    setSubmitting(true);
    try {
      const user = await signIn(email, password);
      toast.success(`Welcome back, ${user.displayName}`);
      // (auth)/_layout redirects to the Packs tab once signed in.
    } catch (e) {
      const err = toApiError(e);
      const fieldErrors: FieldErrors = { email: err.fields.email, password: err.fields.password };
      setErrors(fieldErrors);
      setFormError(fieldErrors.email || fieldErrors.password ? null : err.message);
      haptic.error();
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll keyboardAvoiding contentStyle={styles.content}>
      <AuthHero tagline="Rip packs of real cards. Keep them in your vault, ship them home, or sell back instantly." />

      <Panel style={styles.form}>
        <AppText variant="title" size={24} style={styles.heading}>
          Sign in
        </AppText>
        <TextField
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
          }}
          placeholder="you@example.com"
          icon="mail-outline"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          error={errors.email}
          style={styles.field}
        />
        <TextField
          inputRef={passwordRef}
          label="Password"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
          }}
          placeholder="Your password"
          icon="lock-closed-outline"
          secure
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          error={errors.password}
          style={styles.field}
        />

        {formError ? (
          <View style={styles.formError} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <AppText variant="caption" tone="danger" style={styles.formErrorText}>
              {formError}
            </AppText>
          </View>
        ) : null}

        <Button title="Sign in" variant="holo" size="lg" block loading={submitting} onPress={() => void submit()} />
      </Panel>

      <View style={styles.switchRow}>
        <AppText variant="body" tone="muted">
          New to RipVault?{' '}
        </AppText>
        <Button title="Create an account" variant="ghost" size="sm" onPress={() => router.replace('/register')} />
      </View>

      {__DEV__ ? (
        <Panel raised style={styles.demo}>
          <View style={styles.demoHeader}>
            <Pill label="Dev only" color={colors.gold} icon="construct-outline" />
          </View>
          <AppText variant="caption" tone="muted">
            Demo account (seeded by the API in development):
          </AppText>
          <AppText variant="body" weight="700" selectable style={styles.demoCreds}>
            {DEMO_EMAIL} / {DEMO_PASSWORD}
          </AppText>
          <Button
            title="Fill demo login"
            variant="secondary"
            size="sm"
            icon="flash-outline"
            onPress={() => {
              setEmail(DEMO_EMAIL);
              setPassword(DEMO_PASSWORD);
              setErrors({});
              setFormError(null);
            }}
          />
        </Panel>
      ) : null}

      <SaferPlayFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingTop: spacing.xl },
  form: { padding: spacing.xl },
  heading: { marginBottom: spacing.lg },
  field: { marginBottom: spacing.lg },
  formError: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  formErrorText: { flex: 1, marginLeft: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
  },
  demo: { marginTop: spacing.lg },
  demoHeader: { flexDirection: 'row', marginBottom: spacing.sm },
  demoCreds: { marginTop: spacing.xs, marginBottom: spacing.md },
});
