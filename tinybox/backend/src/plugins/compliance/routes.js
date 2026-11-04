'use strict';
/**
 * REST API of the compliance plugin, mounted at /api/compliance.
 * User endpoints need a JWT; everything under /admin needs an admin JWT.
 *
 * References:
 *  - express-rate-limit (per-user keyGenerator): https://github.com/express-rate-limit/express-rate-limit
 *  - Express 5 routing / async error handling: https://expressjs.com/en/guide/migrating-5.html
 *  - RFC 6266 Content-Disposition for the inline document viewer: https://www.rfc-editor.org/rfc/rfc6266
 *  - RFC 7578 multipart/form-data uploads: https://www.rfc-editor.org/rfc/rfc7578
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { HttpError } = require('../../provisioner');
const { parseMultipart } = require('./multipart');
const { COUNTRIES } = require('./countries');

module.exports = function complianceRoutes(app, ctx, svc) {
  const { auth, log } = ctx;
  const r = express.Router();
  const perUser = (limit, windowMs = 60 * 60 * 1000) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?.id || req.ip) });
  const int = (v, name = 'id') => { const n = Number(v); if (!Number.isInteger(n) || n <= 0 || n > 2 ** 31) throw new HttpError(400, `Invalid ${name}`); return n; };
  const paging = (q) => ({ page: Math.min(100000, Math.max(1, Math.floor(Number(q.page)) || 1)), limit: Math.min(200, Math.max(1, Math.floor(Number(q.limit)) || 50)) });
  const str = (v, max = 500) => (v === undefined || v === null ? '' : String(v).slice(0, max));
  const multipart = express.raw({ type: 'multipart/form-data', limit: ctx.config.compliance.maxFileBytes + 64 * 1024 });

  // ---------- public reference data ----------
  r.get('/countries', (req, res) => res.json({ countries: Object.entries(COUNTRIES).map(([code, name]) => ({ code, name })) }));
  r.get('/terms', (req, res) => {
    const h = req.headers.authorization || '';
    const user = h.startsWith('Bearer ') ? auth.verifyToken(h.slice(7)) : null;
    res.json(user ? svc.terms.status(user.id) : { current: svc.terms.current(), accepted: null });
  });
  r.get('/kyc/schema', (req, res) => res.json(svc.kyc.schema()));

  // ---------- user ----------
  const u = express.Router();
  u.use(auth.requireAuth);
  u.get('/me', (req, res) => res.json(svc.overview(req.user.id, req)));
  u.get('/limits', (req, res) => res.json(svc.limits(req.user.id)));
  u.post('/terms/accept', perUser(30), (req, res) => {
    const out = svc.terms.accept(req.user.id, { terms_version: str(req.body.terms_version, 40), risk_version: str(req.body.risk_version, 40) }, { ip: req.ip, userAgent: req.headers['user-agent'] });
    ctx.audit(req.user.id, 'compliance.terms.accepted', { terms_version: out.current.terms_version, risk_version: out.current.risk_version }, { targetId: req.user.id, ip: req.ip });
    res.json(out);
  });
  /** Does a withdrawal of `amount` of `asset` need travel-rule information? */
  u.get('/travel-rule', (req, res) => {
    const a = ctx.wallet.asset(str(req.query.asset, 10));
    const amount = Number(req.query.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'Invalid amount');
    const usd = svc.usdValue(a.symbol, Math.round(amount * 1e8), { lenient: true });
    res.json({ required: svc.travel.required(usd), threshold_usd: ctx.config.compliance.travelRuleUsd, amount_usd: Math.round(usd * 100) / 100, fields: ['beneficiary_name', 'beneficiary_type', 'wallet_type', 'vasp_name', 'vasp_country', 'self_hosted_confirmed'] });
  });

  // KYC cases
  u.get('/kyc/cases', (req, res) => res.json({ cases: svc.kyc.cases(req.user.id), next_tier: svc.kyc.nextTier(req.user.id), tier: svc.tierOf(req.user.id) }));
  u.post('/kyc/cases', perUser(30), (req, res) => res.status(201).json({ case: svc.kyc.openDraft(req.user.id, req.body.tier) }));
  u.get('/kyc/cases/:id', (req, res) => res.json({ case: svc.kyc.getCase(req.user.id, int(req.params.id)) }));
  u.put('/kyc/cases/:id', perUser(120), (req, res) => res.json({ case: svc.kyc.saveFields(req.user.id, int(req.params.id), req.body.fields ?? req.body) }));
  u.post('/kyc/cases/:id/documents', perUser(40), multipart, (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the document as multipart/form-data with fields "kind" and "file"', { code: 'BAD_MULTIPART' });
    const { fields, files } = parseMultipart(req.body, req.headers['content-type']);
    const f = files.find((x) => x.field === 'file') || files[0];
    if (!f) throw new HttpError(400, 'No file in the upload', { code: 'VALIDATION', data: { field: 'file' } });
    const kind = str(fields.kind || f.field, 40);
    const doc = svc.kyc.addDocument(req.user.id, int(req.params.id), kind, f.data, f.filename);
    res.status(201).json({ document: doc });
  });
  u.delete('/kyc/cases/:id/documents/:docId', perUser(60), (req, res) => res.json(svc.kyc.removeDocument(req.user.id, int(req.params.id), int(req.params.docId, 'document id'))));
  u.post('/kyc/cases/:id/submit', perUser(20), (req, res) => res.json({ case: svc.kyc.submit(req.user.id, int(req.params.id), { ip: req.ip }) }));

  // ---------- admin ----------
  const a = express.Router();
  a.use(auth.requireAdmin);
  a.get('/overview', (req, res) => {
    const { db } = ctx;
    res.json({
      kyc: Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM kyc_cases GROUP BY status').all().map((x) => [x.status, x.n])),
      flags: Object.fromEntries(db.prepare("SELECT severity, COUNT(*) n FROM compliance_flags WHERE status IN ('open','escalated') GROUP BY severity").all().map((x) => [x.severity, x.n])),
      frozen_users: db.prepare('SELECT COUNT(*) n FROM users WHERE frozen=1').get().n,
      tiers: Object.fromEntries(db.prepare('SELECT kyc_tier t, COUNT(*) n FROM users GROUP BY kyc_tier').all().map((x) => [x.t, x.n])),
      sanctions_entries: db.prepare('SELECT COUNT(*) n FROM compliance_sanctions').get().n,
      country_overrides: db.prepare('SELECT COUNT(*) n FROM compliance_country_rules').get().n,
      travel_rule_records: db.prepare('SELECT COUNT(*) n FROM compliance_travel_rule').get().n,
      terms: svc.terms.current(),
      config: { travel_rule_usd: ctx.config.compliance.travelRuleUsd, country_header: ctx.config.compliance.countryHeader, documents_encrypted: svc.files.encrypted, kyc_validity_days: ctx.config.compliance.kycValidityDays },
    });
  });

  // KYC queue
  a.get('/kyc/queue', (req, res) => res.json(svc.kyc.queue({ status: str(req.query.status || 'submitted', 20), q: str(req.query.q, 80), ...paging(req.query) })));
  a.get('/kyc/cases/:id', (req, res) => {
    const c = svc.kyc.adminCase(int(req.params.id));
    ctx.audit(req.user.id, 'compliance.kyc.viewed', { case_id: c.id }, { targetId: c.user_id, ip: req.ip });
    res.json({ case: c });
  });
  a.get('/kyc/documents/:id', perUser(600), (req, res) => {
    const d = svc.kyc.document(int(req.params.id, 'document id'));
    ctx.audit(req.user.id, 'compliance.kyc.document_viewed', { document_id: d.id, case_id: d.case_id, kind: d.kind }, { targetId: d.user_id, ip: req.ip });
    res.set({
      'content-type': d.mime, 'content-length': String(d.data.length), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename="kyc-${d.case_id}-${d.kind}.${d.mime === 'application/pdf' ? 'pdf' : d.mime === 'image/png' ? 'png' : 'jpg'}"`,
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    res.end(d.data);
  });
  for (const decision of ['approve', 'reject', 'expire']) {
    a.post(`/kyc/cases/:id/${decision}`, (req, res) => res.json({ case: svc.kyc.decide(req.user.id, int(req.params.id), decision, { reason: str(req.body.reason ?? req.body.note, 500), ip: req.ip }) }));
  }

  // users
  a.get('/users/:id', (req, res) => res.json(svc.adminUser(int(req.params.id, 'user id'))));
  a.post('/users/:id/tier', (req, res) => res.json(svc.kyc.setTier(req.user.id, int(req.params.id, 'user id'), req.body.tier, { reason: str(req.body.reason, 500), ip: req.ip })));
  a.post('/users/:id/freeze', (req, res) => res.json(svc.monitor.freeze(req.user.id, int(req.params.id, 'user id'), str(req.body.reason, 500), { ip: req.ip })));
  a.post('/users/:id/unfreeze', (req, res) => res.json(svc.monitor.unfreeze(req.user.id, int(req.params.id, 'user id'), { note: str(req.body.note, 500), ip: req.ip })));

  // flags
  a.get('/flags', (req, res) => res.json(svc.monitor.listFlags({ status: str(req.query.status || 'open', 20), severity: str(req.query.severity, 20), userId: req.query.user ? int(req.query.user, 'user id') : null, ...paging(req.query) })));
  for (const action of ['dismiss', 'escalate', 'freeze']) {
    a.post(`/flags/:id/${action}`, (req, res) => res.json({ flag: svc.monitor.resolveFlag(req.user.id, int(req.params.id), action, { note: str(req.body.note ?? req.body.reason, 1000), ip: req.ip }) }));
  }

  // country rules
  a.get('/countries', (req, res) => res.json({ countries: svc.geo.list(), defaults: { sanctioned: ctx.config.compliance.sanctionedCountries, derivatives_restricted: ctx.config.compliance.derivativesRestricted }, header: ctx.config.compliance.countryHeader }));
  a.put('/countries/:code', (req, res) => res.json({ rule: svc.geo.set(req.user.id, req.params.code, { sanctioned: req.body.sanctioned, derivatives: req.body.derivatives, note: str(req.body.note, 300) }, req.ip) }));
  a.delete('/countries/:code', (req, res) => res.json({ rule: svc.geo.remove(req.user.id, req.params.code, req.ip) }));

  // sanctions list
  a.get('/sanctions', (req, res) => res.json(svc.monitor.listSanctions({ q: str(req.query.q, 80), ...paging(req.query) })));
  a.post('/sanctions', (req, res) => res.status(201).json({ entry: svc.monitor.addSanction(req.user.id, req.body || {}, { ip: req.ip }) }));
  a.delete('/sanctions/:id', (req, res) => res.json(svc.monitor.removeSanction(req.user.id, int(req.params.id), { ip: req.ip })));
  a.post('/sanctions/screen', (req, res) => res.json({ name: str(req.body.name, 200), matches: svc.monitor.screen(str(req.body.name, 200), { dob: str(req.body.dob, 20) || null, threshold: req.body.threshold !== undefined ? Number(req.body.threshold) : null }) }));
  /** Import: JSON body { format, text, alt?, source?, replace? } for small lists, or multipart with files "sdn" (+ "alt") and fields format/source/replace for the real OFAC files. */
  a.post('/sanctions/import', express.raw({ type: 'multipart/form-data', limit: '64mb' }), (req, res) => {
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      const { fields, files } = parseMultipart(body, req.headers['content-type']);
      const sdn = files.find((f) => f.field === 'sdn' || f.field === 'file');
      const alt = files.find((f) => f.field === 'alt');
      body = { format: fields.format || 'ofac_sdn', source: fields.source, replace: fields.replace === 'true', text: sdn ? sdn.data.toString('utf8') : fields.text, alt: alt ? alt.data.toString('utf8') : '' };
    }
    res.json(svc.monitor.importSanctions(req.user.id, { format: str(body.format, 20), text: body.text, alt: body.alt, source: str(body.source, 40) || undefined, replace: body.replace === true || body.replace === 'true' }, { ip: req.ip }));
  });

  // travel rule records
  a.get('/travel-rule', (req, res) => res.json(svc.travel.list({ userId: req.query.user ? int(req.query.user, 'user id') : null, ...paging(req.query) })));

  // audit log viewer
  a.get('/audit', (req, res) => res.json(svc.auditLog({ action: str(req.query.action, 80), actor: req.query.actor ? int(req.query.actor, 'actor') : null, target: req.query.target ? int(req.query.target, 'target') : null, user: req.query.user ? int(req.query.user, 'user') : null, from: str(req.query.from, 19), to: str(req.query.to, 19), q: str(req.query.q, 80), ...paging(req.query) })));
  a.get('/audit/actions', (req, res) => res.json({ actions: svc.auditActions() }));

  r.use('/admin', a);
  r.use(u);
  app.use('/api/compliance', r);
  log.info?.('[compliance] routes mounted at /api/compliance');
};
