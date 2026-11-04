'use strict';
/**
 * KYC cases: tier 1 (identity details), tier 2 (ID document + selfie), tier 3
 * (proof of address + source-of-funds questionnaire). Users work on a draft,
 * attach documents, submit; admins approve / reject / expire / set tiers.
 *
 * References:
 *  - FATF Recommendation 10 (customer due diligence) and the 2021 VASP guidance:
 *    https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html
 *  - EU AMLD5 (Directive (EU) 2018/843) – CDD for crypto exchanges and custodian wallet providers:
 *    https://eur-lex.europa.eu/eli/dir/2018/843/oj
 *  - EU MiCA (Reg. (EU) 2023/1114) – CASP authorisation and conduct: https://eur-lex.europa.eu/eli/reg/2023/1114/oj
 *  - FATF PEP guidance (politically exposed persons, R.12): https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Peps-r12-r22.html
 *  - ISO 8601 dates (YYYY-MM-DD) for DOB / expiry fields.
 */
const { HttpError } = require('../../provisioner');
const { atomic } = require('../../atomic');
const { toSql } = require('../../db');
const { normalizeCountry } = require('./countries');

const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'expired'];
const MAX_TIER = 3;

const ID_TYPES = ['passport', 'id_card', 'drivers_license', 'residence_permit'];
const SOURCES = ['salary', 'business_income', 'investments', 'savings', 'inheritance', 'crypto_trading', 'loan', 'other'];
const VOLUMES = ['lt_10k', '10k_50k', '50k_250k', 'gt_250k'];

/** Field schemas per tier. Drafts are validated for shape only; submit enforces `required`. */
const SCHEMAS = {
  1: {
    full_name: { type: 'string', min: 2, max: 120, required: true, re: /^[^\d<>{}\\]+$/ },
    dob: { type: 'date', required: true, minAge: 18, maxAge: 120 },
    nationality: { type: 'country' },
    country: { type: 'country', required: true },
    address_line1: { type: 'string', min: 3, max: 200, required: true },
    address_line2: { type: 'string', max: 200 },
    city: { type: 'string', min: 1, max: 100, required: true },
    postal_code: { type: 'string', min: 1, max: 20, required: true },
    region: { type: 'string', max: 100 },
    phone: { type: 'string', max: 24, re: /^\+?[0-9 ()-]{5,24}$/ },
  },
  2: {
    id_type: { type: 'enum', values: ID_TYPES, required: true },
    id_number: { type: 'string', min: 3, max: 40, required: true, re: /^[A-Za-z0-9-]+$/ },
    id_country: { type: 'country', required: true },
    id_expiry: { type: 'date', required: true, future: true },
  },
  3: {
    occupation: { type: 'string', min: 2, max: 100, required: true },
    employer: { type: 'string', max: 120 },
    source_of_funds: { type: 'enum', values: SOURCES, required: true },
    source_details: { type: 'string', max: 1000, requiredIf: (f) => f.source_of_funds === 'other' },
    expected_monthly_volume: { type: 'enum', values: VOLUMES, required: true },
    pep: { type: 'bool', required: true },
    pep_details: { type: 'string', max: 500, requiredIf: (f) => f.pep === true },
  },
};
/** Document kinds per tier; `required` may be a function of the fields. */
const DOCS = {
  1: {},
  2: { id_front: { required: true, label: 'ID document (front)' }, id_back: { required: (f) => f.id_type !== 'passport', label: 'ID document (back)' }, selfie: { required: true, label: 'Selfie holding the document' } },
  3: { proof_of_address: { required: true, label: 'Proof of address (≤ 3 months old)' }, source_of_funds_doc: { required: false, label: 'Source of funds evidence (optional)' } },
};

const label = (k) => k.replace(/_/g, ' ');
const parseDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s)); if (!m) return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null; };
const yearsAgo = (d) => (Date.now() - d.getTime()) / (365.25 * 24 * 3600e3);

