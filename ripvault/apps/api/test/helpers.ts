/**
 * Test harness: an in-memory database, an injected clock and fetch, and the real HTTP server on an
 * ephemeral port. Uses its own small card/pack fixtures (never apps/api/seed/*.json).
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Me, SeedCard, SeedPack } from '@ripvault/shared';
import { createApp } from '../src/app.ts';
import { testConfig } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import { openDatabase, tx } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import type { Deps, FetchFn } from '../src/deps.ts';
import { signToken } from '../src/auth/jwt.ts';
import { credit } from '../src/services/ledger.ts';
import { insertUser } from '../src/services/users.ts';
import { seedDatabase } from '../src/seed/seed.ts';
import type { SeedData } from '../src/seed/load.ts';

const img = (id: string) => ({
  imageSmall: `https://images.example.test/${id}.png`,
  imageLarge: `https://images.example.test/${id}_hires.png`,
});

export const FIXTURE_CARDS: SeedCard[] = [
  { id: 'tst-1', name: 'Pidgey', setId: 'tst', setName: 'Test Set', number: '1', rarity: 'Common', ...img('tst-1'), marketValuePence: 40, stock: null },
  { id: 'tst-2', name: 'Rattata', setId: 'tst', setName: 'Test Set', number: '2', rarity: 'Common', ...img('tst-2'), marketValuePence: 60, stock: null },
  { id: 'tst-3', name: 'Pikachu', setId: 'tst', setName: 'Test Set', number: '3', rarity: 'Uncommon', ...img('tst-3'), marketValuePence: 150, stock: null },
  { id: 'tst-4', name: 'Charizard ex', setId: 'tst', setName: 'Test Set', number: '4', rarity: 'Rare', ...img('tst-4'), marketValuePence: 900, stock: null },
  { id: 'tst-5', name: 'Umbreon VMAX', setId: 'tst', setName: 'Test Set', number: '5', rarity: 'Rare Secret', ...img('tst-5'), marketValuePence: 4_000, stock: 1_000 },
  { id: 'tst-6', name: 'Rayquaza VMAX', setId: 'tst', setName: 'Test Set', number: '6', rarity: 'Rare Rainbow', ...img('tst-6'), marketValuePence: 15_000, stock: 1_000 },
  { id: 'tst-7', name: 'Mew ex', setId: 'tst', setName: 'Test Set', number: '7', rarity: 'Rare', ...img('tst-7'), marketValuePence: 450, stock: 1 },
  { id: 'tst-8', name: 'Ditto', setId: 'tst', setName: 'Test Set', number: '8', rarity: 'Common', ...img('tst-8'), marketValuePence: 100, stock: 0 },
  { id: 'tst-9', name: 'Eevee', setId: 'tst', setName: 'Test Set', number: '9', rarity: 'Common', ...img('tst-9'), marketValuePence: 1_999, stock: null },
];

const theme = { from: '#1d4ed8', to: '#0f172a', accent: '#f59e0b' };

export const FIXTURE_PACKS: SeedPack[] = [
  {
    id: 'starter',
    name: 'Starter Rip',
    tagline: 'Cheap thrills',
    pricePence: 500,
    sortOrder: 1,
    theme,
    entries: [
      { cardId: 'tst-1', weight: 500 },
      { cardId: 'tst-2', weight: 300 },
      { cardId: 'tst-3', weight: 150 },
      { cardId: 'tst-4', weight: 50 },
    ],
  },
  {
    id: 'premium',
    name: 'Premium Rip',
    tagline: 'Chase the big hits',
    pricePence: 2_000,
    sortOrder: 2,
    theme,
    entries: [
      { cardId: 'tst-4', weight: 800 },
      { cardId: 'tst-5', weight: 180 },
      { cardId: 'tst-6', weight: 20 },
    ],
  },
  { id: 'limited', name: 'Limited Drop', tagline: 'Only one exists', pricePence: 500, sortOrder: 3, theme, entries: [{ cardId: 'tst-7', weight: 1 }] },
  { id: 'gone', name: 'Gone Pack', tagline: 'Sold out', pricePence: 200, sortOrder: 4, theme, entries: [{ cardId: 'tst-8', weight: 1 }] },
  { id: 'single', name: 'Single Eevee', tagline: 'Always Eevee', pricePence: 2_200, sortOrder: 5, theme, entries: [{ cardId: 'tst-9', weight: 1 }] },
];

export function fixtureSeed(): SeedData {
  return { cards: structuredClone(FIXTURE_CARDS), packs: structuredClone(FIXTURE_PACKS) };
}

export class TestClock {
  ms: number;
  constructor(start = Date.parse('2026-06-01T12:00:00.000Z')) {
    this.ms = start;
  }
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export interface Res<T = any> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

export interface RequestOptions {
  body?: unknown;
  rawBody?: string;
  token?: string;
  headers?: Record<string, string>;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export interface TestApp {
  url: string;
  db: Db;
  deps: Deps;
  config: Config;
  clock: TestClock;
  request<T = any>(method: string, path: string, opts?: RequestOptions): Promise<Res<T>>;
  /** Fast user creation straight in the DB (no scrypt), with an optional starting balance. */
  user(opts?: { balancePence?: number; role?: 'user' | 'admin'; email?: string }): TestUser;
  admin(): TestUser;
  fund(userId: string, pence: number): void;
  me(token: string): Promise<Me>;
  close(): Promise<void>;
}

