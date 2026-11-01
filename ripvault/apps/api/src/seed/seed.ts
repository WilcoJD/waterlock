/**
 * Idempotent seeding: upsert cards and packs, create a new immutable pack revision only when a
 * pack's odds actually change, create/update the admin from ADMIN_EMAIL/ADMIN_PASSWORD, and (dev
 * only) the demo player.
 */
import { canonicalEntries, validateEntries } from '@ripvault/shared';
import type { SeedCard, SeedPack } from '@ripvault/shared';
import { DEMO_USER_BALANCE_PENCE, DEMO_USER_EMAIL, DEMO_USER_PASSWORD, isEmailLike } from '../config.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { all, tx } from '../db.ts';
import type { Deps } from '../deps.ts';
import { RTP_DEACTIVATED_PREFIX, exceedsMaxRtp, rtpPercent, writePackRevision } from '../services/admin.ts';
import { credit } from '../services/ledger.ts';
import { getPackEntriesWithValues } from '../services/packs.ts';
import type { PackRow } from '../services/rows.ts';
import { getUserByEmail, insertUser } from '../services/users.ts';
import { SeedFileError } from './load.ts';
import type { SeedData } from './load.ts';

/** The seed refused to create/update the admin account (see ADMIN_PROMOTE_EXISTING). */
export class SeedAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedAdminError';
  }
}

export interface SeedReport {
  cardsInserted: number;
  cardsUpdated: number;
  packsInserted: number;
  packsUpdated: number;
  revisionsCreated: number;
  /** Packs left/made inactive because their EV at seed values is above MAX_PACK_RTP_BPS. */
  deactivatedPacks: string[];
  admin: 'created' | 'updated' | 'skipped';
  demoUser: 'created' | 'exists' | 'skipped';
}

const CARD_ID = /^[A-Za-z0-9._-]{1,64}$/;
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX = /^#[0-9a-fA-F]{3,8}$/;

const isStr = (v: unknown, max = 500): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

/** Returns a list of human-readable problems (empty when valid). */
export function validateSeedData(data: SeedData, existingCardIds: ReadonlySet<string> = new Set()): string[] {
  const problems: string[] = [];
  const cardIds = new Set<string>();
  data.cards.forEach((c: Partial<SeedCard>, i) => {
    const at = `cards[${i}]${typeof c?.id === 'string' ? ` (${c.id})` : ''}`;
    if (!c || typeof c !== 'object') return void problems.push(`${at}: must be an object`);
    if (typeof c.id !== 'string' || !CARD_ID.test(c.id)) problems.push(`${at}: id must match ${CARD_ID}`);
    else if (cardIds.has(c.id)) problems.push(`${at}: duplicate id`);
    else cardIds.add(c.id);
    for (const k of ['name', 'setId', 'setName', 'number', 'rarity', 'imageSmall', 'imageLarge'] as const) {
      if (!isStr(c[k])) problems.push(`${at}: ${k} must be a non-empty string`);
    }
    if (!isInt(c.marketValuePence, 0)) problems.push(`${at}: marketValuePence must be a whole number of pence >= 0`);
    if (!(c.stock === null || isInt(c.stock, 0))) problems.push(`${at}: stock must be null or a whole number >= 0`);
  });
  const packIds = new Set<string>();
  data.packs.forEach((p: Partial<SeedPack>, i) => {
    const at = `packs[${i}]${typeof p?.id === 'string' ? ` (${p.id})` : ''}`;
    if (!p || typeof p !== 'object') return void problems.push(`${at}: must be an object`);
    if (typeof p.id !== 'string' || !PACK_ID.test(p.id)) problems.push(`${at}: id must be a lower-case slug`);
    else if (packIds.has(p.id)) problems.push(`${at}: duplicate id`);
    else packIds.add(p.id);
    if (!isStr(p.name, 60)) problems.push(`${at}: name must be 1-60 characters`);
    if (!isStr(p.tagline, 200)) problems.push(`${at}: tagline must be 1-200 characters`);
    if (!isInt(p.pricePence, 1)) problems.push(`${at}: pricePence must be a whole number > 0`);
    if (!isInt(p.sortOrder, -1_000_000)) problems.push(`${at}: sortOrder must be a whole number`);
    const t = p.theme;
    if (!t || !HEX.test(String(t.from)) || !HEX.test(String(t.to)) || !HEX.test(String(t.accent))) {
      problems.push(`${at}: theme needs hex colours from, to, accent`);
    }
    if (!Array.isArray(p.entries)) {
      problems.push(`${at}: entries must be an array`);
      return;
    }
    try {
      validateEntries(p.entries);
    } catch (err) {
      problems.push(`${at}: ${(err as Error).message}`);
    }
    for (const e of p.entries) {
      if (!cardIds.has(e.cardId) && !existingCardIds.has(e.cardId)) problems.push(`${at}: unknown card ${e.cardId}`);
    }
  });
  return problems;
}

