/**
 * Friendly copy + next step for every way opening a pack can fail. Pure (no React / native), so it
 * can be unit-tested with plain Node.
 */
import { formatPence } from '@ripvault/shared';
import type { SpendLimits } from '@ripvault/shared';
import { formatDateTime, plural } from '../../lib/format.ts';
import type { IconName } from '../../components/icons.ts';

/** What a button on the error panel does. `retry` re-sends the SAME rip (same Idempotency-Key). */
export type RipErrorAction = 'retry' | 'topup' | 'limits' | 'close';

export interface RipErrorButton {
  label: string;
  action: RipErrorAction;
  icon?: IconName;
}

export interface RipErrorCopy {
  icon: IconName;
  /** Accent for the medallion. */
  tone: 'danger' | 'gold' | 'violet';
  title: string;
  message: string;
  primary: RipErrorButton;
  secondary?: RipErrorButton;
}

export interface RipErrorContext {
  quantity: number;
  /** Total cost of this rip, when the pack price is known. */
  costPence: number | null;
  balancePence: number | null;
  limits: SpendLimits | null;
}

/** The subset of ApiError this needs (keeps the module free of the API client). */
export interface RipErrorLike {
  code: string;
  status: number;
  message: string;
}

const NOTHING_CHARGED = 'Nothing was charged.';
const CLOSE: RipErrorButton = { label: 'Back to packs', action: 'close', icon: 'arrow-back' };

export function ripErrorCopy(err: RipErrorLike, ctx: RipErrorContext): RipErrorCopy {
  const cost = ctx.costPence !== null ? formatPence(ctx.costPence) : null;
  const packs = plural(ctx.quantity, 'pack');

  switch (err.code) {
    case 'insufficient_funds': {
      const parts: string[] = [];
      if (cost && ctx.balancePence !== null) {
        parts.push(`Ripping ${packs} costs ${cost} and your balance is ${formatPence(ctx.balancePence)}.`);
        const short = (ctx.costPence ?? 0) - ctx.balancePence;
        if (short > 0) parts.push(`Top up at least ${formatPence(short)} to rip.`);
      } else {
        parts.push(`Your balance doesn't cover ${cost ? `this rip (${cost})` : 'this rip'}.`);
      }
      parts.push(NOTHING_CHARGED);
      return {
        icon: 'wallet-outline',
        tone: 'gold',
        title: 'Top up to rip',
        message: parts.join(' '),
        primary: { label: 'Top up', action: 'topup', icon: 'add-circle-outline' },
        secondary: { label: 'Try again', action: 'retry', icon: 'refresh' },
      };
    }
    case 'cooling_off': {
      const until = ctx.limits?.coolingOffUntil;
      return {
        icon: 'cafe-outline',
        tone: 'violet',
        title: "You're taking a break",
        message: `${until ? `Pack opening is paused until ${formatDateTime(until)}.` : 'Pack opening is paused during your break.'} You can still sell, ship and withdraw. ${NOTHING_CHARGED}`,
        primary: { label: 'Safer play settings', action: 'limits', icon: 'shield-checkmark-outline' },
        secondary: CLOSE,
      };
    }
    case 'spend_limit_reached': {
      const limit = ctx.limits?.dailySpendLimitPence;
      const spent = ctx.limits?.spentLast24hPence;
      const detail =
        limit !== null && limit !== undefined
          ? `${cost ? `This rip (${cost})` : 'This rip'} would take you over your daily limit of ${formatPence(limit)}${
              spent !== undefined ? ` (you've spent ${formatPence(spent)} in the last 24 hours)` : ''
            }.`
          : 'This rip would take you over your daily spend limit.';
      return {
        icon: 'speedometer-outline',
        tone: 'violet',
        title: 'Daily limit reached',
        message: `${detail} ${NOTHING_CHARGED}`,
        primary: { label: 'View my limits', action: 'limits', icon: 'shield-checkmark-outline' },
        secondary: CLOSE,
      };
    }
    case 'sold_out':
      return {
        icon: 'cube-outline',
        tone: 'gold',
        title: 'Sold out',
        message: `A card in this pack just ran out of stock, so it can't be opened right now. ${NOTHING_CHARGED}`,
        primary: { label: 'Choose another pack', action: 'close', icon: 'layers-outline' },
      };
    case 'pack_unavailable':
    case 'not_found':
      return {
        icon: 'eye-off-outline',
        tone: 'gold',
        title: 'Pack unavailable',
        message: `This pack has been taken off the shelf for now. ${NOTHING_CHARGED}`,
        primary: { label: 'Choose another pack', action: 'close', icon: 'layers-outline' },
      };
    case 'validation_failed':
    case 'bad_request':
      return {
        icon: 'alert-circle-outline',
        tone: 'danger',
        title: "Couldn't open that",
        message: `${err.message} ${NOTHING_CHARGED}`,
        primary: CLOSE,
      };
    case 'unauthorized':
      return {
        icon: 'log-in-outline',
        tone: 'violet',
        title: 'Please sign in again',
        message: `Your session ended. ${NOTHING_CHARGED}`,
        primary: CLOSE,
      };
    case 'rate_limited':
      return {
        icon: 'hourglass-outline',
        tone: 'violet',
        title: 'One moment',
        message: 'Too many attempts in a short time. Wait a few seconds, then try again.',
        primary: { label: 'Try again', action: 'retry', icon: 'refresh' },
        secondary: CLOSE,
      };
    case 'network':
    case 'timeout':
    case 'internal':
    case 'bad_response':
      return {
        icon: 'cloud-offline-outline',
        tone: 'danger',
        title: err.code === 'timeout' ? 'Still waiting on the vault' : "Couldn't reach the vault",
        message:
          "We couldn't confirm your rip. Retrying is safe: if it already went through you'll see the same cards and won't be charged twice.",
        primary: { label: 'Retry', action: 'retry', icon: 'refresh' },
        secondary: CLOSE,
      };
    default:
      return {
        icon: 'alert-circle-outline',
        tone: 'danger',
        title: "Couldn't open the pack",
        message: err.message || 'Something went wrong. Please try again.',
        primary: { label: 'Try again', action: 'retry', icon: 'refresh' },
        secondary: CLOSE,
      };
  }
}
