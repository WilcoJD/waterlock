/**
 * Navigation out of the packs modals (the odds sheet `/pack/[id]` and the full-screen rip screen
 * `/open/[id]`) and the top-up sheet (`/topup`).
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

/** Root-stack screens presented as modals (see app/_layout.tsx). */
const MODAL_ROUTE_NAMES: ReadonlySet<string> = new Set(['topup', 'pack/[id]', 'open/[id]']);

interface RouteLike {
  name: string;
}

/**
 * Index of the first of the modals stacked at the top of `routes` (up to `index`), or index + 1 when
 * the focused route is not a modal. E.g. [(tabs), open/[id], topup] -> 1.
 */
export function firstTopModalIndex(routes: readonly RouteLike[], index: number): number {
  let first = Math.min(index, routes.length - 1) + 1;
  while (first > 0 && MODAL_ROUTE_NAMES.has(routes[first - 1]?.name ?? '')) first -= 1;
  return first;
}

interface RootStackNavigationLike {
  getState(): { index: number; routes: readonly RouteLike[] };
  reset(state: { index: number; routes: RouteLike[] }): void;
}

/**
 * Leave every modal at the top of the root stack for a card route (e.g. 'limits'), from a screen of
 * the root stack (pass its `useNavigation()`). With one modal open this is leaveModalTo; when the
 * modal sits on another modal (top-up opened from the rip screen) replacing only the top one would
 * leave the card under the other modal, so the stack is reset to "screens below the modals + card".
 */
export function leaveModalsTo(navigation: RootStackNavigationLike | null | undefined, routeName: string): void {
  const state = navigation?.getState();
  if (!navigation || !state || !Array.isArray(state.routes)) {
    leaveModalTo(`/${routeName}`);
    return;
  }
  const first = firstTopModalIndex(state.routes, state.index);
  const modalCount = Math.min(state.index, state.routes.length - 1) + 1 - first;
  if (modalCount <= 1 || first === 0) {
    leaveModalTo(`/${routeName}`);
    return;
  }
  const routes = [...state.routes.slice(0, first), { name: routeName }];
  navigation.reset({ index: routes.length - 1, routes });
}
