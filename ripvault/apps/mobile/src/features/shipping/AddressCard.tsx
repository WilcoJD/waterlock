import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AddressInput } from '@ripvault/shared';
import { colors, HIT_SIZE, radii, spacing, withAlpha } from '../../theme.ts';
import { AppText, IconButton, PressableScale } from '../../components/index.ts';
import { addressLines, addressSummary } from './address.ts';

export interface AddressCardProps {
  address: AddressInput;
  /** Radio-style selection (ship screen). Omit for a plain card. */
  selected?: boolean;
  onPress?: () => void;
  /** Shows a delete button (addresses screen). */
  onDelete?: () => void;
  deleting?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A saved (or snapshotted) delivery address. Selectable when onPress is given. */
export function AddressCard({ address, selected, onPress, onDelete, deleting, style }: AddressCardProps) {
  const selectable = selected !== undefined;
  const lines = addressLines(address);
  const body = (
    <>
      {selectable ? (
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={22}
          color={selected ? colors.gold : colors.textFaint}
          style={styles.radio}
        />
      ) : (
        <View style={styles.pin}>
          <Ionicons name="location-outline" size={18} color={colors.violet} />
        </View>
      )}
      <View style={styles.text}>
        <AppText variant="body" weight="700" numberOfLines={1}>
          {address.fullName}
        </AppText>
        {lines.map((line, i) => (
          <AppText key={`${i}-${line}`} variant="caption" tone="muted" numberOfLines={1}>
            {line}
          </AppText>
        ))}
        {address.phone ? (
          <AppText variant="caption" tone="faint" numberOfLines={1} style={styles.phone}>
            {address.phone}
          </AppText>
        ) : null}
      </View>
      {onDelete ? (
        <IconButton
          icon="trash-outline"
          variant="plain"
          color={colors.danger}
          accessibilityLabel={`Delete address ${addressSummary(address)}`}
          onPress={onDelete}
          disabled={deleting}
          style={styles.delete}
        />
      ) : null}
    </>
  );

  const boxStyle = [styles.card, selected ? styles.cardSelected : null, style];
  if (onPress) {
    return (
      <PressableScale
        onPress={onPress}
        haptic="selection"
        scaleTo={0.985}
        accessibilityRole={selectable ? 'radio' : 'button'}
        accessibilityState={selectable ? { checked: !!selected } : undefined}
        accessibilityLabel={`${address.fullName}, ${addressSummary(address)}`}
        style={boxStyle}
      >
        {body}
      </PressableScale>
    );
  }
  return (
    <View style={boxStyle} accessible={!onDelete} accessibilityLabel={`${address.fullName}, ${addressSummary(address)}`}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: HIT_SIZE + 16,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardSelected: {
    borderColor: colors.gold,
    backgroundColor: withAlpha(colors.gold, 0.07),
  },
  radio: { marginRight: spacing.md, marginTop: 1 },
  pin: {
    width: 32,
    height: 32,
    borderRadius: radii.xs,
    backgroundColor: colors.violetSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  text: { flex: 1, minWidth: 0 },
  phone: { marginTop: 2 },
  delete: { marginTop: -spacing.sm, marginRight: -spacing.sm, marginLeft: spacing.xs },
});
