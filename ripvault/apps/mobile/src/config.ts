/**
 * Runtime configuration for the app (not the server-driven AppConfig; see src/state/config.tsx).
 *
 * API base URL resolution, first match wins:
 *   1. EXPO_PUBLIC_API_URL (inlined at bundle time). Set it for production builds, tunnels, or when the
 *      automatic LAN detection below picks the wrong interface:
 *        EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 npx expo start
 *   2. In development, the host Metro is served from (Constants.expoConfig.hostUri, e.g.
 *      "192.168.1.20:8081"), with the port swapped for the API's 4000. This is what makes a PHYSICAL
 *      PHONE running Expo Go reach the API on your computer: the phone and computer must be on the same
 *      Wi-Fi, and the API must listen on 0.0.0.0 (its default HOST). "localhost" on a phone is the phone
 *      itself, so it never works there. With `expo start --tunnel` the host is an exp.direct domain that
 *      does not forward port 4000, so use option 1 instead.
 *   3. http://localhost:4000 (iOS simulator / web on the same machine).
 */
import Constants from 'expo-constants';

export const API_PORT = 4000;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Host part of Metro's "host:port" (handles bracketed IPv6 like "[::1]:8081"). */
function hostFromHostUri(hostUri: string | undefined | null): string | null {
  if (!hostUri) return null;
  const withoutScheme = hostUri.replace(/^[a-z]+:\/\//i, '');
  const authority = withoutScheme.split('/')[0] ?? '';
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return end > 0 ? authority.slice(0, end + 1) : null;
  }
  const host = authority.split(':')[0];
  return host ? host : null;
}

function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && fromEnv.trim() !== '') return stripTrailingSlash(fromEnv.trim());

  const hostUri: string | undefined =
    Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? undefined;
  const host = hostFromHostUri(hostUri);
  if (host && !host.endsWith('.exp.direct')) return `http://${host}:${API_PORT}`;

  return `http://localhost:${API_PORT}`;
}

/** Base URL of the RipVault API, without a trailing slash. */
export const API_URL: string = resolveApiUrl();

/** Request timeout for API calls. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Safer-play links shown around the app (footer, limits screen). */
export const SUPPORT_LINKS = {
  beGambleAware: 'https://www.begambleaware.org',
  gamCare: 'https://www.gamcare.org.uk',
} as const;