export async function seedDatabase(deps: Deps, data: SeedData): Promise<SeedReport> {
  const { db, config } = deps;
  const existingIds = new Set(all<{ id: string }>(db, 'SELECT id FROM cards').map((r) => r.id));
  const problems = validateSeedData(data, existingIds);
  if (problems.length > 0) {
    throw new SeedFileError(`Seed data is invalid:\n  - ${problems.slice(0, 50).join('\n  - ')}`);
  }

  const wantAdmin = config.adminEmail !== null && config.adminPassword !== null;
  const wantDemo = config.seedDemoUser && config.env !== 'production';
  // Never silently hand admin rights to an account someone else may have registered (registration has no
  // email verification): promoting an existing player needs ADMIN_PROMOTE_EXISTING=1.
  const existingAdmin = wantAdmin ? getUserByEmail(db, config.adminEmail!) : undefined;
  if (existingAdmin && existingAdmin.role !== 'admin' && !config.adminPromoteExisting) {
    throw new SeedAdminError(
      `ADMIN_EMAIL ${config.adminEmail} belongs to an existing player account. Refusing to make it an admin: ` +
        'use a different ADMIN_EMAIL, or set ADMIN_PROMOTE_EXISTING=1 if you own that account ' +
        '(its password is reset and every existing session for it is signed out).',
    );
  }
  // Only write (and sign out existing sessions) when the role or the password actually changes.
  const adminUnchanged =
    existingAdmin?.role === 'admin' && (await verifyPassword(config.adminPassword!, existingAdmin.password_hash));
  // Hash outside the transaction: never await inside tx().
  const adminHash = wantAdmin && !adminUnchanged ? await hashPassword(config.adminPassword!) : null;
  const demoHash = wantDemo && !getUserByEmail(db, DEMO_USER_EMAIL) ? await hashPassword(DEMO_USER_PASSWORD) : null;

  const at = deps.now().toISOString();
  const report: SeedReport = {
    cardsInserted: 0,
    cardsUpdated: 0,
    packsInserted: 0,
    packsUpdated: 0,
    revisionsCreated: 0,
    deactivatedPacks: [],
    admin: 'skipped',
    demoUser: 'skipped',
  };

  tx(db, () => {
    const upsertCard = db.prepare(
      `INSERT INTO cards (id, name, set_id, set_name, number, rarity, image_small, image_large, market_value_pence,
         price_source, price_updated_at, stock, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed', NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, set_id = excluded.set_id, set_name = excluded.set_name, number = excluded.number,
         rarity = excluded.rarity, image_small = excluded.image_small, image_large = excluded.image_large,
         market_value_pence = CASE WHEN cards.price_source = 'seed' THEN excluded.market_value_pence ELSE cards.market_value_pence END,
         updated_at = excluded.updated_at`,
    );
    for (const c of data.cards) {
      if (existingIds.has(c.id)) report.cardsUpdated++;
      else report.cardsInserted++;
      // Stock is only set on first insert: afterwards it is live inventory (pulls, sells, admin).
      upsertCard.run(c.id, c.name, c.setId, c.setName, c.number, c.rarity, c.imageSmall, c.imageLarge, c.marketValuePence, c.stock, at, at);
    }

    for (const p of data.packs) {
      const existing = db.prepare('SELECT * FROM packs WHERE id = ?').get(p.id) as PackRow | undefined;
      const theme = JSON.stringify({ from: p.theme.from, to: p.theme.to, accent: p.theme.accent });
      if (!existing) {
        db.prepare(
          `INSERT INTO packs (id, name, tagline, price_pence, theme_json, sort_order, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        ).run(p.id, p.name, p.tagline, p.pricePence, theme, p.sortOrder, at, at);
        report.packsInserted++;
      } else {
        db.prepare(
          'UPDATE packs SET name = ?, tagline = ?, price_pence = ?, theme_json = ?, sort_order = ?, updated_at = ? WHERE id = ?',
        ).run(p.name, p.tagline, p.pricePence, theme, p.sortOrder, at, p.id);
        report.packsUpdated++;
      }
      const wanted = JSON.stringify(canonicalEntries(p.entries).map((e) => ({ cardId: e.cardId, weight: e.weight })));
      const currentRev = existing?.current_revision_id
        ? (db.prepare('SELECT entries_json FROM pack_revisions WHERE id = ?').get(existing.current_revision_id) as
            | { entries_json: string }
            | undefined)
        : undefined;
      if (currentRev?.entries_json !== wanted) {
        writePackRevision(db, p.id, p.entries, 'seed', at);
        report.revisionsCreated++;
      }
      const pack = db.prepare('SELECT * FROM packs WHERE id = ?').get(p.id) as unknown as PackRow;
      if (pack.active === 1) {
        const entries = getPackEntriesWithValues(db, p.id);
        if (exceedsMaxRtp(entries, pack.price_pence, config.maxPackRtpBps)) {
          db.prepare('UPDATE packs SET active = 0, deactivated_reason = ?, updated_at = ? WHERE id = ?').run(
            `${RTP_DEACTIVATED_PREFIX}${rtpPercent(entries, pack.price_pence)}% above maximum at seed values`,
            at,
            p.id,
          );
          report.deactivatedPacks.push(p.id);
        }
      }
    }

    if (adminUnchanged) {
      report.admin = 'updated';
    } else if (adminHash && config.adminEmail && isEmailLike(config.adminEmail)) {
      const admin = getUserByEmail(db, config.adminEmail);
      if (admin) {
        if (admin.role !== 'admin' && !config.adminPromoteExisting) {
          throw new SeedAdminError(`ADMIN_EMAIL ${config.adminEmail} belongs to an existing player account`);
        }
        // Bumping token_version signs out every session issued before the password/role change.
        db.prepare(
          "UPDATE users SET password_hash = ?, role = 'admin', token_version = token_version + 1, updated_at = ? WHERE id = ?",
        ).run(adminHash, at, admin.id);
        report.admin = 'updated';
      } else {
        insertUser(db, { email: config.adminEmail, passwordHash: adminHash, displayName: 'Admin', dateOfBirth: '1970-01-01', role: 'admin' }, at);
        report.admin = 'created';
      }
    }

    if (wantDemo) {
      if (getUserByEmail(db, DEMO_USER_EMAIL)) {
        report.demoUser = 'exists';
      } else if (demoHash) {
        const demo = insertUser(
          db,
          { email: DEMO_USER_EMAIL, passwordHash: demoHash, displayName: 'Demo Player', dateOfBirth: '1990-01-01' },
          at,
        );
        credit(db, {
          userId: demo.id,
          type: 'adjustment',
          amountPence: DEMO_USER_BALANCE_PENCE,
          description: 'Demo account starting balance',
          reference: 'seed',
          at,
        });
        report.demoUser = 'created';
      }
    }
  });

  deps.logger.info('seed complete', { ...report });
  return report;
}
