'use strict';
/**
 * Transaction monitoring (velocity rules -> compliance_flags), account freezing and
 * sanctions name screening against an admin-managed list (OFAC SDN / EU consolidated
 * list importable from their CSV files).
 *
 * References:
 *  - FATF Rec. 20/21 and VASP guidance on suspicious transaction monitoring:
 *    https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html
 *  - FinCEN SAR red flags for convertible virtual currency (FIN-2019-A003):
 *    https://www.fincen.gov/resources/advisories/fincen-advisory-fin-2019-a003
 *  - OFAC SDN list downloads and data specification (SDN.CSV: ent_num, SDN_Name, SDN_Type, Program,
 *    Title, Call_Sign, Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks; ALT.CSV: ent_num,
 *    alt_num, alt_type, alt_name, alt_remarks; "-0-" = empty): https://sanctionslist.ofac.treas.gov/Home/SdnList
 *    and https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists
 *  - EU consolidated financial sanctions list (CSV/XML): https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions
 *  - UK OFSI consolidated list: https://www.gov.uk/government/publications/the-uk-sanctions-list
 *  - Jaro–Winkler similarity (Winkler 1990) for fuzzy name matching: https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance
 */
const { HttpError } = require('../../provisioner');
const { atomic } = require('../../atomic');

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const FLAG_STATUSES = ['open', 'dismissed', 'escalated', 'frozen'];

// ---------- name normalisation & similarity ----------
function normalizeName(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function jaro(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - win); j < Math.min(lb, i + win + 1); j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
  t /= 2;
  return (m / la + m / lb + (m - t) / m) / 3;
}
function jaroWinkler(a, b, p = 0.1) {
  const j = jaro(a, b);
  let l = 0; while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
  return j + l * p * (1 - j);
}
/** Similarity in [0,1]: best of Jaro–Winkler on the full string and token-set overlap (handles reordered names). */
function nameScore(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  const sortedJw = jaroWinkler([...ta].sort().join(' '), [...tb].sort().join(' '));
  return Math.max(jaroWinkler(na, nb), sortedJw, jaccard);
}

/** Parse a CSV line (RFC 4180 quoting). */
function csvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}
const nul = (v) => (v === '-0-' || v === undefined ? '' : v);

/**
 * Parse OFAC SDN.CSV (+ optional ALT.CSV for aliases) into list entries.
 * Only individuals and entities are imported (vessels/aircraft are skipped).
 */
