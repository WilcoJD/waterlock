/**
 * Rewrites links that open the app from outside (ripvault://..., QR codes, other apps) before Expo
 * Router resolves them. Links to the rip screen are sent to the pack's odds sheet instead, so a link
 * can never buy packs without the player seeing the price and pressing Rip.
 */
import { redirectExternalPath } from '../src/features/packs/packData.ts';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return redirectExternalPath(path);
  } catch {
    return '/';
  }
}
