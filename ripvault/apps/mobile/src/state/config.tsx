/**
 * Server-driven app configuration (GET /config): buyback rate, top-up presets, shipping fees...
 *
 *   const { config } = useAppConfig();
 *   const offer = buybackPence(card.marketValuePence, config.buybackBps);
 *
 * `config` is always usable: until /config loads it holds DEFAULT_APP_CONFIG (mirrors the API's
 * defaults). Fetched once at startup with a few retries (and again on app foreground until it
 * succeeds); call `reload()` to fetch again.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { DEFAULT_BUYBACK_BPS, MAX_OPEN_QUANTITY, MINIMUM_AGE } from '@ripvault/shared';
import type { AppConfig } from '@ripvault/shared';
import { getConfig, toApiError } from '../api/client.ts';
import type { ApiError } from '../api/client.ts';

/** Same values as the API's defaults (apps/api/src/config.ts), used until /config responds. */
export const DEFAULT_APP_CONFIG: AppConfig = {
  currency: 'GBP',
  buybackBps: DEFAULT_BUYBACK_BPS,
  maxOpenQuantity: MAX_OPEN_QUANTITY,
  shipping: {
    flatFeePence: 399,
    freeOverPence: 5_000,
    maxItemsPerShipment: 50,
    countries: ['GB'],
  },
  topup: {
    minPence: 500,
    maxPence: 50_000,
    presetsPence: [1_000, 2_500, 5_000, 10_000],
    stripeEnabled: false,
    devTopupsEnabled: false,
  },
  withdrawals: {
    enabled: true,
    minPence: 1_000,
  },
  minimumAge: MINIMUM_AGE,
};

export interface AppConfigValue {
  /** Server config, or DEFAULT_APP_CONFIG until it has loaded. */
  config: AppConfig;
  /** True once /config has responded successfully. */
  loaded: boolean;
  /** Last load error (null once loaded). */
  error: ApiError | null;
  /** Fetch /config again. Never rejects. */
  reload: () => Promise<void>;
}

const AppConfigContext = createContext<AppConfigValue | null>(null);

const RETRY_DELAYS_MS = [1_500, 4_000, 10_000];

export function AppConfigProvider({ children }: { children?: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const mountedRef = useRef(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (attempt: number): Promise<void> => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    try {
      const next = await getConfig();
      if (!mountedRef.current) return;
      setConfig(next);
      setLoaded(true);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(toApiError(e));
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) {
        retryTimerRef.current = setTimeout(() => {
          void load(attempt + 1);
        }, delay);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load(0);
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [load]);

  const reload = useCallback(() => load(RETRY_DELAYS_MS.length), [load]);

  // If the API was unreachable at launch, try again whenever the app returns to the foreground.
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && !loadedRef.current) void load(RETRY_DELAYS_MS.length);
    });
    return () => sub.remove();
  }, [load]);

  const value = useMemo<AppConfigValue>(() => ({ config, loaded, error, reload }), [config, loaded, error, reload]);
  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfigValue {
  const ctx = useContext(AppConfigContext);
  if (!ctx) throw new Error('useAppConfig must be used inside <AppConfigProvider>');
  return ctx;
}
