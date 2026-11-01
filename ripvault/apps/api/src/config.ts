/**
 * Environment parsing and validation. Every setting the API reads lives here so the rest of the
 * code receives a typed, already-validated `Config` (and tests can build one without touching
 * process.env).
 */
import { DEFAULT_BUYBACK_BPS, MAX_OPEN_QUANTITY, MINIMUM_AGE } from '@ripvault/shared';
import type { AppConfig } from '@ripvault/shared';

export type NodeEnv = 'development' | 'test' | 'production';
export type PriceSource = 'cardmarket' | 'tcgplayer';

export interface Config {
  env: NodeEnv;
  port: number;
  host: string;
  databasePath: string;
  jwtSecret: string;
  buybackBps: number;
  maxPackRtpBps: number;
  shipping: {
    flatFeePence: number;
    freeOverPence: number | null;
    maxItemsPerShipment: number;
    countries: string[];
  };
  topup: {
    minPence: number;
    maxPence: number;
    presetsPence: number[];
  };
  devTopups: boolean;
  stripe: { secretKey: string; webhookSecret: string; apiBase: string } | null;
  publicUrl: string;
  withdrawals: { enabled: boolean; minPence: number };
  adminEmail: string | null;
  adminPassword: string | null;
  seedDemoUser: boolean;
  pokemontcgApiKey: string | null;
  priceSource: PriceSource;
  fxEurGbp: number;
  fxUsdGbp: number;
  /** Requests per IP per minute on /auth/*. */
  authRateLimitPerMinute: number;
  /** Use the first X-Forwarded-For entry as the client IP (only behind a trusted proxy). */
  trustProxy: boolean;
  logRequests: boolean;
}

export const DEV_JWT_SECRET = 'ripvault-dev-only-jwt-secret-do-not-use-in-production';
export const DEMO_USER_EMAIL = 'demo@ripvault.dev';
export const DEMO_USER_PASSWORD = 'ripvault-demo';
export const DEMO_USER_BALANCE_PENCE = 5_000;

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

