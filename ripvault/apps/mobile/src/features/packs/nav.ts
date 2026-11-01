/**
 * Navigation out of the packs modals (the odds sheet `/pack/[id]` and the full-screen rip screen
 * `/open/[id]`).
 *
 * On iOS a regular (card) screen pushed on top of a native modal is placed under the modal, so the
 * player would see nothing happen. To leave a modal for a card route (/ship, /limits, /history,
 * /fairness) or for another modal (/open from the odds sheet), the modal is replaced instead.
 * Modals pushed on top of a modal (e.g. /topup) work, so those use router.push directly.
 */
import { router } from 'expo-router';

export function leaveModalTo(href: string): void {
  router.replace(href);
}
