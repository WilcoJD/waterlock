'use strict';
/**
 * Compliance plugin: KYC tiers, tiered limits, geo/product restrictions, terms
 * versioning, travel-rule originator/beneficiary data, transaction monitoring
 * (flags, freezing, sanctions screening) and an audit-log viewer.
 *
 * References (see docs/COMPLIANCE.md for the full list):
 *  - FATF Recommendation 16 "travel rule" for VASPs (USD/EUR 1,000 threshold; originator name,
 *    account/wallet, address or national ID or DOB+place of birth; beneficiary name + account):
 *    https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html
 *  - EU Transfer of Funds Regulation (Reg. (EU) 2023/1113), applies from 30 Dec 2024, no de-minimis for
 *    CASP transfers, EUR 1,000 self-hosted address verification: https://eur-lex.europa.eu/eli/reg/2023/1113/oj
 *  - EU MiCA (Reg. (EU) 2023/1114): https://eur-lex.europa.eu/eli/reg/2023/1114/oj
 *  - FCA PS20/10 retail crypto-derivatives ban: https://www.fca.org.uk/publications/policy-statements/ps20-10-prohibiting-sale-retail-clients-investment-products-reference-cryptoassets
 *  - OFAC SDN list formats: https://sanctionslist.ofac.treas.gov/Home/SdnList
 *  - ISO 3166-1 alpha-2: https://www.iso.org/iso-3166-country-codes.html
 *  - Cloudflare CF-IPCountry header: https://developers.cloudflare.com/fundamentals/reference/http-headers/
 *  - express-rate-limit: https://github.com/express-rate-limit/express-rate-limit
 */
const path = require('node:path');
const { HttpError } = require('../../provisioner');
const { Limits, DEFAULT_TIERS, effectiveTiers, normalizeTiers } = require('./limits');
const { Kyc } = require('./kyc');
const { Monitor } = require('./monitoring');
const { FileStore } = require('./files');
const { COUNTRIES, DEFAULT_SANCTIONED, DEFAULT_DERIVATIVES_RESTRICTED, normalizeCountry, countryName } = require('./countries');

const STABLE = new Set(['USDT', 'USDC', 'USD', 'DAI', 'TUSD', 'FDUSD']);
const TR_FIELDS = ['beneficiary_name', 'beneficiary_type', 'wallet_type', 'vasp_name', 'vasp_country', 'self_hosted_confirmed'];