/** Parse and validate configuration from environment variables. Throws ConfigError listing every problem. */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];
  const get = (name: string): string | undefined => {
    const v = env[name];
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
  };

  const rawEnv = get('NODE_ENV') ?? 'development';
  let nodeEnv: NodeEnv = 'development';
  if (rawEnv === 'production' || rawEnv === 'test' || rawEnv === 'development') nodeEnv = rawEnv;
  else problems.push(`NODE_ENV must be development, test or production (got "${rawEnv}")`);
  const production = nodeEnv === 'production';

  const int = (name: string, fallback: number, min: number, max: number): number => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    if (!/^-?\d+$/.test(raw)) {
      problems.push(`${name} must be an integer (got "${raw}")`);
      return fallback;
    }
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < min || n > max) {
      problems.push(`${name} must be between ${min} and ${max} (got ${raw})`);
      return fallback;
    }
    return n;
  };
  const decimal = (name: string, fallback: number): number => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(n) || n <= 0) {
      problems.push(`${name} must be a positive decimal number (got "${raw}")`);
      return fallback;
    }
    return n;
  };
  const bool = (name: string, fallback: boolean): boolean => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const v = raw.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    problems.push(`${name} must be 1/0 or true/false (got "${raw}")`);
    return fallback;
  };

  const port = int('PORT', 4000, 0, 65_535);
  const host = get('HOST') ?? '0.0.0.0';
  const databasePath = get('DATABASE_PATH') ?? './data/ripvault.db';

  let jwtSecret = get('JWT_SECRET') ?? '';
  if (production) {
    if (jwtSecret.length < 32) problems.push('JWT_SECRET is required in production and must be at least 32 characters');
    if (jwtSecret === DEV_JWT_SECRET) problems.push('JWT_SECRET must not be the development default in production');
  } else if (jwtSecret === '') {
    jwtSecret = DEV_JWT_SECRET;
  } else if (jwtSecret.length < 16) {
    problems.push('JWT_SECRET must be at least 16 characters (32+ in production)');
  }

  const buybackBps = int('BUYBACK_BPS', DEFAULT_BUYBACK_BPS, 0, 10_000);
  const maxPackRtpBps = int('MAX_PACK_RTP_BPS', 9_500, 1, 10_000);

  const flatFeePence = int('SHIPPING_FLAT_FEE_PENCE', 399, 0, 100_000);
  let freeOverPence: number | null = 5_000;
  if (env.SHIPPING_FREE_OVER_PENCE !== undefined) {
    freeOverPence = get('SHIPPING_FREE_OVER_PENCE') === undefined ? null : int('SHIPPING_FREE_OVER_PENCE', 5_000, 0, 100_000_000);
  }
  const maxItemsPerShipment = int('SHIPPING_MAX_ITEMS', 50, 1, 500);
  const countries = (get('SHIPPING_COUNTRIES') ?? 'GB')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c !== '');
  if (countries.length === 0 || countries.some((c) => !/^[A-Z]{2}$/.test(c))) {
    problems.push('SHIPPING_COUNTRIES must be a comma separated list of ISO 3166-1 alpha-2 codes, e.g. "GB,IE"');
  }

  const topupMin = int('TOPUP_MIN_PENCE', 500, 1, 10_000_000);
  const topupMax = int('TOPUP_MAX_PENCE', 50_000, 1, 10_000_000);
  if (topupMin > topupMax) problems.push('TOPUP_MIN_PENCE must not exceed TOPUP_MAX_PENCE');
  const presetsPence = [1_000, 2_500, 5_000, 10_000].filter((p) => p >= topupMin && p <= topupMax);

  const devTopupsRequested = bool('DEV_TOPUPS', !production);
  const devTopups = production ? false : devTopupsRequested;

  const stripeSecret = get('STRIPE_SECRET_KEY');
  const stripeWebhook = get('STRIPE_WEBHOOK_SECRET');
  let stripe: Config['stripe'] = null;
  if (stripeSecret && stripeWebhook) {
    stripe = { secretKey: stripeSecret, webhookSecret: stripeWebhook, apiBase: 'https://api.stripe.com' };
  } else if (stripeSecret || stripeWebhook) {
    problems.push('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set together');
  }

  const publicUrlRaw = get('PUBLIC_URL') ?? `http://localhost:${port || 4000}`;
  let publicUrl = publicUrlRaw.replace(/\/+$/, '');
  try {
    const u = new URL(publicUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    if (production && stripe && u.protocol !== 'https:') problems.push('PUBLIC_URL must be https in production when Stripe is enabled');
  } catch {
    problems.push(`PUBLIC_URL must be an http(s) URL (got "${publicUrlRaw}")`);
    publicUrl = 'http://localhost:4000';
  }

  const withdrawalsEnabled = bool('WITHDRAWALS_ENABLED', true);
  const withdrawalMin = int('WITHDRAWAL_MIN_PENCE', 1_000, 1, 10_000_000);

  const adminEmail = get('ADMIN_EMAIL')?.toLowerCase() ?? null;
  const adminPassword = get('ADMIN_PASSWORD') ?? null;
  if ((adminEmail === null) !== (adminPassword === null)) problems.push('ADMIN_EMAIL and ADMIN_PASSWORD must be set together');
  if (adminEmail !== null && !isEmailLike(adminEmail)) problems.push('ADMIN_EMAIL must be a valid email address');
  if (adminPassword !== null && adminPassword.length < (production ? 12 : 8)) {
    problems.push(`ADMIN_PASSWORD must be at least ${production ? 12 : 8} characters`);
  }

  const seedDemoRequested = bool('SEED_DEMO_USER', !production);
  if (production && env.SEED_DEMO_USER !== undefined && seedDemoRequested) {
    problems.push('SEED_DEMO_USER must not be enabled in production (the demo account has a public password)');
  }
  const seedDemoUser = production ? false : seedDemoRequested;

  const priceSourceRaw = (get('PRICE_SOURCE') ?? 'cardmarket').toLowerCase();
  let priceSource: PriceSource = 'cardmarket';
  if (priceSourceRaw === 'cardmarket' || priceSourceRaw === 'tcgplayer') priceSource = priceSourceRaw;
  else problems.push(`PRICE_SOURCE must be cardmarket or tcgplayer (got "${priceSourceRaw}")`);

  const config: Config = {
    env: nodeEnv,
    port,
    host,
    databasePath,
    jwtSecret,
    buybackBps,
    maxPackRtpBps,
    shipping: { flatFeePence, freeOverPence, maxItemsPerShipment, countries },
    topup: { minPence: topupMin, maxPence: topupMax, presetsPence },
    devTopups,
    stripe,
    publicUrl,
    withdrawals: { enabled: withdrawalsEnabled, minPence: withdrawalMin },
    adminEmail,
    adminPassword,
    seedDemoUser,
    pokemontcgApiKey: get('POKEMONTCG_API_KEY') ?? null,
    priceSource,
    fxEurGbp: decimal('FX_EUR_GBP', 0.86),
    fxUsdGbp: decimal('FX_USD_GBP', 0.79),
    authRateLimitPerMinute: int('AUTH_RATE_LIMIT_PER_MINUTE', 10, 1, 100_000),
    trustProxy: bool('TRUST_PROXY', false),
    logRequests: bool('LOG_REQUESTS', nodeEnv !== 'test'),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

/** A config suitable for tests: in-memory DB, dev top-ups on, quiet logs. Override anything. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', LOG_REQUESTS: '0' });
  return { ...base, authRateLimitPerMinute: 1_000, seedDemoUser: false, ...overrides };
}

/** The public subset of configuration, served at GET /config. */
export function publicAppConfig(config: Config): AppConfig {
  return {
    currency: 'GBP',
    buybackBps: config.buybackBps,
    maxOpenQuantity: MAX_OPEN_QUANTITY,
    shipping: {
      flatFeePence: config.shipping.flatFeePence,
      freeOverPence: config.shipping.freeOverPence,
      maxItemsPerShipment: config.shipping.maxItemsPerShipment,
      countries: [...config.shipping.countries],
    },
    topup: {
      minPence: config.topup.minPence,
      maxPence: config.topup.maxPence,
      presetsPence: [...config.topup.presetsPence],
      stripeEnabled: config.stripe !== null,
      devTopupsEnabled: devTopupsAllowed(config),
    },
    withdrawals: { enabled: config.withdrawals.enabled, minPence: config.withdrawals.minPence },
    minimumAge: MINIMUM_AGE,
  };
}

/** Belt and braces: dev top-ups are never allowed in production, whatever the object says. */
export function devTopupsAllowed(config: Config): boolean {
  return config.devTopups && config.env !== 'production';
}

export function isEmailLike(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
