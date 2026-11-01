import { useState } from 'react';
import type { ElementRef, ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { KeyboardTypeOptions, ReturnKeyTypeOptions, StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, HIT_SIZE, radii, spacing } from '../theme.ts';
import { AppText } from './AppText.tsx';
import type { IconName } from './icons.ts';

/** Ref type for focusing a TextField: const ref = useRef<TextFieldHandle>(null); ref.current?.focus(). */
export type TextFieldHandle = ElementRef<typeof TextInput>;

export interface TextFieldProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Error text under the field (red border). E.g. fieldError(err, 'email'). */
  error?: string | null;
  /** Red border without a message (when one message covers several fields, e.g. DOB parts). */
  invalid?: boolean;
  /** Helper text under the field when there is no error. */
  hint?: string;
  /** Password field with a show/hide toggle. */
  secure?: boolean;
  /** Ionicons name shown inside the field on the left. */
  icon?: IconName;
  /** Element rendered inside the field on the right (e.g. a "Max" button). */
  right?: ReactNode;
  /** Text shown before the input, e.g. "£". */
  prefix?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  autoCorrect?: boolean;
  autoFocus?: boolean;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  /** RN submitBehavior: 'submit' keeps the keyboard open (use with returnKeyType "next"). */
  submitBehavior?: 'submit' | 'blurAndSubmit' | 'newline';
  maxLength?: number;
  editable?: boolean;
  multiline?: boolean;
  /** Centre the text (e.g. DOB digits). */
  centered?: boolean;
  inputRef?: Ref<TextFieldHandle>;
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/** Labelled text input with focus ring, error text and optional password toggle. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  invalid = false,
  hint,
  secure = false,
  icon,
  right,
  prefix,
  keyboardType,
  autoCapitalize,
  autoComplete,
  textContentType,
  autoCorrect,
  autoFocus,
  returnKeyType,
  onSubmitEditing,
  submitBehavior,
  maxLength,
  editable = true,
  multiline = false,
  centered = false,
  inputRef,
  onFocus,
  onBlur,
  style,
  accessibilityLabel,
  testID,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const borderColor = error || invalid ? colors.danger : focused ? colors.violet : colors.border;

  return (
    <View style={[styles.wrap, style]}>
      {label ? (
        <AppText variant="label" style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <View style={[styles.field, { borderColor }, multiline ? styles.multiline : null, !editable ? styles.readonly : null]}>
        {icon ? <Ionicons name={icon} size={18} color={focused ? colors.text : colors.textMuted} style={styles.icon} /> : null}
        {prefix ? (
          <AppText variant="body" weight="700" tone="muted" style={styles.prefix}>
            {prefix}
          </AppText>
        ) : null}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={secure && !revealed}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? (secure ? 'none' : undefined)}
          autoComplete={autoComplete}
          textContentType={textContentType}
          autoCorrect={autoCorrect ?? (secure ? false : undefined)}
          autoFocus={autoFocus}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          submitBehavior={submitBehavior}
          maxLength={maxLength}
          editable={editable}
          multiline={multiline}
          keyboardAppearance="dark"
          selectionColor={colors.violet}
          cursorColor={colors.violet}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          accessibilityLabel={accessibilityLabel ?? label}
          testID={testID}
          style={[styles.input, centered ? styles.centered : null, multiline ? styles.inputMultiline : null]}
        />
        {secure ? (
          <Pressable
            onPress={() => setRevealed((r) => !r)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            style={styles.toggle}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
        {right}
      </View>
      {error ? (
        <View style={styles.messageRow} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={14} color={colors.danger} style={styles.messageIcon} />
          <AppText variant="caption" tone="danger" style={styles.messageText}>
            {error}
          </AppText>
        </View>
      ) : hint ? (
        <AppText variant="caption" tone="faint" style={styles.hint}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  label: { marginBottom: spacing.sm },
  field: {
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  multiline: { alignItems: 'flex-start', paddingVertical: spacing.md, minHeight: 104 },
  readonly: { opacity: 0.6 },
  icon: { marginRight: spacing.sm },
  prefix: { marginRight: spacing.xs },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 14,
    minHeight: HIT_SIZE,
  },
  inputMultiline: { textAlignVertical: 'top', paddingVertical: 0 },
  centered: { textAlign: 'center', fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: 1 },
  toggle: { marginLeft: spacing.sm, height: HIT_SIZE, justifyContent: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.xs + 2 },
  messageIcon: { marginTop: 2, marginRight: spacing.xs },
  messageText: { flex: 1 },
  hint: { marginTop: spacing.xs + 2 },
});