export interface StartOptions {
  config?: Partial<Config>;
  fetch?: FetchFn;
  seed?: SeedData | false;
  clock?: TestClock;
}

let counter = 0;

export async function startApp(opts: StartOptions = {}): Promise<TestApp> {
  const config = testConfig(opts.config);
  const db = openDatabase(':memory:');
  const clock = opts.clock ?? new TestClock();
  const fetchFn: FetchFn =
    opts.fetch ??
    (async (url) => {
      throw new Error(`unexpected network call in test: ${url}`);
    });
  const app = createApp({ config, db, now: clock.now, fetch: fetchFn });
  if (opts.seed !== false) await seedDatabase(app.deps, opts.seed ?? fixtureSeed());

  const server = createServer(app.handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  const request = async <T = any>(method: string, path: string, o: RequestOptions = {}): Promise<Res<T>> => {
    const headers: Record<string, string> = { ...o.headers };
    let body: string | undefined;
    if (o.rawBody !== undefined) body = o.rawBody;
    else if (o.body !== undefined) {
      body = JSON.stringify(o.body);
      headers['Content-Type'] ??= 'application/json';
    }
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    const res = await fetch(url + path, { method, headers, body });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text && (res.headers.get('content-type') ?? '').includes('json')) parsed = JSON.parse(text);
    return { status: res.status, body: parsed as T, text, headers: res.headers };
  };

  const user = (o: { balancePence?: number; role?: 'user' | 'admin'; email?: string } = {}): TestUser => {
    counter++;
    const email = o.email ?? `player${counter}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const at = clock.now().toISOString();
    const row = tx(db, () => {
      const u = insertUser(
        db,
        { email, passwordHash: 'scrypt$disabled', displayName: `Player ${counter}`, dateOfBirth: '1990-05-05', role: o.role ?? 'user' },
        at,
      );
      if (o.balancePence) {
        credit(db, { userId: u.id, type: 'adjustment', amountPence: o.balancePence, description: 'test funds', reference: null, at });
      }
      return u;
    });
    return { id: row.id, email: row.email, token: signToken(row.id, config.jwtSecret, clock.now()) };
  };

  return {
    url,
    db,
    deps: app.deps,
    config,
    clock,
    request,
    user,
    admin: () => user({ role: 'admin' }),
    fund: (userId, pence) =>
      tx(db, () => {
        credit(db, { userId, type: 'adjustment', amountPence: pence, description: 'test funds', reference: null, at: clock.now().toISOString() });
      }),
    me: async (token) => (await request<Me>('GET', '/me', { token })).body,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

/** balance_pence must equal the ledger sum for every user, and never be negative. */
export function ledgerMismatches(db: Db): { id: string; balance: number; ledger: number }[] {
  return db
    .prepare(
      `SELECT u.id AS id, u.balance_pence AS balance, COALESCE((SELECT SUM(amount_pence) FROM transactions t WHERE t.user_id = u.id), 0) AS ledger
       FROM users u`,
    )
    .all()
    .map((r) => r as unknown as { id: string; balance: number; ledger: number })
    .filter((r) => r.balance !== r.ledger || r.balance < 0);
}

export function count(db: Db, sql: string, ...params: (string | number | null)[]): number {
  return Number((db.prepare(sql).get(...params) as { n: number }).n);
}

/** Deterministic PRNG for randomized tests (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
