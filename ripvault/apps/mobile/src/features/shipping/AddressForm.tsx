import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Address } from '@ripvault/shared';
import { createAddress, toApiError } from '../../api/client.ts';
import { colors, HIT_SIZE, radii, spacing } from '../../theme.ts';
import { haptic } from '../../lib/haptics.ts';
import { AppText, Button, TextField } from '../../components/index.ts';
import type { TextFieldHandle } from '../../components/index.ts';
import { ADDRESS_LIMITS, countryList, countryName, emptyAddressForm, validateAddress } from './address.ts';
import type { AddressErrors, AddressField, AddressFormValues } from './address.ts';

export interface AddressFormProps {
  /** Allowed ISO country codes (config.shipping.countries). The first is the default. */
  countries: readonly string[];
  /** Called with the saved address (POST /addresses succeeded). */
  onSaved: (address: Address) => void;
  /** Shows a "Cancel" button. */
  onCancel?: () => void;
  submitLabel?: string;
}

const FIELD_KEYS: readonly AddressField[] = ['fullName', 'line1', 'line2', 'city', 'region', 'postcode', 'country', 'phone'];

/** New delivery address form with client-side checks; server field errors are mapped back onto fields. */
export function AddressForm({ countries, onSaved, onCancel, submitLabel = 'Save address' }: AddressFormProps) {
  const defaultCountry = countries[0] ?? 'GB';
  const [values, setValues] = useState<AddressFormValues>(() => emptyAddressForm(defaultCountry));
  const [errors, setErrors] = useState<AddressErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const line1Ref = useRef<TextFieldHandle>(null);
  const line2Ref = useRef<TextFieldHandle>(null);
  const cityRef = useRef<TextFieldHandle>(null);
  const regionRef = useRef<TextFieldHandle>(null);
  const postcodeRef = useRef<TextFieldHandle>(null);
  const phoneRef = useRef<TextFieldHandle>(null);

  // Config can arrive after mount: keep the chosen country one we actually ship to.
  const countriesKey = countries.join(',');
  useEffect(() => {
    setValues((v) => (countries.length > 0 && !countries.includes(v.country) ? { ...v, country: countries[0]! } : v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countriesKey]);

  const update = (field: AddressField) => (text: string) => {
    setValues((v) => ({ ...v, [field]: text }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
    if (formError) setFormError(null);
  };

  const submit = async () => {
    if (savingRef.current) return;
    const result = validateAddress(values, countries);
    if (result.input === null) {
      setErrors(result.errors);
      setFormError(null);
      haptic.error();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      const address = await createAddress(result.input);
      savingRef.current = false;
      setSaving(false);
      onSaved(address);
    } catch (e) {
      const err = toApiError(e);
      const fieldErrors: AddressErrors = {};
      for (const key of FIELD_KEYS) {
        const message = err.fields[key];
        if (message) fieldErrors[key] = message;
      }
      setErrors(fieldErrors);
      // invalid_state = address book full ("You can save up to N addresses...").
      setFormError(Object.keys(fieldErrors).length > 0 ? null : err.message);
      haptic.error();
      savingRef.current = false;
      setSaving(false);
    }
  };

  const singleCountry = countries.length <= 1;

  return (
    <View>
      <TextField
        label="Full name"
        value={values.fullName}
        onChangeText={update('fullName')}
        placeholder="Who should we address it to?"
        icon="person-outline"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => line1Ref.current?.focus()}
        maxLength={ADDRESS_LIMITS.fullName}
        error={errors.fullName}
        style={styles.field}
      />
      <TextField
        inputRef={line1Ref}
        label="Address line 1"
        value={values.line1}
        onChangeText={update('line1')}
        placeholder="House number and street"
        icon="home-outline"
        autoCapitalize="words"
        autoComplete="address-line1"
        textContentType="streetAddressLine1"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => line2Ref.current?.focus()}
        maxLength={ADDRESS_LIMITS.line1}
        error={errors.line1}
        style={styles.field}
      />
      <TextField
        inputRef={line2Ref}
        label="Address line 2 (optional)"
        value={values.line2}
        onChangeText={update('line2')}
        placeholder="Flat, building, company"
        autoCapitalize="words"
        autoComplete="address-line2"
        textContentType="streetAddressLine2"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => cityRef.current?.focus()}
        maxLength={ADDRESS_LIMITS.line2}
        error={errors.line2}
        style={styles.field}
      />
      <TextField
        inputRef={cityRef}
        label="Town or city"
        value={values.city}
        onChangeText={update('city')}
        placeholder="e.g. Manchester"
        autoCapitalize="words"
        textContentType="addressCity"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => regionRef.current?.focus()}
        maxLength={ADDRESS_LIMITS.city}
        error={errors.city}
        style={styles.field}
      />
      <View style={styles.pair}>
        <TextField
          inputRef={regionRef}
          label="County (optional)"
          value={values.region}
          onChangeText={update('region')}
          placeholder="e.g. Kent"
          autoCapitalize="words"
          textContentType="addressState"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => postcodeRef.current?.focus()}
          maxLength={ADDRESS_LIMITS.region}
          error={errors.region}
          style={[styles.field, styles.pairLeft]}
        />
        <TextField
          inputRef={postcodeRef}
          label="Postcode"
          value={values.postcode}
          onChangeText={update('postcode')}
          placeholder={values.country === 'GB' ? 'SW1A 1AA' : 'Postcode'}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="postal-code"
          textContentType="postalCode"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => phoneRef.current?.focus()}
          maxLength={ADDRESS_LIMITS.postcode}
          error={errors.postcode}
          style={[styles.field, styles.pairRight]}
        />
      </View>

      {singleCountry ? (
        <TextField
          label="Country"
          value={countryName(values.country)}
          onChangeText={() => undefined}
          editable={false}
          icon="globe-outline"
          hint={`We currently ship to ${countryList(countries.length > 0 ? countries : [values.country])} only.`}
          error={errors.country}
          style={styles.field}
        />
      ) : (
        <View style={styles.field}>
          <AppText variant="label" style={styles.countryLabel}>
            Country
          </AppText>
          <View style={styles.countryRow} accessibilityRole="radiogroup" accessibilityLabel="Country">
            {countries.map((code) => {
              const active = values.country === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => {
                    haptic.selection();
                    update('country')(code);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={countryName(code)}
                  style={({ pressed }: PressableStateCallbackType) => [
                    styles.countryChip,
                    active ? styles.countryChipActive : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <AppText variant="caption" weight="700" color={active ? colors.gold : colors.text}>
                    {countryName(code)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {errors.country ? (
            <AppText variant="caption" tone="danger" style={styles.countryError}>
              {errors.country}
            </AppText>
          ) : null}
        </View>
      )}

      <TextField
        inputRef={phoneRef}
        label="Phone (optional)"
        value={values.phone}
        onChangeText={update('phone')}
        placeholder="For the courier, if needed"
        icon="call-outline"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        maxLength={ADDRESS_LIMITS.phone}
        error={errors.phone}
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

      <Button title={submitLabel} variant="holo" size="lg" block icon="checkmark" loading={saving} onPress={() => void submit()} />
      {onCancel ? <Button title="Cancel" variant="ghost" block disabled={saving} onPress={onCancel} style={styles.cancel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: spacing.lg },
  pair: { flexDirection: 'row', alignItems: 'flex-start' },
  pairLeft: { flex: 1, marginRight: spacing.sm },
  pairRight: { flex: 1 },
  countryLabel: { marginBottom: spacing.sm },
  countryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  countryChip: {
    minHeight: HIT_SIZE,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countryChipActive: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  countryError: { marginTop: spacing.xs + 2 },
  pressed: { opacity: 0.7 },
  formError: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
  },
  formErrorText: { flex: 1, marginLeft: spacing.sm },
  cancel: { marginTop: spacing.sm },
});