function parseOfacSdn(sdnCsv, altCsv = '') {
  const entries = new Map();
  for (const line of String(sdnCsv || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = csvLine(line);
    if (c.length < 4 || !/^\d+$/.test(c[0])) continue;
    const type = nul(c[2]).toLowerCase();
    if (type && type !== 'individual' && type !== 'entity' && type !== '') continue;
    const remarks = nul(c[11]);
    const dob = /DOB (\d{2} \w{3} \d{4})/.exec(remarks)?.[1] || null;
    const nat = /nationality ([A-Za-z ]+?)[;.]/.exec(remarks)?.[1]?.trim() || null;
    entries.set(c[0], { ref_id: c[0], name: nul(c[1]), type: type || 'individual', program: nul(c[3]), aliases: [], dob, country: nat, source: 'ofac_sdn', note: remarks.slice(0, 500) || null });
  }
  for (const line of String(altCsv || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = csvLine(line);
    const e = entries.get(c[0]);
    if (e && nul(c[3])) e.aliases.push(nul(c[3]));
  }
  return [...entries.values()].filter((e) => e.name);
}

class Monitor {
  /**
   * @param {object} deps { db, cfg: () => compliance config, log, events, audit, usdValue(asset, units), notify(userId, msg), isSanctioned(code) }
   */
  constructor({ db, cfg, log, events, audit, usdValue, notify, isSanctioned }) {
    this.db = db; this.cfg = cfg; this.log = log; this.events = events; this.audit = audit; this.usdValue = usdValue;
    this.notify = notify || (() => {}); this.isSanctioned = isSanctioned || (() => false);
    this.lastDeposit = new Map(); // userId -> ms, fed by deposit.credited
  }

  // ---------- flags ----------
  /** Create a flag unless an open one with the same rule exists for the user within the dedupe window. */
  flag(userId, rule, severity, title, details = {}, { dedupeMinutes = 60 } = {}) {
    if (!SEVERITIES.includes(severity)) severity = 'medium';
    if (dedupeMinutes > 0) {
      const dup = this.db.prepare("SELECT id FROM compliance_flags WHERE user_id=? AND rule=? AND status='open' AND created_at >= datetime('now', ?)").get(userId, rule, `-${dedupeMinutes} minutes`);
      if (dup) { this.db.prepare("UPDATE compliance_flags SET hits=hits+1, details=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(details), dup.id); return this.getFlag(dup.id); }
    }
    const id = Number(this.db.prepare('INSERT INTO compliance_flags (user_id, rule, severity, title, details) VALUES (?,?,?,?,?)').run(userId, rule, severity, title, JSON.stringify(details)).lastInsertRowid);
    const f = this.getFlag(id);
    this.log.warn?.(`[compliance] flag ${severity} ${rule} user ${userId}: ${title}`);
    this.events.emit('compliance.flag', { flag: f, userId, rule, severity });
    return f;
  }
  getFlag(id) {
    const r = this.db.prepare('SELECT f.*, u.email FROM compliance_flags f JOIN users u ON u.id=f.user_id WHERE f.id=?').get(Number(id));
    return r ? { ...r, details: r.details ? JSON.parse(r.details) : {} } : null;
  }
  listFlags({ status = 'open', severity = '', userId = null, page = 1, limit = 50 } = {}) {
    const where = [], args = [];
    if (status && status !== 'all') { if (!FLAG_STATUSES.includes(status)) throw new HttpError(400, 'Bad status'); where.push('f.status=?'); args.push(status); }
    if (severity) { if (!SEVERITIES.includes(severity)) throw new HttpError(400, 'Bad severity'); where.push('f.severity=?'); args.push(severity); }
    if (userId) { where.push('f.user_id=?'); args.push(Number(userId)); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) n FROM compliance_flags f ${w}`).get(...args).n;
    const items = this.db.prepare(`SELECT f.*, u.email FROM compliance_flags f JOIN users u ON u.id=f.user_id ${w} ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, f.id DESC LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit)
      .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : {} }));
    const counts = Object.fromEntries(this.db.prepare('SELECT status, COUNT(*) n FROM compliance_flags GROUP BY status').all().map((r) => [r.status, r.n]));
    return { items, total, page, limit, counts };
  }
  resolveFlag(adminId, id, action, { note = '', ip = null } = {}) {
    const f = this.getFlag(id);
    if (!f) throw new HttpError(404, 'Flag not found');
    if (!['dismiss', 'escalate', 'freeze'].includes(action)) throw new HttpError(400, 'action must be dismiss, escalate or freeze');
    if (f.status !== 'open' && f.status !== 'escalated') throw new HttpError(409, `Flag is already ${f.status}`);
    note = String(note || '').trim().slice(0, 1000);
    const status = { dismiss: 'dismissed', escalate: 'escalated', freeze: 'frozen' }[action];
    this.db.prepare("UPDATE compliance_flags SET status=?, reviewer_id=?, note=?, resolved_at=CASE WHEN ?='escalated' THEN NULL ELSE datetime('now') END, updated_at=datetime('now') WHERE id=?").run(status, adminId, note || null, status, f.id);
    this.audit(adminId, `compliance.flag.${status}`, { flag_id: f.id, rule: f.rule, severity: f.severity, note: note || undefined }, { targetId: f.user_id, ip });
    if (action === 'freeze') this.freeze(adminId, f.user_id, note || `flag #${f.id} (${f.rule})`, { ip, flagId: f.id });
    return this.getFlag(f.id);
  }

  // ---------- freezing ----------
  isFrozen(userId) { return !!this.db.prepare('SELECT frozen FROM users WHERE id=?').get(userId)?.frozen; }
  freeze(adminId, userId, reason, { ip = null, flagId = null } = {}) {
    const u = this.db.prepare('SELECT id, frozen FROM users WHERE id=?').get(Number(userId));
    if (!u) throw new HttpError(404, 'User not found');
    reason = String(reason || '').trim().slice(0, 500);
    if (reason.length < 3) throw new HttpError(400, 'Give a reason for freezing the account', { code: 'VALIDATION', data: { field: 'reason' } });
    this.db.prepare('INSERT OR IGNORE INTO compliance_profiles (user_id) VALUES (?)').run(u.id);
    this.db.prepare('UPDATE users SET frozen=1 WHERE id=?').run(u.id);
    this.db.prepare("UPDATE compliance_profiles SET frozen_reason=?, frozen_at=datetime('now'), frozen_by=?, updated_at=datetime('now') WHERE user_id=?").run(reason, adminId, u.id);
    this.audit(adminId, 'compliance.account.frozen', { reason, flag_id: flagId || undefined }, { targetId: u.id, ip });
    this.events.emit('compliance.account_frozen', { userId: u.id, frozen: true, reason, actorId: adminId, flagId });
    this.notify(u.id, { type: 'compliance.frozen', title: 'Your account has been temporarily restricted', body: 'Withdrawals and trading are paused while our compliance team reviews your account. Please contact support.', link: '#/account' });
    return { user_id: u.id, frozen: true };
  }
  unfreeze(adminId, userId, { note = '', ip = null } = {}) {
    const u = this.db.prepare('SELECT id, frozen FROM users WHERE id=?').get(Number(userId));
    if (!u) throw new HttpError(404, 'User not found');
    this.db.prepare('UPDATE users SET frozen=0 WHERE id=?').run(u.id);
    this.db.prepare("UPDATE compliance_profiles SET frozen_reason=NULL, frozen_at=NULL, frozen_by=NULL, updated_at=datetime('now') WHERE user_id=?").run(u.id);
    this.audit(adminId, 'compliance.account.unfrozen', { note: String(note || '').slice(0, 500) || undefined }, { targetId: u.id, ip });
    this.events.emit('compliance.account_frozen', { userId: u.id, frozen: false, actorId: adminId });
    this.notify(u.id, { type: 'compliance.frozen', title: 'Your account restrictions have been lifted', body: 'Withdrawals and trading are available again.', link: '#/account' });
    return { user_id: u.id, frozen: false };
  }

  // ---------- velocity rules (event handlers; never throw) ----------
  onWithdrawRequested({ userId, id, asset, amount }) {
    const v = this.cfg().velocity;
    const n = this.db.prepare("SELECT COUNT(*) n FROM withdrawals WHERE user_id=? AND created_at >= datetime('now','-1 hour')").get(userId).n;
    if (v.withdrawalsPerHour > 0 && n >= v.withdrawalsPerHour) this.flag(userId, 'velocity.withdrawals', 'medium', `${n} withdrawals in the last hour`, { count: n, window: '1h', withdrawal_id: id, threshold: v.withdrawalsPerHour });
    // Deposit-then-withdraw: ledger entries (local wallet) or the deposit.credited event (any backend).
    const dep = this.db.prepare("SELECT created_at, asset, delta FROM wallet_entries WHERE owner=? AND kind='deposit' AND delta>0 AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1").get(`u:${userId}`, `-${v.depositWithdrawMinutes} minutes`);
    const recent = this.lastDeposit?.get(userId);
    const viaEvent = recent && Date.now() - recent <= v.depositWithdrawMinutes * 60e3;
    if (v.depositWithdrawMinutes > 0 && (dep || viaEvent)) this.flag(userId, 'pass_through', 'high', `Deposit followed by a withdrawal within ${v.depositWithdrawMinutes} minutes`, { deposit_at: dep?.created_at || new Date(recent).toISOString(), deposit_asset: dep?.asset, withdrawal_id: id, asset, threshold_minutes: v.depositWithdrawMinutes });
    const usd = this.usdValue(asset, amount, { lenient: true });
    if (v.largeWithdrawalUsd > 0 && usd >= v.largeWithdrawalUsd) this.flag(userId, 'large_withdrawal', 'low', `Withdrawal of ≈ $${Math.round(usd).toLocaleString('en-US')}`, { withdrawal_id: id, asset, amount_usd: Math.round(usd), threshold_usd: v.largeWithdrawalUsd }, { dedupeMinutes: 0 });
  }

  onOrderFilled({ userId, market }) {
    const v = this.cfg().velocity;
    if (!userId || !market || market.kind !== 'spot') return;
    // Round-trip / wash-style volume: large and nearly balanced buys and sells within 24h.
    const r = this.db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN f.buyer=? THEN CAST(f.price AS REAL)*f.qty/m.base_scale/1e8 END),0) bought,
        COALESCE(SUM(CASE WHEN f.seller=? THEN CAST(f.price AS REAL)*f.qty/m.base_scale/1e8 END),0) sold
      FROM book_fills f JOIN markets m ON m.id=f.market WHERE m.kind='spot' AND (f.buyer=? OR f.seller=?) AND f.created_at >= datetime('now','-1 day')`).get(userId, userId, userId, userId);
    const total = r.bought + r.sold;
    if (v.roundTripUsd > 0 && total >= v.roundTripUsd && Math.abs(r.bought - r.sold) <= 0.2 * total) {
      this.flag(userId, 'round_trip_volume', 'medium', `≈ $${Math.round(total).toLocaleString('en-US')} of balanced buy/sell volume in 24h`, { bought_usd: Math.round(r.bought), sold_usd: Math.round(r.sold), threshold_usd: v.roundTripUsd }, { dedupeMinutes: 24 * 60 });
    }
    // Counterparty concentration: most of the volume against one other account.
    const cp = this.db.prepare(`SELECT CASE WHEN f.buyer=? THEN f.seller ELSE f.buyer END other, SUM(CAST(f.price AS REAL)*f.qty/m.base_scale/1e8) vol
      FROM book_fills f JOIN markets m ON m.id=f.market WHERE m.kind='spot' AND (f.buyer=? OR f.seller=?) AND f.created_at >= datetime('now','-1 day') GROUP BY other ORDER BY vol DESC LIMIT 1`).get(userId, userId, userId);
    if (cp && cp.other !== 0 && v.roundTripUsd > 0 && total >= v.roundTripUsd / 2 && cp.vol >= 0.8 * total) {
      this.flag(userId, 'counterparty_concentration', 'medium', `≥ 80% of 24h volume traded against user #${cp.other}`, { counterparty: cp.other, volume_usd: Math.round(cp.vol), total_usd: Math.round(total) }, { dedupeMinutes: 24 * 60 });
    }
  }

  onLogin({ user, country }) {
    if (country && this.isSanctioned(country)) this.flag(user.id, 'sanctioned_country_login', 'critical', `Login from sanctioned country ${country}`, { country }, { dedupeMinutes: 24 * 60 });
  }

  // ---------- sanctions list ----------
  addSanction(adminId, { name, aliases = [], source = 'manual', program = '', ref_id = '', country = '', dob = '', note = '', type = 'individual' }, { ip = null, audit = true } = {}) {
    name = String(name || '').trim().slice(0, 200);
    if (name.length < 2) throw new HttpError(400, 'name is required', { code: 'VALIDATION', data: { field: 'name' } });
    if (!Array.isArray(aliases)) aliases = String(aliases || '').split(/[;\n]/);
    aliases = aliases.map((a) => String(a).trim().slice(0, 200)).filter(Boolean).slice(0, 50);
    const id = Number(this.db.prepare('INSERT INTO compliance_sanctions (name, normalized, aliases, type, source, program, ref_id, country, dob, note, added_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(name, normalizeName(name), JSON.stringify(aliases.map((a) => ({ name: a, normalized: normalizeName(a) }))), String(type || 'individual').slice(0, 20), String(source || 'manual').slice(0, 40), String(program || '').slice(0, 120) || null, String(ref_id || '').slice(0, 60) || null, String(country || '').slice(0, 60) || null, String(dob || '').slice(0, 40) || null, String(note || '').slice(0, 500) || null, adminId ?? null).lastInsertRowid);
    if (audit) this.audit(adminId ?? null, 'compliance.sanctions.added', { id, name, source }, { ip });
    return this.getSanction(id);
  }
  getSanction(id) {
    const r = this.db.prepare('SELECT * FROM compliance_sanctions WHERE id=?').get(Number(id));
    return r ? { ...r, aliases: JSON.parse(r.aliases || '[]').map((a) => a.name) } : null;
  }
  listSanctions({ q = '', page = 1, limit = 100 } = {}) {
    const like = `%${normalizeName(q)}%`;
    const w = q ? 'WHERE normalized LIKE ? OR aliases LIKE ? OR ref_id = ?' : '';
    const args = q ? [like, like, q] : [];
    const total = this.db.prepare(`SELECT COUNT(*) n FROM compliance_sanctions ${w}`).get(...args).n;
    const items = this.db.prepare(`SELECT * FROM compliance_sanctions ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit).map((r) => ({ ...r, aliases: JSON.parse(r.aliases || '[]').map((a) => a.name) }));
    const sources = this.db.prepare('SELECT source, COUNT(*) n FROM compliance_sanctions GROUP BY source').all();
    return { items, total, page, limit, sources };
  }
  removeSanction(adminId, id, { ip = null } = {}) {
    const r = this.db.prepare('DELETE FROM compliance_sanctions WHERE id=?').run(Number(id));
    if (!r.changes) throw new HttpError(404, 'Entry not found');
    this.audit(adminId, 'compliance.sanctions.removed', { id: Number(id) }, { ip });
    return { ok: true };
  }
  /** Import entries: format 'ofac_sdn' (sdn csv + optional alt csv), 'lines' (one name per line) or 'json' ([{name, aliases...}]). Replaces previous entries of the same source when replace=true. */
  importSanctions(adminId, { format, text, alt = '', source, replace = false }, { ip = null } = {}) {
    let entries;
    if (format === 'ofac_sdn') entries = parseOfacSdn(text, alt).map((e) => ({ ...e, source: source || 'ofac_sdn' }));
    else if (format === 'lines') entries = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((name) => ({ name, source: source || 'manual' }));
    else if (format === 'json') {
      try { entries = JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON'); }
      if (!Array.isArray(entries)) throw new HttpError(400, 'JSON must be an array of entries');
      entries = entries.map((e) => ({ ...e, source: source || e.source || 'import' }));
    } else throw new HttpError(400, 'format must be ofac_sdn, lines or json');
    if (entries.length > 50000) throw new HttpError(413, 'Too many entries in one import (max 50,000)');
    const src = source || entries[0]?.source || 'import';
    let removed = 0;
    atomic(this.db, () => {
      if (replace) removed = this.db.prepare('DELETE FROM compliance_sanctions WHERE source=?').run(src).changes;
      for (const e of entries) this.addSanction(null, { ...e, source: e.source || src }, { audit: false });
    });
    this.audit(adminId, 'compliance.sanctions.imported', { format, source: src, count: entries.length, removed, replace }, { ip });
    return { imported: entries.length, removed, source: src };
  }
  /** Fuzzy screen a name; returns matches at or above the configured threshold, best first. */
  screen(name, { dob = null, threshold = null, limit = 10 } = {}) {
    const th = threshold ?? this.cfg().screening.threshold;
    const norm = normalizeName(name);
    if (!norm) return [];
    const out = [];
    // Pre-filter: share at least one token (or a 3+ char prefix) with the candidate to keep it fast on large lists.
    const tokens = norm.split(' ').filter((t) => t.length >= 3);
    const rows = tokens.length
      ? this.db.prepare(`SELECT * FROM compliance_sanctions WHERE ${tokens.map(() => '(normalized LIKE ? OR aliases LIKE ?)').join(' OR ')}`).all(...tokens.flatMap((t) => [`%${t.slice(0, 4)}%`, `%${t.slice(0, 4)}%`]))
      : this.db.prepare('SELECT * FROM compliance_sanctions LIMIT 5000').all();
    for (const r of rows) {
      const aliases = JSON.parse(r.aliases || '[]');
      let best = nameScore(norm, r.normalized), via = r.name;
      for (const a of aliases) { const s = nameScore(norm, a.normalized); if (s > best) { best = s; via = a.name; } }
      if (dob && r.dob) { const d = String(r.dob); if (d.includes(String(dob).slice(0, 4))) best = Math.min(1, best + 0.05); }
      if (best >= th) out.push({ id: r.id, name: r.name, matched: via, score: Math.round(best * 1000) / 1000, source: r.source, program: r.program, ref_id: r.ref_id, type: r.type, country: r.country, dob: r.dob });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

module.exports = { Monitor, normalizeName, nameScore, jaroWinkler, parseOfacSdn, csvLine, SEVERITIES, FLAG_STATUSES };
