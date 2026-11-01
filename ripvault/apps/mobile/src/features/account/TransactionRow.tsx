import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatPence } from '@ripvault/shared';
import type { Transaction } from '@ripvault/shared';
import { colors, radii } from '../../theme.ts';
import { ListRow } from '../../components/index.ts';
import { formatDateTime, formatRelative } from '../../lib/format.ts';
import { transactionMeta } from './meta.ts';

export interface TransactionRowProps {
  tx: Transaction;
  /** Round the top / bottom corners so consecutive rows read as one grouped panel. */
  first?: boolean;
  last?: boolean;
}

/** One ledger line: type icon, description, when, signed amount (credits green) and balance after. */
export const TransactionRow = memo(function TransactionRow({ tx, first = false, last = false }: TransactionRowProps) {
  const meta = transactionMeta(tx.type);
  const credit = tx.amountPence > 0;
  const amount = formatPence(tx.amountPence, { signed: true });
  const description = tx.description || meta.label;
  const label = `${description}. ${credit ? 'Credit' : 'Debit'} of ${formatPence(Math.abs(tx.amountPence))}, ${formatDateTime(
    tx.createdAt,
  )}. Balance after ${formatPence(tx.balanceAfterPence)}.`;
  return (
    <View style={[styles.wrap, first ? styles.first : null, last ? styles.last : null]}>
      {!first ? <View style={styles.separator} /> : null}
      <ListRow
        icon={meta.icon}
        iconColor={meta.color}
        title={description}
        subtitle={`${meta.label} · ${formatRelative(tx.createdAt)}`}
        value={amount}
        valueTone={credit ? 'success' : 'default'}
        valueCaption={`Bal ${formatPence(tx.balanceAfterPence)}`}
        accessibilityLabel={label}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  first: {
    borderTopWidth: 1,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  last: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 },
});