/** Whitelist + validate fields for a tier. strict=true enforces required fields (submit). */
function sanitizeFields(tier, input, strict) {
  const schema = SCHEMAS[tier];
  if (!schema) throw new HttpError(400, 'Unknown tier');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'fields must be an object');
  const out = {};
  for (const [k, def] of Object.entries(schema)) {
    let v = input[k];
    if (v === undefined || v === null || v === '') continue;
    switch (def.type) {
      case 'string':
        v = String(v).replace(/\s+/g, ' ').trim();
        if (v.length > def.max) throw new HttpError(400, `${label(k)} is too long (max ${def.max} characters)`, { code: 'VALIDATION', data: { field: k } });
        if (strict && def.min && v.length < def.min) throw new HttpError(400, `${label(k)} is too short`, { code: 'VALIDATION', data: { field: k } });
        if (v && def.re && !def.re.test(v)) throw new HttpError(400, `${label(k)} contains invalid characters`, { code: 'VALIDATION', data: { field: k } });
        if (v) out[k] = v;
        break;
      case 'date': {
        const d = parseDate(v);
        if (!d) throw new HttpError(400, `${label(k)} must be a date (YYYY-MM-DD)`, { code: 'VALIDATION', data: { field: k } });
        if (def.minAge && yearsAgo(d) < def.minAge) throw new HttpError(400, `You must be at least ${def.minAge} years old`, { code: 'VALIDATION', data: { field: k } });
        if (def.maxAge && yearsAgo(d) > def.maxAge) throw new HttpError(400, `${label(k)} is not plausible`, { code: 'VALIDATION', data: { field: k } });
        if (def.future && d.getTime() <= Date.now()) throw new HttpError(400, `${label(k)} must be in the future (expired documents are not accepted)`, { code: 'VALIDATION', data: { field: k } });
        out[k] = v;
        break;
      }
      case 'country': {
        const c = normalizeCountry(v);
        if (!c) throw new HttpError(400, `${label(k)} must be an ISO 3166-1 alpha-2 country code`, { code: 'VALIDATION', data: { field: k } });
        out[k] = c;
        break;
      }
      case 'enum':
        if (!def.values.includes(v)) throw new HttpError(400, `${label(k)} must be one of ${def.values.join(', ')}`, { code: 'VALIDATION', data: { field: k } });
        out[k] = v;
        break;
      case 'bool':
        if (typeof v === 'string') v = v === 'true' ? true : v === 'false' ? false : v;
        if (typeof v !== 'boolean') throw new HttpError(400, `${label(k)} must be true or false`, { code: 'VALIDATION', data: { field: k } });
        out[k] = v;
        break;
      default: break;
    }
  }
  if (strict) {
    for (const [k, def] of Object.entries(schema)) {
      if (out[k] === undefined && (def.required || (def.requiredIf && def.requiredIf(out)))) throw new HttpError(400, `${label(k)} is required`, { code: 'VALIDATION', data: { field: k } });
    }
  }
  return out;
}

class Kyc {
  /**
   * @param {object} deps { db, config (compliance section getter), log, audit, events, files, notify(userId, msg), screen(name, extra) -> matches, isSanctioned(code) }
   */
  constructor({ db, cfg, log, audit, events, files, notify, screen, isSanctioned, onSanctionsMatch }) {
    this.db = db; this.cfg = cfg; this.log = log; this.audit = audit; this.events = events; this.files = files;
    this.notify = notify || (() => {}); this.screen = screen || (() => []); this.isSanctioned = isSanctioned || (() => false);
    this.onSanctionsMatch = onSanctionsMatch || (() => {});
  }

  // ---------- profile / tier ----------
  tierOf(userId) {
    const r = this.db.prepare('SELECT kyc_tier FROM users WHERE id=?').get(userId);
    return r ? Number(r.kyc_tier) || 0 : 0;
  }
  profile(userId) {
    this.db.prepare('INSERT OR IGNORE INTO compliance_profiles (user_id) VALUES (?)').run(userId);
    return this.db.prepare('SELECT p.*, u.kyc_tier tier, u.frozen, u.email FROM compliance_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=?').get(userId);
  }
  /** Tier the user can apply for next (null when fully verified or a review is pending). */
  nextTier(userId) {
    const t = this.tierOf(userId);
    return t >= MAX_TIER ? null : t + 1;
  }

