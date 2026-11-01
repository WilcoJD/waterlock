import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@ripvault/shared';
import { colors, radii, spacing } from '../../src/theme.ts';
import { useSession } from '../../src/state/session.tsx';
import { useAppConfig } from '../../src/state/config.tsx';
import { toApiError } from '../../src/api/client.ts';
import { haptic } from '../../src/lib/haptics.ts';
import { ageFromIsoDate } from '../../src/lib/format.ts';
import { buildIsoDate, digitsOnly, isEmail } from '../../src/lib/validation.ts';
import { AppText, Button, Checkbox, Panel, Screen, TextField, useToast } from '../../src/components/index.ts';
import type { TextFieldHandle } from '../../src/components/index.ts';
import { AuthHero, SaferPlayFooter } from '../../src/components/AuthChrome.tsx';

type Field = 'displayName' | 'email' | 'password' | 'dateOfBirth' | 'acceptTerms' | 'ageConfirmed';
type FieldErrors = Partial<Record<Field, string>>;

export default function RegisterScreen() {
  const { signUp } = useSession();
  const { config } = useAppConfig();
  const toast = useToast();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef<TextFieldHandle>(null);
  const passwordRef = useRef<TextFieldHandle>(null);
  const dayRef = useRef<TextFieldHandle>(null);
  const monthRef = useRef<TextFieldHandle>(null);
  const yearRef = useRef<TextFieldHandle>(null);

  const minimumAge = config.minimumAge;

  const clearError = (field: Field) => {
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const validate = (): { errors: FieldErrors; dateOfBirth: string | null } => {
    const next: FieldErrors = {};
    const name = displayName.trim();
    if (name.length === 0) next.displayName = 'Choose a display name';
    else if (name.length > DISPLAY_NAME_MAX_LENGTH) next.displayName = `At most ${DISPLAY_NAME_MAX_LENGTH} characters`;
    if (!isEmail(email)) next.email = 'Enter a valid email address';
    if (password.length < PASSWORD_MIN_LENGTH) next.password = `Use at least ${PASSWORD_MIN_LENGTH} characters`;
    const dateOfBirth = buildIsoDate(day, month, year);
    if (!dateOfBirth) {
      next.dateOfBirth = 'Enter a real date as DD / MM / YYYY';
    } else {
      const age = ageFromIsoDate(dateOfBirth);
      if (age === null || age < 0 || Number(year) < 1900) next.dateOfBirth = 'Enter a real date of birth';
      else if (age < minimumAge) next.dateOfBirth = `You must be ${minimumAge} or over to use RipVault`;
    }
    if (!acceptTerms) next.acceptTerms = 'Please accept the terms to continue';
    if (!ageConfirmed) next.ageConfirmed = `Please confirm you are ${minimumAge} or over`;
    return { errors: next, dateOfBirth };
  };

  const submit = async () => {
    if (submitting) return;
    const { errors: next, dateOfBirth } = validate();
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean) || !dateOfBirth) {
      haptic.error();
      return;
    }
    setSubmitting(true);
    try {
      const user = await signUp({ displayName: displayName.trim(), email, password, dateOfBirth, acceptTerms: true });
      toast.success(`You're in, ${user.displayName}. Time to rip your first pack.`, 'Welcome to RipVault');
    } catch (e) {
      const err = toApiError(e);
      const fieldErrors: FieldErrors = {
        displayName: err.fields.displayName,
        email: err.fields.email ?? (err.code === 'email_taken' ? err.message : undefined),
        password: err.fields.password,
        dateOfBirth: err.fields.dateOfBirth ?? (err.code === 'underage' ? err.message : undefined),
        acceptTerms: err.fields.acceptTerms,
      };
      setErrors(fieldErrors);
      setFormError(Object.values(fieldErrors).some(Boolean) ? null : err.message);
      haptic.error();
      setSubmitting(false);
    }
  };

  /** Digits only; jump to the next part once this one is full. */
  const datePart =
    (setter: (v: string) => void, max: number, next?: { current: TextFieldHandle | null }) => (text: string) => {
      const digits = digitsOnly(text).slice(0, max);
      setter(digits);
      clearError('dateOfBirth');
      if (digits.length === max) next?.current?.focus();
    };

  return (
    <Screen scroll keyboardAvoiding contentStyle={styles.content}>
      <AuthHero tagline="Create your vault. Every pack holds one real card, valued live." />

      <Panel style={styles.form}>
        <AppText variant="title" size={24} style={styles.heading}>
          Create account
        </AppText>

        <TextField
          label="Display name"
          value={displayName}
          onChangeText={(t) => {
            setDisplayName(t);
            clearError('displayName');
          }}
          placeholder="How other collectors see you"
          icon="person-outline"
          autoCapitalize="words"
          autoComplete="off"
          textContentType="nickname"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
          error={errors.displayName}
          style={styles.field}
        />
        <TextField
          inputRef={emailRef}
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            clearError('email');
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
            clearError('password');
          }}
          placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
          icon="lock-closed-outline"
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => dayRef.current?.focus()}
          error={errors.password}
          hint={`${PASSWORD_MIN_LENGTH}+ characters`}
          style={styles.field}
        />

        <AppText variant="label" style={styles.dobLabel}>
          Date of birth
        </AppText>
        <View style={styles.dobRow}>
          <TextField
            inputRef={dayRef}
            value={day}
            onChangeText={datePart(setDay, 2, monthRef)}
            placeholder="DD"
            keyboardType="number-pad"
            maxLength={2}
            centered
            autoComplete="birthdate-day"
            accessibilityLabel="Day of birth"
            invalid={!!errors.dateOfBirth}
            style={styles.dobDay}
          />
          <AppText variant="heading" tone="faint" style={styles.dobSlash}>
            /
          </AppText>
          <TextField
            inputRef={monthRef}
            value={month}
            onChangeText={datePart(setMonth, 2, yearRef)}
            placeholder="MM"
            keyboardType="number-pad"
            maxLength={2}
            centered
            autoComplete="birthdate-month"
            accessibilityLabel="Month of birth"
            invalid={!!errors.dateOfBirth}
            style={styles.dobDay}
          />
          <AppText variant="heading" tone="faint" style={styles.dobSlash}>
            /
          </AppText>
          <TextField
            inputRef={yearRef}
            value={year}
            onChangeText={datePart(setYear, 4)}
            placeholder="YYYY"
            keyboardType="number-pad"
            maxLength={4}
            centered
            autoComplete="birthdate-year"
            accessibilityLabel="Year of birth"
            invalid={!!errors.dateOfBirth}
            style={styles.dobYear}
          />
        </View>
        {errors.dateOfBirth ? (
          <View style={styles.inlineError} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={14} color={colors.danger} />
            <AppText variant="caption" tone="danger" style={styles.inlineErrorText}>
              {errors.dateOfBirth}
            </AppText>
          </View>
        ) : (
          <AppText variant="caption" tone="faint" style={styles.dobHint}>
            You must be {minimumAge} or over. We may ask for ID before withdrawals.
          </AppText>
        )}

        <Checkbox
          checked={acceptTerms}
          onChange={(v) => {
            setAcceptTerms(v);
            clearError('acceptTerms');
          }}
          label="I accept the Terms of Service and Privacy Policy"
          error={errors.acceptTerms}
          style={styles.checkbox}
        />
        <Checkbox
          checked={ageConfirmed}
          onChange={(v) => {
            setAgeConfirmed(v);
            clearError('ageConfirmed');
          }}
          label={`I am ${minimumAge} or over`}
          error={errors.ageConfirmed}
          style={styles.checkbox}
        />

        {formError ? (
          <View style={styles.formError} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <AppText variant="caption" tone="danger" style={styles.formErrorText}>
              {formError}
            </AppText>
          </View>
        ) : null}

        <Button
          title="Create account"
          variant="holo"
          size="lg"
          block
          loading={submitting}
          onPress={() => void submit()}
          style={styles.submit}
        />
      </Panel>

      <View style={styles.switchRow}>
        <AppText variant="body" tone="muted">
          Already have an account?{' '}
        </AppText>
        <Button title="Sign in" variant="ghost" size="sm" onPress={() => router.replace('/login')} />
      </View>

      <SaferPlayFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingTop: spacing.lg },
  form: { padding: spacing.xl },
  heading: { marginBottom: spacing.lg },
  field: { marginBottom: spacing.lg },
  dobLabel: { marginBottom: spacing.sm },
  dobRow: { flexDirection: 'row', alignItems: 'flex-start' },
  dobDay: { flex: 2 },
  dobYear: { flex: 3 },
  dobSlash: { marginHorizontal: spacing.sm, marginTop: 14 },
  dobHint: { marginTop: spacing.sm, marginBottom: spacing.md },
  inlineError: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.md },
  inlineErrorText: { flex: 1, marginLeft: spacing.xs },
  checkbox: { marginTop: spacing.xs },
  formError: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  formErrorText: { flex: 1, marginLeft: spacing.sm },
  submit: { marginTop: spacing.lg },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
  },
});
