/**
 * Friendly copy for account-area failures (top-up, cash out, limits, profile, seeds).
 * Pure: takes the ApiError-like shape so it can be unit-tested without the API client.
 */
import { formatDateTime } from '../../lib/format.ts';

export interface ErrorLike {
  code: string;
  status: number;
  message: string;
  fields?: Readonly<Record<string, string>>;
}

export type AccountAction = 'topup' | 'withdraw' | 'limits' | 'profile' | 'rotate';

export interface ErrorCopy {
  title: string;
  message: string;
  /** Offer a "Top up" button. */
  offerTopUp?: boolean;
  /** The cached user is out of date (balance/limits): refresh /me. */
  refreshUser?: boolean;
  /** Field-level message to show under an input instead of a banner. */
  field?: { name: string; message: string };
}

const FIELD_FOR: Record<AccountAction, readonly string[]> = {
  topup: ['amountPence'],
  withdraw: ['amountPence', 'payoutDetails'],
  limits: ['dailySpendLimitPence', 'coolOffDays'],
  profile: ['displayName'],
  rotate: ['clientSeed'],
};

export function accountErrorCopy(err: ErrorLike, action: AccountAction, ctx: { coolingOffUntil?: string | null } = {}): ErrorCopy {
  if (err.code === 'validation_failed' && err.fields) {
    for (const name of FIELD_FOR[action]) {
      const message = err.fields[name];
      if (message) return { title: 'Check that', message, field: { name, message } };
    }
  }
  switch (err.code) {
    case 'insufficient_funds':
      return action === 'withdraw'
        ? { title: 'Not enough balance', message: 'Your balance is lower than that amount. Try a smaller amount.', refreshUser: true }
        : { title: 'Not enough balance', message: 'Top up to continue.', offerTopUp: true, refreshUser: true };
    case 'cooling_off': {
      const until = ctx.coolingOffUntil ? ` until ${formatDateTime(ctx.coolingOffUntil)}` : '';
      return {
        title: "You're taking a break",
        message: `Top-ups and pack opening are paused${until}. You can still sell, ship and cash out.`,
        refreshUser: true,
      };
    }
    case 'spend_limit_reached':
      return { title: 'Daily limit reached', message: "You've reached your daily pack limit. It frees up as the 24-hour window rolls on.", refreshUser: true };
    case 'payments_unavailable':
      return { title: 'Payments unavailable', message: "Card payments aren't available right now. Please try again later." };
    case 'forbidden':
      return action === 'withdraw'
        ? { title: 'Cash out unavailable', message: 'Cash outs are switched off right now. Your balance is safe; please try again later.' }
        : { title: "Can't do that", message: err.message };
    case 'rate_limited':
      return { title: 'Slow down', message: 'Too many attempts. Please wait a moment and try again.' };
    case 'conflict':
      return { title: 'Already in progress', message: 'That request is still being processed. Give it a moment, then check your balance.', refreshUser: true };
    case 'network':
    case 'timeout':
      return {
        title: "Couldn't reach RipVault",
        message:
          action === 'topup' || action === 'withdraw'
            ? `${err.message} If you try again it won't be charged twice.`
            : err.message,
      };
    default:
      return { title: 'Something went wrong', message: err.message || 'Please try again.' };
  }
}