  // ---------- presentation ----------
  _docs(caseId) {
    return this.db.prepare('SELECT id, case_id, kind, mime, size, sha256, original_name, created_at FROM kyc_documents WHERE case_id=? ORDER BY id').all(caseId);
  }
  present(row, { admin = false } = {}) {
    if (!row) return null;
    const fields = row.fields ? JSON.parse(row.fields) : {};
    const out = {
      id: row.id, user_id: row.user_id, tier: row.tier, status: row.status, fields,
      reason: row.reason, created_at: row.created_at, updated_at: row.updated_at, submitted_at: row.submitted_at, decided_at: row.decided_at, expires_at: row.expires_at,
      documents: this._docs(row.id), required_documents: this.requiredDocs(row.tier, fields),
    };
    if (admin) { out.reviewer_id = row.reviewer_id; out.screening = row.screening ? JSON.parse(row.screening) : null; out.email = row.email; }
    return out;
  }
  requiredDocs(tier, fields = {}) {
    return Object.entries(DOCS[tier] || {}).map(([kind, d]) => ({ kind, label: d.label, required: typeof d.required === 'function' ? d.required(fields) : !!d.required }));
  }
  schema() {
    return { tiers: Object.fromEntries(Object.keys(SCHEMAS).map((t) => [t, { fields: Object.fromEntries(Object.entries(SCHEMAS[t]).map(([k, d]) => [k, { type: d.type, required: !!d.required, values: d.values, max: d.max }])), documents: Object.fromEntries(Object.entries(DOCS[t]).map(([k, d]) => [k, { label: d.label, required: typeof d.required === 'function' ? 'conditional' : !!d.required }])) }])), id_types: ID_TYPES, sources_of_funds: SOURCES, volumes: VOLUMES };
  }

  // ---------- user actions ----------
  cases(userId) {
    return this.db.prepare('SELECT * FROM kyc_cases WHERE user_id=? ORDER BY id DESC LIMIT 50').all(userId).map((r) => this.present(r));
  }
  _own(userId, caseId) {
    const c = this.db.prepare('SELECT * FROM kyc_cases WHERE id=? AND user_id=?').get(Number(caseId), userId);
    if (!c) throw new HttpError(404, 'Verification case not found');
    return c;
  }
  getCase(userId, caseId) { return this.present(this._own(userId, caseId)); }

  /** Create (or return the existing) draft for the requested tier. */
  openDraft(userId, tier) {
    tier = Number(tier);
    if (!Number.isInteger(tier) || tier < 1 || tier > MAX_TIER) throw new HttpError(400, `tier must be 1-${MAX_TIER}`);
    const current = this.tierOf(userId);
    if (tier <= current) throw new HttpError(400, `You are already verified at level ${current}`, { code: 'ALREADY_VERIFIED' });
    if (tier !== current + 1) throw new HttpError(400, `Complete level ${current + 1} first`, { code: 'TIER_ORDER' });
    const pending = this.db.prepare("SELECT id, tier FROM kyc_cases WHERE user_id=? AND status='submitted'").get(userId);
    if (pending) throw new HttpError(409, 'Your previous submission is still under review', { code: 'KYC_PENDING', data: { case_id: pending.id, tier: pending.tier } });
    const draft = this.db.prepare("SELECT * FROM kyc_cases WHERE user_id=? AND tier=? AND status='draft' ORDER BY id DESC LIMIT 1").get(userId, tier);
    if (draft) return this.present(draft);
    const id = Number(this.db.prepare("INSERT INTO kyc_cases (user_id, tier, status, fields) VALUES (?,?,'draft','{}')").run(userId, tier).lastInsertRowid);
    return this.present(this.db.prepare('SELECT * FROM kyc_cases WHERE id=?').get(id));
  }