module.exports = {
  name: 'compliance',
  web: ['js/compliance.js'],

  schema: `
    CREATE TABLE IF NOT EXISTS compliance_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      country TEXT,                                -- declared residence (ISO 3166-1 alpha-2)
      full_name TEXT, dob TEXT,                    -- copied from the approved tier-1 case
      terms_version TEXT, risk_version TEXT, terms_accepted_at TEXT,
      frozen_reason TEXT, frozen_at TEXT, frozen_by INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS kyc_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      tier INTEGER NOT NULL,                       -- requested tier 1..3
      status TEXT NOT NULL DEFAULT 'draft',        -- draft|submitted|approved|rejected|expired
      fields TEXT NOT NULL DEFAULT '{}',           -- JSON (PII)
      screening TEXT,                              -- JSON sanctions screening result at submission
      reviewer_id INTEGER,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT, decided_at TEXT, expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS kyc_cases_user ON kyc_cases(user_id, status);
    CREATE INDEX IF NOT EXISTS kyc_cases_status ON kyc_cases(status, submitted_at);
    CREATE TABLE IF NOT EXISTS kyc_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES kyc_cases(id),
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,                          -- id_front|id_back|selfie|proof_of_address|source_of_funds_doc
      path TEXT NOT NULL,                          -- relative to the KYC directory, random name
      mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
      original_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS kyc_documents_case ON kyc_documents(case_id);
    CREATE TABLE IF NOT EXISTS compliance_terms_acceptances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      terms_version TEXT NOT NULL, risk_version TEXT NOT NULL,
      implicit INTEGER NOT NULL DEFAULT 0,         -- 1 = accepted by registering
      ip TEXT, user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS compliance_terms_user ON compliance_terms_acceptances(user_id, id);
    CREATE TABLE IF NOT EXISTS compliance_country_rules (
      country TEXT PRIMARY KEY,                    -- ISO 3166-1 alpha-2
      sanctioned INTEGER NOT NULL DEFAULT 0,       -- 1 = block signup, trading, withdrawals
      derivatives INTEGER,                         -- NULL = default list, 0 = blocked, 1 = allowed
      note TEXT, updated_by INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS compliance_travel_rule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      withdrawal_id INTEGER UNIQUE REFERENCES withdrawals(id),   -- linked once the withdrawal row exists
      user_id INTEGER NOT NULL REFERENCES users(id),
      asset TEXT NOT NULL, chain TEXT, address TEXT NOT NULL, amount INTEGER NOT NULL, amount_usd REAL NOT NULL,
      beneficiary_name TEXT NOT NULL,
      beneficiary_type TEXT NOT NULL,              -- self|third_party
      wallet_type TEXT NOT NULL,                   -- vasp|self_hosted
      vasp_name TEXT, vasp_country TEXT,
      self_hosted_confirmed INTEGER NOT NULL DEFAULT 0,
      originator TEXT,                             -- JSON snapshot of the originator (our KYC data) at the time
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS compliance_travel_user ON compliance_travel_rule(user_id, id);
    CREATE TABLE IF NOT EXISTS compliance_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      rule TEXT NOT NULL,                          -- velocity.withdrawals|pass_through|large_withdrawal|round_trip_volume|counterparty_concentration|sanctions_match|sanctioned_country_login
      severity TEXT NOT NULL,                      -- low|medium|high|critical
      title TEXT NOT NULL,
      details TEXT,                                -- JSON
      status TEXT NOT NULL DEFAULT 'open',         -- open|dismissed|escalated|frozen
      hits INTEGER NOT NULL DEFAULT 1,
      reviewer_id INTEGER, note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS compliance_flags_status ON compliance_flags(status, severity, id);
    CREATE INDEX IF NOT EXISTS compliance_flags_user ON compliance_flags(user_id, rule, status);
    CREATE TABLE IF NOT EXISTS compliance_sanctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, normalized TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',          -- JSON [{name, normalized}]
      type TEXT NOT NULL DEFAULT 'individual',     -- individual|entity
      source TEXT NOT NULL DEFAULT 'manual',       -- manual|ofac_sdn|eu|uk|...
      program TEXT, ref_id TEXT, country TEXT, dob TEXT, note TEXT,
      added_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS compliance_sanctions_norm ON compliance_sanctions(normalized);
  `,

  migrate(db, helpers = {}) {
    // helpers.addCols is absent when tests hand app.js an already-open DB; use the same PRAGMA approach.
    const addCols = helpers.addCols || ((t, defs) => {
      const have = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
      for (const [c, d] of defs) if (!have.has(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
    });
    addCols('users', [['kyc_tier', 'INTEGER NOT NULL DEFAULT 0'], ['frozen', 'INTEGER NOT NULL DEFAULT 0']]);
  },

  config(env, { num, bool, list }) {
    let tiers = DEFAULT_TIERS;
    if (env.COMPLIANCE_TIERS) { try { tiers = normalizeTiers(JSON.parse(env.COMPLIANCE_TIERS)); } catch (e) { throw new Error(`COMPLIANCE_TIERS must be JSON: ${e.message}`); } }
    return {
      enabled: bool(env.COMPLIANCE_ENABLED, true),
      countryHeader: (env.COMPLIANCE_COUNTRY_HEADER || 'cf-ipcountry').toLowerCase(),
      termsVersion: env.COMPLIANCE_TERMS_VERSION || '2026-01',
      riskVersion: env.COMPLIANCE_RISK_VERSION || '2026-01',
      travelRuleUsd: num(env.COMPLIANCE_TRAVEL_RULE_USD, 1000),
      sanctionedCountries: env.COMPLIANCE_SANCTIONED_COUNTRIES === undefined ? DEFAULT_SANCTIONED : list(env.COMPLIANCE_SANCTIONED_COUNTRIES).map((c) => c.toUpperCase()),
      derivativesRestricted: env.COMPLIANCE_DERIVATIVES_RESTRICTED === undefined ? DEFAULT_DERIVATIVES_RESTRICTED : list(env.COMPLIANCE_DERIVATIVES_RESTRICTED).map((c) => c.toUpperCase()),
      tiers,
      kycDir: env.COMPLIANCE_KYC_DIR || '',
      fileKey: env.COMPLIANCE_FILE_KEY || '',
      maxFileBytes: Math.round(num(env.COMPLIANCE_MAX_FILE_MB, 8) * 1024 * 1024),
      kycValidityDays: num(env.COMPLIANCE_KYC_VALIDITY_DAYS, 0),
      velocity: {
        withdrawalsPerHour: num(env.COMPLIANCE_VELOCITY_WITHDRAWALS_PER_HOUR, 5),
        depositWithdrawMinutes: num(env.COMPLIANCE_VELOCITY_DEPOSIT_WITHDRAW_MINUTES, 30),
        roundTripUsd: num(env.COMPLIANCE_VELOCITY_ROUND_TRIP_USD, 100000),
        largeWithdrawalUsd: num(env.COMPLIANCE_LARGE_WITHDRAWAL_USD, 10000),
      },
      screening: { threshold: num(env.COMPLIANCE_SCREENING_THRESHOLD, 0.85) },
    };
  },

  init(ctx) {
    const { db, log, hooks, events, audit } = ctx;
    const cfg = () => ctx.config.compliance;
    if (process.env.NODE_ENV === 'production' && !cfg().fileKey) log.warn?.('[compliance] COMPLIANCE_FILE_KEY is not set: KYC documents are stored unencrypted');

    const kycDir = cfg().kycDir || (ctx.config.dbPath === ':memory:' ? FileStore.tempDir() : path.join(path.dirname(path.resolve(ctx.config.dbPath)), 'kyc'));
    const files = new FileStore({ dir: kycDir, key: cfg().fileKey, log });

    // ---------- helpers ----------
    const notify = (userId, msg) => { try { const p = ctx.notify?.notify?.(userId, msg); if (p?.catch) p.catch((e) => log.warn?.('[compliance] notify failed', e.message)); } catch (e) { log.warn?.('[compliance] notify failed', e.message); } };
    /** USD value of `units` of an asset. Strict mode throws 503 when no price is available; lenient returns 0. */
    const usdValue = (asset, units, { lenient = false } = {}) => {
      const amt = Number(units) / 1e8;
      if (STABLE.has(asset)) return amt;
      if (lenient) return amt * (ctx.oracle?.prices?.get(asset)?.price || 0);
      let price;
      try { price = ctx.oracle.price(asset); } catch (e) {
        if (e.status === 503) throw new HttpError(503, e.message, { code: 'PRICE_UNAVAILABLE' });
        throw new HttpError(503, `No USD price for ${asset} right now – please try again later`, { code: 'PRICE_UNAVAILABLE' });
      }
      return amt * price;
    };
    const tiersProvider = () => { let sv = null; try { sv = ctx.settings?.get?.('compliance.tiers', null); } catch {} return effectiveTiers(cfg().tiers, sv); };

    // ---------- geo & product restrictions ----------
    const geo = {
      /** { code, source: 'header'|'declared'|null } – header first, then the user's declared residence. */
      countryOf(req, userId) {
        const raw = req?.headers?.[cfg().countryHeader];
        const h = normalizeCountry(raw);
        if (h) return { code: h, source: 'header' };
        if (userId) {
          const c = db.prepare('SELECT country FROM compliance_profiles WHERE user_id=?').get(userId)?.country;
          if (c) return { code: c, source: 'declared' };
        }
        return { code: null, source: null, raw: raw ? String(raw).slice(0, 8) : undefined };
      },
      rule(code) {
        const c = normalizeCountry(code);
        if (!c) return { country: null, sanctioned: false, derivatives: 'allowed', source: 'default' };
        const row = db.prepare('SELECT * FROM compliance_country_rules WHERE country=?').get(c);
        const conf = cfg();
        const sanctioned = row ? !!row.sanctioned : conf.sanctionedCountries.includes(c);
        let derivatives;
        if (row && row.derivatives !== null) derivatives = row.derivatives ? 'allowed' : 'blocked';
        else derivatives = sanctioned || conf.derivativesRestricted.includes(c) ? 'blocked' : 'allowed';
        return { country: c, name: countryName(c), sanctioned, derivatives, source: row ? 'override' : 'default', note: row?.note || null, updated_at: row?.updated_at || null };
      },
      isSanctioned(code) { return geo.rule(code).sanctioned; },
      derivativesAllowed(code) { return geo.rule(code).derivatives === 'allowed'; },
      list() { return Object.keys(COUNTRIES).map((c) => geo.rule(c)); },
      set(adminId, code, { sanctioned, derivatives, note }, ip) {
        const c = normalizeCountry(code);
        if (!c) throw new HttpError(400, 'Unknown country code');
        const s = sanctioned === true || sanctioned === 1 || sanctioned === 'true' || sanctioned === '1' ? 1 : 0;
        let d = null;
        if (derivatives === 'allowed' || derivatives === true || derivatives === 1 || derivatives === '1') d = 1;
        else if (derivatives === 'blocked' || derivatives === false || derivatives === 0 || derivatives === '0') d = 0;
        else if (derivatives !== null && derivatives !== undefined && derivatives !== 'default' && derivatives !== '') throw new HttpError(400, 'derivatives must be allowed, blocked or default');
        db.prepare(`INSERT INTO compliance_country_rules (country, sanctioned, derivatives, note, updated_by) VALUES (?,?,?,?,?)
          ON CONFLICT(country) DO UPDATE SET sanctioned=excluded.sanctioned, derivatives=excluded.derivatives, note=excluded.note, updated_by=excluded.updated_by, updated_at=datetime('now')`).run(c, s, d, String(note || '').slice(0, 300) || null, adminId);
        audit(adminId, 'compliance.country.rule', { country: c, sanctioned: !!s, derivatives: d === null ? 'default' : d ? 'allowed' : 'blocked', note: note || undefined }, { ip });
        return geo.rule(c);
      },
      remove(adminId, code, ip) {
        const c = normalizeCountry(code);
        if (!c) throw new HttpError(400, 'Unknown country code');
        db.prepare('DELETE FROM compliance_country_rules WHERE country=?').run(c);
        audit(adminId, 'compliance.country.rule_removed', { country: c }, { ip });
        return geo.rule(c);
      },
    };

    // ---------- terms & risk disclosure versions ----------
    const terms = {
      current() { return { terms_version: String(cfg().termsVersion), risk_version: String(cfg().riskVersion) }; },
      status(userId) {
        const p = db.prepare('SELECT terms_version, risk_version, terms_accepted_at FROM compliance_profiles WHERE user_id=?').get(userId);
        const cur = terms.current();
        return { current: cur, accepted_terms_version: p?.terms_version || null, accepted_risk_version: p?.risk_version || null, accepted_at: p?.terms_accepted_at || null, accepted: !!p && p.terms_version === cur.terms_version && p.risk_version === cur.risk_version };
      },
      accept(userId, { terms_version, risk_version }, { ip = null, userAgent = null, implicit = false } = {}) {
        const cur = terms.current();
        if (String(terms_version) !== cur.terms_version || String(risk_version) !== cur.risk_version) throw new HttpError(409, 'Please review and accept the current terms and risk disclosure', { code: 'ACCEPT_TERMS', data: cur });
        db.prepare('INSERT OR IGNORE INTO compliance_profiles (user_id) VALUES (?)').run(userId);
        db.prepare("UPDATE compliance_profiles SET terms_version=?, risk_version=?, terms_accepted_at=datetime('now'), updated_at=datetime('now') WHERE user_id=?").run(cur.terms_version, cur.risk_version, userId);
        db.prepare('INSERT INTO compliance_terms_acceptances (user_id, terms_version, risk_version, implicit, ip, user_agent) VALUES (?,?,?,?,?,?)').run(userId, cur.terms_version, cur.risk_version, implicit ? 1 : 0, ip, userAgent ? String(userAgent).slice(0, 200) : null);
        return terms.status(userId);
      },
      require(userId) {
        const s = terms.status(userId);
        if (!s.accepted) throw new HttpError(403, 'Please accept the updated terms and risk disclosure to continue', { code: 'ACCEPT_TERMS', data: { ...s.current, accepted_terms_version: s.accepted_terms_version, accepted_risk_version: s.accepted_risk_version } });
      },
    };

    // ---------- travel rule ----------
    const travel = {
      required(usd) { const t = Number(cfg().travelRuleUsd); return t > 0 && usd >= t; },
      /** Validate the client-supplied originator/beneficiary declaration. */
      validate(input, usd) {
        const missing = (msg, errors) => new HttpError(400, msg, { code: 'TRAVEL_RULE_INFO_REQUIRED', data: { threshold_usd: cfg().travelRuleUsd, amount_usd: Math.round(usd * 100) / 100, fields: TR_FIELDS, errors } });
        if (!input || typeof input !== 'object') throw missing('Withdrawals of this size need beneficiary information (travel rule)', ['travel_rule']);
        const errors = [];
        const name = String(input.beneficiary_name || '').replace(/\s+/g, ' ').trim();
        if (name.length < 2 || name.length > 140 || /[<>{}\\]/.test(name)) errors.push('beneficiary_name');
        const btype = String(input.beneficiary_type || '');
        if (!['self', 'third_party'].includes(btype)) errors.push('beneficiary_type');
        const wtype = String(input.wallet_type || '');
        if (!['self_hosted', 'vasp'].includes(wtype)) errors.push('wallet_type');
        let vaspName = null, vaspCountry = null, confirmed = 0;
        if (wtype === 'vasp') {
          vaspName = String(input.vasp_name || '').replace(/\s+/g, ' ').trim().slice(0, 140);
          if (vaspName.length < 2) errors.push('vasp_name');
          if (input.vasp_country) { vaspCountry = normalizeCountry(input.vasp_country); if (!vaspCountry) errors.push('vasp_country'); }
        } else if (wtype === 'self_hosted') {
          confirmed = input.self_hosted_confirmed === true || input.self_hosted_confirmed === 'true' ? 1 : 0;
          if (!confirmed && btype === 'self') errors.push('self_hosted_confirmed');
        }
        if (errors.length) throw missing(`Please complete the beneficiary information: ${errors.join(', ')}`, errors);
        return { beneficiary_name: name, beneficiary_type: btype, wallet_type: wtype, vasp_name: vaspName, vasp_country: vaspCountry, self_hosted_confirmed: confirmed };
      },
      record(userId, { asset, chain, address, amount, amount_usd }, info, ip) {
        const p = kyc.profile(userId);
        const originator = { name: p.full_name || null, dob: p.dob || null, country: p.country || null, user_id: userId, kyc_tier: p.tier };
        const id = Number(db.prepare('INSERT INTO compliance_travel_rule (user_id, asset, chain, address, amount, amount_usd, beneficiary_name, beneficiary_type, wallet_type, vasp_name, vasp_country, self_hosted_confirmed, originator, ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(userId, asset, chain || null, address, amount, amount_usd, info.beneficiary_name, info.beneficiary_type, info.wallet_type, info.vasp_name, info.vasp_country, info.self_hosted_confirmed, JSON.stringify(originator), ip || null).lastInsertRowid);
        return id;
      },
      /** Link the newest unlinked declaration to the withdrawal row the core just created. */
      link({ userId, id, asset, address, amount }) {
        const rec = db.prepare("SELECT id FROM compliance_travel_rule WHERE withdrawal_id IS NULL AND user_id=? AND asset=? AND address=? AND amount=? AND created_at >= datetime('now','-10 minutes') ORDER BY id DESC LIMIT 1").get(userId, asset, address, amount);
        if (rec) db.prepare('UPDATE compliance_travel_rule SET withdrawal_id=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM compliance_travel_rule WHERE withdrawal_id=?)').run(id, rec.id, id);
      },
      /** Backends that emit no withdraw.requested event (OPEX): match unlinked declarations to withdrawals; drop stale orphans. */
      reconcile() {
        for (const r of db.prepare('SELECT * FROM compliance_travel_rule WHERE withdrawal_id IS NULL').all()) {
          const w = db.prepare("SELECT id FROM withdrawals WHERE user_id=? AND asset=? AND address=? AND amount=? AND created_at >= datetime(?, '-5 seconds') AND id NOT IN (SELECT withdrawal_id FROM compliance_travel_rule WHERE withdrawal_id IS NOT NULL) ORDER BY id LIMIT 1").get(r.user_id, r.asset, r.address, r.amount, r.created_at);
          if (w) db.prepare('UPDATE compliance_travel_rule SET withdrawal_id=? WHERE id=?').run(w.id, r.id);
        }
        return db.prepare("DELETE FROM compliance_travel_rule WHERE withdrawal_id IS NULL AND created_at < datetime('now','-1 day')").run().changes;
      },
      list({ page = 1, limit = 50, userId = null } = {}) {
        travel.reconcile();
        const w = userId ? 'WHERE t.user_id=?' : '';
        const args = userId ? [Number(userId)] : [];
        const total = db.prepare(`SELECT COUNT(*) n FROM compliance_travel_rule t ${w}`).get(...args).n;
        const items = db.prepare(`SELECT t.*, u.email, w.status withdrawal_status, w.txid FROM compliance_travel_rule t JOIN users u ON u.id=t.user_id LEFT JOIN withdrawals w ON w.id=t.withdrawal_id ${w} ORDER BY t.id DESC LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit)
          .map((r) => ({ ...r, originator: r.originator ? JSON.parse(r.originator) : null, amount: r.amount / 1e8 }));
        return { items, total, page, limit };
      },
    };

    // ---------- services ----------
    const monitor = new Monitor({ db, cfg, log, events, audit, usdValue, notify, isSanctioned: geo.isSanctioned });
    const kyc = new Kyc({
      db, cfg, log, audit, events, files, notify,
      isSanctioned: geo.isSanctioned,
      screen: (name, extra) => monitor.screen(name, extra),
      onSanctionsMatch: ({ userId, caseId, name, matches }) => monitor.flag(userId, 'sanctions_match', 'critical', `Possible sanctions list match for "${name}"`, { case_id: caseId, matches: matches.slice(0, 5) }, { dedupeMinutes: 0 }),
    });
    const limits = new Limits({ db, tiersProvider, usdValue, tierOf: (id) => kyc.tierOf(id) });

    const blockedCountry = (code) => new HttpError(403, `Our services are not available in ${countryName(code)}`, { code: 'COUNTRY_BLOCKED', data: { country: code } });
    /** Common restrictions for money-moving actions. */
    const guard = (userId, req, { terms: needTerms = true } = {}) => {
      if (monitor.isFrozen(userId)) throw new HttpError(403, 'Your account is temporarily restricted. Please contact support.', { code: 'ACCOUNT_FROZEN' });
      const c = geo.countryOf(req, userId);
      if (c.code && geo.isSanctioned(c.code)) throw blockedCountry(c.code);
      if (needTerms) terms.require(userId);
      return c;
    };

    const overview = (userId, req) => {
      const p = kyc.profile(userId);
      const c = geo.countryOf(req, userId);
      const summary = limits.summary(userId);
      const cases = kyc.cases(userId);
      const pending = cases.find((x) => x.status === 'submitted') || null;
      const nextTier = kyc.nextTier(userId);
      const latestForNext = nextTier ? cases.find((x) => x.tier === nextTier) || null : null;
      return {
        user_id: userId, tier: p.tier, label: summary.label, frozen: !!p.frozen,
        country: { code: c.code, name: c.code ? countryName(c.code) : null, source: c.source, declared: p.country || null },
        derivatives_allowed: c.code ? geo.derivativesAllowed(c.code) : true,
        terms: terms.status(userId),
        travel_rule_usd: cfg().travelRuleUsd,
        limits: summary.limits, usage: summary.usage, rows: summary.rows, tiers: summary.tiers,
        kyc: { next_tier: nextTier, pending_case: pending, current_case: latestForNext, cases },
      };
    };

    const adminUser = (userId) => {
      const u = db.prepare('SELECT id, email, is_admin, banned, frozen, kyc_tier, created_at FROM users WHERE id=?').get(Number(userId));
      if (!u) throw new HttpError(404, 'User not found');
      const p = kyc.profile(u.id);
      return {
        user: u, profile: { country: p.country, full_name: p.full_name, dob: p.dob, frozen_reason: p.frozen_reason, frozen_at: p.frozen_at, frozen_by: p.frozen_by },
        terms: terms.status(u.id), limits: limits.summary(u.id),
        cases: db.prepare('SELECT * FROM kyc_cases WHERE user_id=? ORDER BY id DESC').all(u.id).map((r) => kyc.present(r, { admin: true })),
        flags: monitor.listFlags({ status: 'all', userId: u.id, limit: 50 }).items,
        travel_rule: travel.list({ userId: u.id, limit: 20 }).items,
        withdrawals: db.prepare('SELECT id, asset, chain, address, amount, fee, status, txid, created_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 20').all(u.id).map((w) => ({ ...w, amount: w.amount / 1e8, fee: w.fee / 1e8 })),
        audit: db.prepare('SELECT a.*, x.email actor_email FROM audit_log a LEFT JOIN users x ON x.id=a.actor_id WHERE a.target_id=? OR a.actor_id=? ORDER BY a.id DESC LIMIT 50').all(u.id, u.id).map((a) => ({ ...a, details: a.details ? JSON.parse(a.details) : null })),
      };
    };

    /** Paginated, filterable view of the core audit_log. */
    const auditLog = ({ action = '', actor = null, target = null, user = null, from = '', to = '', q = '', page = 1, limit = 50 } = {}) => {
      const where = [], args = [];
      if (action) { where.push('a.action LIKE ?'); args.push(`${String(action).slice(0, 80)}%`); }
      if (actor) { where.push('a.actor_id=?'); args.push(Number(actor)); }
      if (target) { where.push('a.target_id=?'); args.push(Number(target)); }
      if (user) { where.push('(a.actor_id=? OR a.target_id=?)'); args.push(Number(user), Number(user)); }
      if (from) { if (!/^\d{4}-\d{2}-\d{2}/.test(from)) throw new HttpError(400, 'from must be YYYY-MM-DD'); where.push('a.created_at >= ?'); args.push(String(from).slice(0, 19).replace('T', ' ')); }
      if (to) { if (!/^\d{4}-\d{2}-\d{2}/.test(to)) throw new HttpError(400, 'to must be YYYY-MM-DD'); where.push('a.created_at <= ?'); args.push(String(to).length <= 10 ? `${to} 23:59:59` : String(to).slice(0, 19).replace('T', ' ')); }
      if (q) { where.push('(a.details LIKE ? OR a.ip LIKE ? OR u1.email LIKE ? OR u2.email LIKE ?)'); const like = `%${String(q).slice(0, 80)}%`; args.push(like, like, like, like); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const base = `FROM audit_log a LEFT JOIN users u1 ON u1.id=a.actor_id LEFT JOIN users u2 ON u2.id=a.target_id ${w}`;
      const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...args).n;
      const items = db.prepare(`SELECT a.id, a.actor_id, a.target_id, a.action, a.details, a.ip, a.created_at, u1.email actor_email, u2.email target_email ${base} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit)
        .map((a) => { let d = null; try { d = a.details ? JSON.parse(a.details) : null; } catch { d = a.details; } return { ...a, details: d }; });
      return { items, total, page, limit };
    };
    const auditActions = () => db.prepare('SELECT action, COUNT(*) n FROM audit_log GROUP BY action ORDER BY action').all();

    // ---------- hooks (enforcement) ----------
    if (cfg().enabled) {
      hooks.on('auth.register.before', ({ req }) => {
        const c = geo.countryOf(req);
        if (c.code && geo.isSanctioned(c.code)) throw blockedCountry(c.code);
      });
      hooks.on('auth.login.after', ({ user, req, extra }) => {
        const c = geo.countryOf(req, user.id);
        extra.compliance = { tier: kyc.tierOf(user.id), frozen: monitor.isFrozen(user.id), terms_accepted: terms.status(user.id).accepted, country: c.code };
        monitor.onLogin({ user, country: c.code });
      });
      hooks.on('withdraw.before', async (p) => {
        guard(p.userId, p.req);
        const usd = usdValue(p.asset, p.amount);
        limits.check(p.userId, 'withdraw', usd);
        if (travel.required(usd)) {
          const info = travel.validate(p.req?.body?.travel_rule, usd);
          travel.record(p.userId, { asset: p.asset, chain: p.chain, address: p.address, amount: p.amount, amount_usd: usd }, info, p.req?.ip);
        }
      });
      hooks.on('trade.before', async (p) => {
        const c = guard(p.userId, p.req);
        const body = p.body || {};
        if (p.product === 'perps' || p.product === 'options') {
          if (c.code && !geo.derivativesAllowed(c.code)) throw new HttpError(403, `Leveraged crypto derivatives are not available to residents of ${countryName(c.code)}`, { code: 'PRODUCT_RESTRICTED', data: { country: c.code, product: p.product } });
        }
        if (p.product === 'perps') {
          // Only check well-formed requests; the engine rejects bad leverage/margin with its own message.
          const lev = Math.floor(Number(body.leverage)), maxLev = ctx.config.perps?.maxLeverage || 100;
          const notional = Number(body.margin) * lev;
          if (lev >= 1 && lev <= maxLev && Number.isFinite(notional) && notional > 0) limits.check(p.userId, 'perps', notional);
        } else if (p.product === 'options') {
          let premium = 0;
          try { premium = ctx.options.quote(String(body.symbol || '').toUpperCase(), body.kind, Number(body.strike), body.expiry).ask * Number(body.qty); } catch { premium = 0; }
          if (Number.isFinite(premium) && premium > 0) limits.check(p.userId, 'options', premium);
        } else if (p.product === 'cards') {
          let size = 0;
          const qty = Number(body.qty);
          if (body.type === 'market') { try { const t = ctx.book.ticker(p.market); size = Number(t.last ?? (body.side === 'buy' ? t.ask : t.bid) ?? 0) * qty; } catch { size = 0; } }
          else size = Number(body.price) * qty;
          if (Number.isFinite(size) && size > 0) limits.check(p.userId, 'cards', size);
        }
      });
      hooks.on('cloud.checkout.before', async (p) => {
        guard(p.userId, p.req, { terms: false });
        limits.check(p.userId, 'cloud', Number(p.amountCents) / 100);
      });
    } else log.warn?.('[compliance] COMPLIANCE_ENABLED=false: limits, geo-blocking and travel rule are NOT enforced');

    // ---------- events (monitoring, never block) ----------
    events.on('user.registered', ({ user, ip }) => {
      try { terms.accept(user.id, terms.current(), { ip, implicit: true }); } catch (e) { log.error?.('[compliance] implicit terms acceptance failed', e.message); }
    });
    events.on('withdraw.requested', (e) => { travel.link(e); monitor.onWithdrawRequested(e); });
    events.on('deposit.credited', ({ userId }) => { if (userId) monitor.lastDeposit.set(userId, Date.now()); });
    events.on('order.filled', (e) => monitor.onOrderFilled(e));

    return {
      enabled: cfg().enabled,
      tierOf: (userId) => kyc.tierOf(userId),
      limits: (userId) => limits.summary(userId),
      /** Throws HttpError when a restriction or limit applies (frozen, sanctioned declared country, terms, caps). */
      async check(userId, action, amountUsd = 0, { req = null, restrictions = true } = {}) {
        if (restrictions) guard(userId, req, { terms: action !== 'cloud' });
        return limits.check(userId, action, amountUsd);
      },
      isFrozen: (userId) => monitor.isFrozen(userId),
      countryOf: (req, userId) => geo.countryOf(req, userId),
      usdValue,
      geo, terms, travel, kyc, monitor, limitsEngine: limits, files,
      overview, adminUser, auditLog, auditActions,
      _guard: guard,
    };
  },

  routes(app, ctx) { require('./routes')(app, ctx, ctx.compliance); },

  jobs(ctx) {
    const svc = ctx.compliance;
    if (!svc) return () => {};
    const run = () => { try { svc.kyc.expireDue(); svc.travel.reconcile(); } catch (e) { ctx.log.error?.('[compliance jobs]', e.message); } };
    const t = setInterval(run, 60 * 60 * 1000); t.unref?.();
    return () => clearInterval(t);
  },

  site(ctx) {
    const c = ctx.config.compliance;
    const svc = ctx.compliance;
    const tiers = svc ? svc.limitsEngine.tiers() : normalizeTiers(c.tiers);
    return { compliance: { enabled: c.enabled, terms_version: String(c.termsVersion), risk_version: String(c.riskVersion), travel_rule_usd: c.travelRuleUsd, max_file_mb: Math.round(c.maxFileBytes / 1048576), tiers: Object.entries(tiers).map(([t, v]) => ({ tier: Number(t), ...v })) } };
  },
};
