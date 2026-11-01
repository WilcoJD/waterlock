import { router } from 'expo-router';

type WithDismissTo = { dismissTo?: (href: string) => void };

/**
 * From a pushed (root stack) screen back to the Vault tab without stacking a second tab navigator:
 * expo-router's dismissTo pops back to the existing tabs; falls back to back()/replace().
 */
export function goToVault(): void {
  const r = router as typeof router & WithDismissTo;
  if (typeof r.dismissTo === 'function') {
    r.dismissTo('/vault');
    return;
  }
  if (router.canGoBack()) router.back();
  else router.replace('/vault');
}

/** Ship screen for these vaulted item ids (comma separated in the `items` param). */
export function shipHref(itemIds: readonly string[]): string {
  return `/ship?items=${itemIds.map(encodeURIComponent).join(',')}`;
}