  saveFields(userId, caseId, input) {
    const c = this._own(userId, caseId);
    if (c.status !== 'draft') throw new HttpError(409, 'This case has already been submitted', { code: 'NOT_DRAFT' });
    const fields = { ...JSON.parse(c.fields || '{}'), ...sanitizeFields(c.tier, input, false) };
    // Allow clearing a field by sending null.
    for (const [k, v] of Object.entries(input || {})) if (v === null && k in fields) delete fields[k];
    this.db.prepare("UPDATE kyc_cases SET fields=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(fields), c.id);
    return this.present(this.db.prepare('SELECT * FROM kyc_cases WHERE id=?').get(c.id));
  }

  addDocument(userId, caseId, kind, buf, originalName) {
    const c = this._own(userId, caseId);
    if (c.status !== 'draft') throw new HttpError(409, 'This case has already been submitted', { code: 'NOT_DRAFT' });
    if (!DOCS[c.tier] || !DOCS[c.tier][kind]) throw new HttpError(400, `Unknown document kind for level ${c.tier}: ${String(kind).slice(0, 40)}`, { code: 'VALIDATION', data: { field: 'kind' } });
    if (!Buffer.isBuffer(buf) || buf.length < 64) throw new HttpError(400, 'The file is empty', { code: 'VALIDATION', data: { field: 'file' } });
    const max = this.cfg().maxFileBytes;
    if (buf.length > max) throw new HttpError(413, `File is too large (max ${Math.round(max / 1048576)} MB)`, { code: 'FILE_TOO_LARGE' });
    const saved = this.files.save(userId, buf);
    return atomic(this.db, () => {
      const old = this.db.prepare('SELECT * FROM kyc_documents WHERE case_id=? AND kind=?').all(c.id, kind);
      for (const o of old) { this.db.prepare('DELETE FROM kyc_documents WHERE id=?').run(o.id); this.files.remove(o.path); }
      const id = Number(this.db.prepare('INSERT INTO kyc_documents (case_id, user_id, kind, path, mime, size, sha256, original_name) VALUES (?,?,?,?,?,?,?,?)')
        .run(c.id, userId, kind, saved.path, saved.mime, saved.size, saved.sha256, originalName ? String(originalName).slice(0, 120) : null).lastInsertRowid);
      this.db.prepare("UPDATE kyc_cases SET updated_at=datetime('now') WHERE id=?").run(c.id);
      return this.db.prepare('SELECT id, case_id, kind, mime, size, original_name, created_at FROM kyc_documents WHERE id=?').get(id);
    });
  }

  removeDocument(userId, caseId, docId) {
    const c = this._own(userId, caseId);
    if (c.status !== 'draft') throw new HttpError(409, 'This case has already been submitted', { code: 'NOT_DRAFT' });
    const d = this.db.prepare('SELECT * FROM kyc_documents WHERE id=? AND case_id=?').get(Number(docId), c.id);
    if (!d) throw new HttpError(404, 'Document not found');
    this.db.prepare('DELETE FROM kyc_documents WHERE id=?').run(d.id);
    this.files.remove(d.path);
    return { ok: true };
  }

  submit(userId, caseId, { ip } = {}) {
    const c = this._own(userId, caseId);
    if (c.status !== 'draft') throw new HttpError(409, 'This case has already been submitted', { code: 'NOT_DRAFT' });
    if (this.tierOf(userId) !== c.tier - 1) throw new HttpError(409, 'Your verification level changed – start again', { code: 'TIER_ORDER' });
    if (this.db.prepare("SELECT 1 FROM kyc_cases WHERE user_id=? AND status='submitted'").get(userId)) throw new HttpError(409, 'Your previous submission is still under review', { code: 'KYC_PENDING' });
    const fields = sanitizeFields(c.tier, JSON.parse(c.fields || '{}'), true);
    const have = new Set(this._docs(c.id).map((d) => d.kind));
    for (const d of this.requiredDocs(c.tier, fields)) if (d.required && !have.has(d.kind)) throw new HttpError(400, `Please upload: ${d.label}`, { code: 'VALIDATION', data: { field: d.kind } });
    if (fields.country && this.isSanctioned(fields.country)) throw new HttpError(403, 'We cannot offer services to residents of this country', { code: 'COUNTRY_BLOCKED', data: { country: fields.country } });

    // Sanctions screening on the declared name (tier 1) or the profile name for later tiers.
    const profile = this.profile(userId);
    const name = fields.full_name || profile.full_name;
    let screening = null;
    if (name) {
      const matches = this.screen(name, { dob: fields.dob || profile.dob, country: fields.country || profile.country });
      screening = { checked_at: new Date().toISOString(), name, matches };
    }
    atomic(this.db, () => {
      this.db.prepare("UPDATE kyc_cases SET status='submitted', fields=?, screening=?, submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(JSON.stringify(fields), screening ? JSON.stringify(screening) : null, c.id);
      if (c.tier === 1) this.db.prepare("UPDATE compliance_profiles SET country=?, updated_at=datetime('now') WHERE user_id=?").run(fields.country, userId);
    });
    const out = this.present(this.db.prepare('SELECT * FROM kyc_cases WHERE id=?').get(c.id));
    this.audit(userId, 'compliance.kyc.submitted', { case_id: c.id, tier: c.tier, screening_matches: screening?.matches?.length || 0 }, { targetId: userId, ip });
    this.events.emit('compliance.kyc_submitted', { case: out, userId, tier: c.tier });
    if (screening?.matches?.length) this.onSanctionsMatch({ userId, caseId: c.id, name, matches: screening.matches });
    return out;
  }

  // ---------- admin ----------
  queue({ status = 'submitted', page = 1, limit = 50, q = '' } = {}) {
    const where = [], args = [];
    if (status && status !== 'all') { if (!STATUSES.includes(status)) throw new HttpError(400, 'Bad status'); where.push('c.status=?'); args.push(status); }
    if (q) { where.push('(u.email LIKE ? OR CAST(c.user_id AS TEXT)=? OR CAST(c.id AS TEXT)=?)'); args.push(`%${q}%`, q, q); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = status === 'submitted' ? 'c.submitted_at ASC, c.id ASC' : 'c.id DESC';
    const total = this.db.prepare(`SELECT COUNT(*) n FROM kyc_cases c JOIN users u ON u.id=c.user_id ${w}`).get(...args).n;
    const rows = this.db.prepare(`SELECT c.*, u.email FROM kyc_cases c JOIN users u ON u.id=c.user_id ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit);
    const counts = Object.fromEntries(this.db.prepare('SELECT status, COUNT(*) n FROM kyc_cases GROUP BY status').all().map((r) => [r.status, r.n]));
    return { items: rows.map((r) => ({ ...this.present(r, { admin: true }), fields: undefined, documents: undefined, document_count: this._docs(r.id).length, screening_matches: r.screening ? (JSON.parse(r.screening).matches || []).length : 0 })), total, page, limit, counts };
  }
  adminCase(id) {
    const r = this.db.prepare('SELECT c.*, u.email FROM kyc_cases c JOIN users u ON u.id=c.user_id WHERE c.id=?').get(Number(id));
    if (!r) throw new HttpError(404, 'Case not found');
    return this.present(r, { admin: true });
  }
  document(docId) {
    const d = this.db.prepare('SELECT * FROM kyc_documents WHERE id=?').get(Number(docId));
    if (!d) throw new HttpError(404, 'Document not found');
    return { ...d, data: this.files.read(d.path) };
  }

  _recomputeTier(userId) {
    const best = this.db.prepare("SELECT COALESCE(MAX(tier),0) t FROM kyc_cases WHERE user_id=? AND status='approved'").get(userId).t;
    this.db.prepare('UPDATE users SET kyc_tier=? WHERE id=?').run(best, userId);
    return best;
  }

  decide(adminId, caseId, decision, { reason = '', ip = null } = {}) {
    const c = this.db.prepare('SELECT * FROM kyc_cases WHERE id=?').get(Number(caseId));
    if (!c) throw new HttpError(404, 'Case not found');
    reason = String(reason || '').trim().slice(0, 500);
    const before = this.tierOf(c.user_id);
    let after = before;
    if (decision === 'approve') {
      if (c.status !== 'submitted') throw new HttpError(409, `Only submitted cases can be approved (this one is ${c.status})`);
      const days = Number(this.cfg().kycValidityDays) || 0;
      const expiresAt = days > 0 ? toSql(new Date(Date.now() + days * 86400e3)) : null;
      atomic(this.db, () => {
        this.db.prepare("UPDATE kyc_cases SET status='approved', reviewer_id=?, reason=?, decided_at=datetime('now'), updated_at=datetime('now'), expires_at=? WHERE id=?").run(adminId, reason || null, expiresAt, c.id);
        after = Math.max(before, c.tier);
        this.db.prepare('UPDATE users SET kyc_tier=? WHERE id=?').run(after, c.user_id);
        const f = JSON.parse(c.fields || '{}');
        if (c.tier === 1) this.db.prepare("UPDATE compliance_profiles SET full_name=?, dob=?, country=?, updated_at=datetime('now') WHERE user_id=?").run(f.full_name, f.dob, f.country, c.user_id);
      });
    } else if (decision === 'reject') {
      if (c.status !== 'submitted') throw new HttpError(409, `Only submitted cases can be rejected (this one is ${c.status})`);
      if (reason.length < 3) throw new HttpError(400, 'Give the user a reason (at least 3 characters)', { code: 'VALIDATION', data: { field: 'reason' } });
      this.db.prepare("UPDATE kyc_cases SET status='rejected', reviewer_id=?, reason=?, decided_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(adminId, reason, c.id);
    } else if (decision === 'expire') {
      if (c.status !== 'approved') throw new HttpError(409, 'Only approved cases can be expired');
      atomic(this.db, () => {
        this.db.prepare("UPDATE kyc_cases SET status='expired', reviewer_id=?, reason=?, updated_at=datetime('now') WHERE id=?").run(adminId, reason || null, c.id);
        after = Math.min(before, this._recomputeTier(c.user_id));
        this.db.prepare('UPDATE users SET kyc_tier=? WHERE id=?').run(after, c.user_id);
      });
    } else throw new HttpError(400, 'decision must be approve, reject or expire');

    const out = this.adminCase(c.id);
    const action = { approve: 'approved', reject: 'rejected', expire: 'expired' }[decision];
    this.audit(adminId, `compliance.kyc.${action}`, { case_id: c.id, tier: c.tier, reason: reason || undefined, tier_before: before, tier_after: after }, { targetId: c.user_id, ip });
    this.events.emit('compliance.kyc_decided', { case: out, userId: c.user_id, decision: action, tier: c.tier, reviewerId: adminId, tier_before: before, tier_after: after });
    if (after !== before) this.events.emit('compliance.tier_changed', { userId: c.user_id, from: before, to: after, actorId: adminId });
    const titles = { approved: `Identity verification level ${c.tier} approved`, rejected: `Identity verification level ${c.tier} needs attention`, expired: `Identity verification level ${c.tier} has expired` };
    this.notify(c.user_id, { type: 'compliance.kyc', title: titles[action], body: action === 'rejected' ? `Reason: ${reason}. You can submit again.` : action === 'approved' ? 'Your limits have been raised.' : 'Please verify again to keep your limits.', link: '#/verify-identity', data: { case_id: c.id, decision: action } });
    return out;
  }

  setTier(adminId, userId, tier, { reason = '', ip = null } = {}) {
    tier = Number(tier);
    if (!Number.isInteger(tier) || tier < 0 || tier > MAX_TIER) throw new HttpError(400, `tier must be 0-${MAX_TIER}`);
    const u = this.db.prepare('SELECT id, kyc_tier FROM users WHERE id=?').get(Number(userId));
    if (!u) throw new HttpError(404, 'User not found');
    this.db.prepare('UPDATE users SET kyc_tier=? WHERE id=?').run(tier, u.id);
    this.profile(u.id);
    this.audit(adminId, 'compliance.tier.set', { from: u.kyc_tier, to: tier, reason: String(reason || '').slice(0, 500) || undefined }, { targetId: u.id, ip });
    if (tier !== u.kyc_tier) this.events.emit('compliance.tier_changed', { userId: u.id, from: u.kyc_tier, to: tier, actorId: adminId });
    return { user_id: u.id, tier };
  }

  /** Background: expire approved cases whose validity ended. Returns how many were expired. */
  expireDue() {
    const due = this.db.prepare("SELECT * FROM kyc_cases WHERE status='approved' AND expires_at IS NOT NULL AND expires_at <= datetime('now')").all();
    for (const c of due) {
      try { this.decide(null, c.id, 'expire', { reason: 'validity period ended' }); } catch (e) { this.log.error?.('[compliance] expire failed', c.id, e.message); }
    }
    return due.length;
  }
}

module.exports = { Kyc, sanitizeFields, SCHEMAS, DOCS, STATUSES, MAX_TIER, ID_TYPES, SOURCES, VOLUMES };
