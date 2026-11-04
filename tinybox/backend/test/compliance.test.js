'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { effectiveTiers, DEFAULT_TIERS } = require('../src/plugins/compliance/limits');
const { parseMultipart } = require('../src/plugins/compliance/multipart');
const { detectType } = require('../src/plugins/compliance/files');
const { nameScore, parseOfacSdn, normalizeName } = require('../src/plugins/compliance/monitoring');
const { sanitizeFields } = require('../src/plugins/compliance/kyc');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 3)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 4)]);
const ADDR = 'TXYZabcdefghijklmnopqrstuv';

/** Like helpers.call but with extra headers (country header, multipart bodies). */
const mkCall = (base) => async (method, path, body, token, headers = {}) => {
  const isForm = body instanceof FormData;
  const res = await fetch(base + path, { method, headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
};
const upload = (buf, name, type = 'application/octet-stream', kind = 'id_front') => { const fd = new FormData(); fd.append('kind', kind); fd.append('file', new Blob([buf], { type }), name); return fd; };

async function user(call, email, extra = {}) {
  const r = await call('POST', '/api/auth/register', { email, password: 'password1' }, null, extra.headers);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (extra.faucet !== false) await call('POST', '/api/wallet/faucet', {}, r.body.token);
  return { token: r.body.token, id: r.body.user.id };
}
const admin = async (call) => (await call('POST', '/api/auth/register', { email: 'admin@x.io', password: 'password1' })).body.token;
const T1 = { full_name: 'Alice Example', dob: '1990-05-04', country: 'DE', address_line1: 'Musterstr. 1', city: 'Berlin', postal_code: '10115' };

async function approveTier1(call, u, adm, fields = T1) {
  const c = (await call('POST', '/api/compliance/kyc/cases', { tier: 1 }, u.token)).body.case;
  assert.equal((await call('PUT', `/api/compliance/kyc/cases/${c.id}`, { fields }, u.token)).status, 200);
  const s = await call('POST', `/api/compliance/kyc/cases/${c.id}/submit`, {}, u.token);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const a = await call('POST', `/api/compliance/admin/kyc/cases/${c.id}/approve`, {}, adm);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return c.id;
}

// ---------------------------------------------------------------------------
test('pure helpers: tiers merge, multipart, magic bytes, name matching, OFAC csv, field validation', () => {
  const t = effectiveTiers(DEFAULT_TIERS, { 1: { withdraw_daily_usd: 123, label: 'Custom', bogus: 1 }, 2: { perps_notional_usd: null } });
  assert.equal(t[1].withdraw_daily_usd, 123); assert.equal(t[1].label, 'Custom'); assert.equal(t[1].bogus, undefined);
  assert.equal(t[2].perps_notional_usd, null, 'null = unlimited'); assert.equal(t[0].withdraw_daily_usd, DEFAULT_TIERS[0].withdraw_daily_usd);
  assert.equal(effectiveTiers(DEFAULT_TIERS, 'not json')[3].label, 'Enhanced');
  assert.equal(effectiveTiers(DEFAULT_TIERS, { 1: { withdraw_daily_usd: -5 } })[1].withdraw_daily_usd, DEFAULT_TIERS[1].withdraw_daily_usd, 'negative ignored');

  const b = 'xYz';
  const body = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nselfie\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="../../a b.png"\r\nContent-Type: image/png\r\n\r\nBINARY\r\nDATA\r\n--${b}--\r\n`);
  const p = parseMultipart(body, `multipart/form-data; boundary=${b}`);
  assert.equal(p.fields.kind, 'selfie'); assert.equal(p.files.length, 1); assert.equal(p.files[0].filename, 'a b.png', 'path stripped');
  assert.equal(p.files[0].data.toString(), 'BINARY\r\nDATA'); assert.equal(p.files[0].contentType, 'image/png');
  assert.throws(() => parseMultipart(Buffer.from('nope'), 'multipart/form-data; boundary=q'), /boundary/);
  assert.throws(() => parseMultipart(body, 'application/json'), /boundary/);

  assert.equal(detectType(PNG).mime, 'image/png'); assert.equal(detectType(JPG).ext, 'jpg'); assert.equal(detectType(PDF).mime, 'application/pdf'); assert.equal(detectType(EXE), null);

  assert.equal(nameScore('Jane Doe', 'DOE, Jane'), 1); assert.ok(nameScore('Jon Smith', 'John Smith') > 0.9); assert.ok(nameScore('Alice Example', 'Vladimir Petrov') < 0.6);
  assert.equal(normalizeName('  Émilie   Du-Pont '), 'emilie du pont');
  const sdn = parseOfacSdn('36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- \n7157,"ABU MARZOOK, Mousa Mohammed",individual,"SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 09 Feb 1951; POB Rafah, Gaza; nationality Egypt; Passport 92/664 (Egypt)."\n', '7157,1,aka,"ABU MARZUK, Musa",-0- \n');
  assert.equal(sdn.length, 2); const abu = sdn.find((e) => e.ref_id === '7157');
  assert.equal(abu.dob, '09 Feb 1951'); assert.equal(abu.program, 'SDGT'); assert.deepEqual(abu.aliases, ['ABU MARZUK, Musa']); assert.equal(abu.country, 'Egypt');

  assert.throws(() => sanitizeFields(1, { dob: '2020-01-01' }, false), /18 years/);
  assert.throws(() => sanitizeFields(1, { dob: '1990-02-30' }, false), /YYYY-MM-DD/);
  assert.throws(() => sanitizeFields(1, { country: 'Germany' }, false), /ISO 3166/);
  assert.throws(() => sanitizeFields(1, {}, true), /full name is required/);
  assert.throws(() => sanitizeFields(3, { occupation: 'Dev', source_of_funds: 'other', expected_monthly_volume: 'lt_10k', pep: false }, true), /source details is required/);
  assert.deepEqual(sanitizeFields(3, { occupation: '  Dev ', source_of_funds: 'salary', expected_monthly_volume: 'lt_10k', pep: 'false', employer: '' }, true), { occupation: 'Dev', source_of_funds: 'salary', expected_monthly_volume: 'lt_10k', pep: false });
  assert.throws(() => sanitizeFields(2, { id_expiry: '2000-01-01' }, false), /future/);
});

// ---------------------------------------------------------------------------
test('limits: tier 0 caps on withdraw/perps/options/cloud/cards, LIMIT_EXCEEDED payload, ctx.compliance API', async (t) => {
  const s = await setup(); t.after(s.close);
  const call = mkCall(s.base);
  const u = await user(call, 'lim@t.io');
  s.oracle.set('BTC', 100000);
  const me = (await call('GET', '/api/compliance/me', null, u.token)).body;
  assert.equal(me.tier, 0); assert.equal(me.label, 'Unverified'); assert.equal(me.terms.accepted, true, 'signup accepts current terms');
  assert.equal(me.limits.withdraw_daily_usd, 2000); assert.equal(me.rows.length, 6);

  // withdraw: 1500 USDT fine (below travel rule? no: >= 1000 needs info) -> use 900 twice then over
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '900' }, u.token)).status, 201);
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '900' }, u.token)).status, 201);
  const over = await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '300' }, u.token);
  assert.equal(over.status, 400); assert.equal(over.body.code, 'LIMIT_EXCEEDED');
  assert.deepEqual({ ...over.body.data, used: Math.round(over.body.data.used) }, { action: 'withdraw', window: 'daily', key: 'withdraw_daily_usd', limit: 2000, used: 1800, requested: 300, tier: 0, tier_required: 1 });
  assert.match(over.body.error, /daily withdrawal limit of \$2,000/);
  // BTC priced through the oracle: 0.005 BTC = $500 > remaining $200
  const btc = await call('POST', '/api/wallet/withdraw', { asset: 'BTC', chain: 'BTC', address: 'bc1qabcdefghijklmnopqrstuvwxyz', amount: '0.005' }, u.token);
  assert.equal(btc.body.code, 'LIMIT_EXCEEDED'); assert.equal(btc.body.data.requested, 500);
  // rejected withdrawals do not count
  const adm = await admin(call);
  const pend = (await call('GET', '/api/wallet/withdrawals', null, u.token)).body.withdrawals;
  await call('POST', `/api/admin/withdrawals/${pend[0].id}/reject`, {}, adm);
  assert.equal(Math.round((await call('GET', '/api/compliance/limits', null, u.token)).body.usage.withdraw_daily_usd), 900);

  // perps: 2000 notional cap at tier 0
  assert.equal((await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '100', leverage: 10 }, u.token)).status, 201);
  const p2 = await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '200', leverage: 10 }, u.token);
  assert.equal(p2.body.code, 'LIMIT_EXCEEDED'); assert.equal(p2.body.data.window, 'open'); assert.equal(p2.body.data.tier_required, 1);
  assert.equal((await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '100', leverage: 500 }, u.token)).status, 400, 'engine validates leverage, not us');

  // options: premium cap 500
  s.oracle.set('ETH', 3000);
  const chain = (await call('GET', '/api/options/ETH/chain')).body;
  const exp = chain.expiries[chain.expiries.length - 1];
  const big = await call('POST', '/api/options/buy', { symbol: 'ETH', kind: 'call', strike: 3000, expiry: exp.expiry, qty: 50 }, u.token);
  assert.equal(big.body.code, 'LIMIT_EXCEEDED'); assert.equal(big.body.data.action, 'options');
  assert.equal((await call('POST', '/api/options/buy', { symbol: 'ETH', kind: 'call', strike: 3000, expiry: exp.expiry, qty: 0.1 }, u.token)).status, 201);

  // cloud: $200/month cap
  assert.equal((await call('POST', '/api/shop/checkout', { plan_id: 'vm-1', hostname: 'ok1', pay_with: 'wallet' }, u.token)).status, 200);
  for (let i = 0; i < 3; i++) await call('POST', '/api/shop/checkout', { plan_id: 'vm-8', hostname: `big${i}`, pay_with: 'wallet' }, u.token); // 3 x $55
  const cl = await call('POST', '/api/shop/checkout', { plan_id: 'vm-8', hostname: 'big9', pay_with: 'wallet' }, u.token);
  assert.equal(cl.body.code, 'LIMIT_EXCEEDED'); assert.equal(cl.body.data.key, 'cloud_monthly_usd'); assert.equal(cl.body.data.used, 174);

  // cards: max order $500 at tier 0
  const card = await call('POST', '/api/cards/products/AEG-001/orders', { side: 'buy', price: '300', qty: 2 }, u.token);
  assert.equal(card.body.code, 'LIMIT_EXCEEDED'); assert.equal(card.body.data.window, 'order');
  assert.equal((await call('POST', '/api/cards/products/AEG-001/orders', { side: 'buy', price: '100', qty: 2 }, u.token)).status, 201);

  // programmatic API for other plugins
  assert.equal(s.compliance.tierOf(u.id), 0);
  await assert.rejects(s.compliance.check(u.id, 'withdraw', 5000), (e) => e.code === 'LIMIT_EXCEEDED' && e.status === 400);
  assert.equal((await s.compliance.check(u.id, 'withdraw', 10)).ok, true);
  await assert.rejects(s.compliance.check(u.id, 'nonsense', 1), /Unknown compliance action/);
  assert.equal(s.compliance.limits(u.id).tier, 0);
});

// ---------------------------------------------------------------------------
test('KYC: draft -> fields -> documents (magic bytes, size, IDOR) -> submit -> admin review -> tier & limits; reject + resubmit; expire; manual tier', async (t) => {
  const s = await setup({ config: (c) => { c.compliance = { kycValidityDays: 30 }; } }); t.after(s.close);
  const call = mkCall(s.base);
  const u = await user(call, 'kyc@t.io'); const other = await user(call, 'other@t.io'); const adm = await admin(call);

  // tier order and drafts
  assert.equal((await call('POST', '/api/compliance/kyc/cases', { tier: 2 }, u.token)).body.code, 'TIER_ORDER');
  assert.equal((await call('POST', '/api/compliance/kyc/cases', { tier: 9 }, u.token)).status, 400);
  const c1 = (await call('POST', '/api/compliance/kyc/cases', { tier: 1 }, u.token)).body.case;
  assert.equal(c1.status, 'draft');
  assert.equal((await call('POST', '/api/compliance/kyc/cases', { tier: 1 }, u.token)).body.case.id, c1.id, 'same draft returned');
  // validation
  assert.match((await call('PUT', `/api/compliance/kyc/cases/${c1.id}`, { fields: { dob: '2015-01-01' } }, u.token)).body.error, /18 years/);
  assert.match((await call('PUT', `/api/compliance/kyc/cases/${c1.id}`, { fields: { country: 'XX' } }, u.token)).body.error, /ISO 3166/);
  assert.equal((await call('PUT', `/api/compliance/kyc/cases/${c1.id}`, { fields: { full_name: 'A'.repeat(200) } }, u.token)).status, 400);
  const inc = await call('POST', `/api/compliance/kyc/cases/${c1.id}/submit`, {}, u.token);
  assert.equal(inc.status, 400); assert.equal(inc.body.code, 'VALIDATION'); assert.equal(inc.body.data.field, 'full_name');
  // IDOR: other user cannot see or edit the case
  assert.equal((await call('GET', `/api/compliance/kyc/cases/${c1.id}`, null, other.token)).status, 404);
  assert.equal((await call('PUT', `/api/compliance/kyc/cases/${c1.id}`, { fields: T1 }, other.token)).status, 404);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c1.id}/submit`, {}, other.token)).status, 404);
  // tier 1 documents are not allowed
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c1.id}/documents`, upload(PNG, 'a.png', 'image/png'), u.token)).status, 400);
  // submit tier 1 (sanctioned declared country refused)
  await call('PUT', `/api/compliance/kyc/cases/${c1.id}`, { fields: { ...T1, country: 'KP' } }, u.token);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c1.id}/submit`, {}, u.token)).body.code, 'COUNTRY_BLOCKED');
  await call('PUT', `/api/compliance/kyc/cases/${c1.id}`, { fields: { country: 'DE' } }, u.token);
  const sub = await call('POST', `/api/compliance/kyc/cases/${c1.id}/submit`, {}, u.token);
  assert.equal(sub.status, 200); assert.equal(sub.body.case.status, 'submitted');
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c1.id}/submit`, {}, u.token)).body.code, 'NOT_DRAFT');
  assert.equal((await call('POST', '/api/compliance/kyc/cases', { tier: 2 }, u.token)).body.code, 'TIER_ORDER');
  let me = (await call('GET', '/api/compliance/me', null, u.token)).body;
  assert.equal(me.kyc.pending_case.id, c1.id); assert.equal(me.country.code, 'DE'); assert.equal(me.country.source, 'declared');
  const ev = []; s.events.on('compliance.kyc_decided', (e) => ev.push(e));

  // admin queue & decision
  assert.equal((await call('GET', '/api/compliance/admin/kyc/queue', null, u.token)).status, 403, 'users cannot see the queue');
  const q = (await call('GET', '/api/compliance/admin/kyc/queue', null, adm)).body;
  assert.equal(q.total, 1); assert.equal(q.items[0].email, 'kyc@t.io'); assert.equal(q.items[0].fields, undefined, 'queue hides PII');
  const full = (await call('GET', `/api/compliance/admin/kyc/cases/${c1.id}`, null, adm)).body.case;
  assert.equal(full.fields.full_name, 'Alice Example'); assert.deepEqual(full.screening.matches, []);
  assert.equal((await call('POST', `/api/compliance/admin/kyc/cases/${c1.id}/reject`, { reason: '' }, adm)).status, 400, 'reason required');
  const ap = await call('POST', `/api/compliance/admin/kyc/cases/${c1.id}/approve`, {}, adm);
  assert.equal(ap.status, 200); assert.equal(ap.body.case.status, 'approved'); assert.ok(ap.body.case.expires_at, 'validity set');
  assert.equal(ev.length, 1); assert.equal(ev[0].decision, 'approved'); assert.equal(ev[0].tier_after, 1);
  me = (await call('GET', '/api/compliance/me', null, u.token)).body;
  assert.equal(me.tier, 1); assert.equal(me.limits.withdraw_daily_usd, 10000); assert.equal(me.kyc.next_tier, 2);
  assert.equal((await call('POST', `/api/compliance/admin/kyc/cases/${c1.id}/approve`, {}, adm)).status, 409, 'cannot approve twice');
  assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action='compliance.kyc.approved' AND target_id=?").get(u.id), 'audited');

  // tier 2 with documents
  const c2 = (await call('POST', '/api/compliance/kyc/cases', { tier: 2 }, u.token)).body.case;
  await call('PUT', `/api/compliance/kyc/cases/${c2.id}`, { fields: { id_type: 'id_card', id_number: 'L01X00T47', id_country: 'DE', id_expiry: '2031-01-01' } }, u.token);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(EXE, 'virus.png', 'image/png'), u.token)).body.code, 'UNSUPPORTED_FILE_TYPE', 'magic bytes, not the client type');
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(PNG, 'f.png', 'image/png', 'passport_scan'), u.token)).status, 400, 'unknown kind');
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, { kind: 'id_front', file: 'abc' }, u.token)).body.code, 'BAD_MULTIPART');
  const huge = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(huge, 'huge.png', 'image/png'), u.token)).status, 413);
  const d1 = await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(PNG, 'front.png', 'image/png', 'id_front'), u.token);
  assert.equal(d1.status, 201); assert.equal(d1.body.document.mime, 'image/png'); assert.equal(d1.body.document.path, undefined, 'no paths leak');
  const d1b = await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(JPG, 'front2.jpg', 'image/jpeg', 'id_front'), u.token);
  assert.equal(d1b.status, 201, 're-upload replaces');
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(PDF, 'back.pdf', 'application/pdf', 'id_back'), u.token)).status, 201);
  const miss = await call('POST', `/api/compliance/kyc/cases/${c2.id}/submit`, {}, u.token);
  assert.equal(miss.body.data.field, 'selfie');
  const selfie = (await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(JPG, 'me.jpg', 'image/jpeg', 'selfie'), u.token)).body.document;
  // other user cannot upload to / delete from this case
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(JPG, 'x.jpg', 'image/jpeg', 'selfie'), other.token)).status, 404);
  assert.equal((await call('DELETE', `/api/compliance/kyc/cases/${c2.id}/documents/${selfie.id}`, null, other.token)).status, 404);
  const cs = (await call('GET', `/api/compliance/kyc/cases/${c2.id}`, null, u.token)).body.case;
  assert.equal(cs.documents.length, 3); assert.equal(cs.documents.filter((d) => d.kind === 'id_front').length, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM kyc_documents WHERE case_id=?').get(c2.id).n, 3, 'replaced file row removed');
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/submit`, {}, u.token)).status, 200);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(JPG, 'late.jpg', 'image/jpeg', 'selfie'), u.token)).body.code, 'NOT_DRAFT');

  // documents: admin only, served inline with the sniffed type; users (even the owner) never get them back
  const docId = cs.documents.find((d) => d.kind === 'id_back').id;
  assert.equal((await call('GET', `/api/compliance/admin/kyc/documents/${docId}`, null, u.token)).status, 403);
  assert.equal((await call('GET', `/api/compliance/admin/kyc/documents/${docId}`)).status, 401);
  const dres = await fetch(`${s.base}/api/compliance/admin/kyc/documents/${docId}`, { headers: { authorization: `Bearer ${adm}` } });
  assert.equal(dres.status, 200); assert.equal(dres.headers.get('content-type'), 'application/pdf'); assert.match(dres.headers.get('content-disposition'), /^inline/);
  assert.equal(dres.headers.get('cache-control'), 'private, no-store');
  assert.equal(Buffer.from(await dres.arrayBuffer()).equals(PDF), true);
  assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action='compliance.kyc.document_viewed'").get());
  assert.equal((await call('GET', '/api/compliance/admin/kyc/documents/999999', null, adm)).status, 404);
  // static route must not expose the kyc dir
  const rel = s.db.prepare('SELECT path FROM kyc_documents WHERE id=?').get(docId).path;
  assert.equal((await fetch(`${s.base}/kyc/${rel}`)).status, 404);

  // reject with reason -> user sees it and can resubmit
  const rj = await call('POST', `/api/compliance/admin/kyc/cases/${c2.id}/reject`, { reason: 'Selfie is blurry' }, adm);
  assert.equal(rj.body.case.status, 'rejected');
  me = (await call('GET', '/api/compliance/me', null, u.token)).body;
  assert.equal(me.tier, 1); assert.equal(me.kyc.current_case.status, 'rejected'); assert.equal(me.kyc.current_case.reason, 'Selfie is blurry');
  const c2b = (await call('POST', '/api/compliance/kyc/cases', { tier: 2 }, u.token)).body.case;
  assert.notEqual(c2b.id, c2.id); assert.equal(c2b.status, 'draft');
  await call('PUT', `/api/compliance/kyc/cases/${c2b.id}`, { fields: { id_type: 'passport', id_number: 'C01X00T47', id_country: 'DE', id_expiry: '2031-01-01' } }, u.token);
  await call('POST', `/api/compliance/kyc/cases/${c2b.id}/documents`, upload(PNG, 'p.png', 'image/png', 'id_front'), u.token);
  await call('POST', `/api/compliance/kyc/cases/${c2b.id}/documents`, upload(JPG, 's.jpg', 'image/jpeg', 'selfie'), u.token);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2b.id}/submit`, {}, u.token)).status, 200, 'passport needs no back side');
  await call('POST', `/api/compliance/admin/kyc/cases/${c2b.id}/approve`, {}, adm);
  assert.equal(s.compliance.tierOf(u.id), 2);

  // tier 3 questionnaire
  const c3 = (await call('POST', '/api/compliance/kyc/cases', { tier: 3 }, u.token)).body.case;
  await call('PUT', `/api/compliance/kyc/cases/${c3.id}`, { fields: { occupation: 'Engineer', source_of_funds: 'other', expected_monthly_volume: '50k_250k', pep: true } }, u.token);
  await call('POST', `/api/compliance/kyc/cases/${c3.id}/documents`, upload(PDF, 'bill.pdf', 'application/pdf', 'proof_of_address'), u.token);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c3.id}/submit`, {}, u.token)).body.data.field, 'source_details');
  await call('PUT', `/api/compliance/kyc/cases/${c3.id}`, { fields: { source_details: 'Sold a company', pep_details: 'City council member, DE' } }, u.token);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c3.id}/submit`, {}, u.token)).status, 200);
  await call('POST', `/api/compliance/admin/kyc/cases/${c3.id}/approve`, {}, adm);
  me = (await call('GET', '/api/compliance/me', null, u.token)).body;
  assert.equal(me.tier, 3); assert.equal(me.kyc.next_tier, null); assert.equal(me.limits.withdraw_daily_usd, 500000);

  // expire a case -> tier recomputed from remaining approvals
  assert.equal((await call('POST', `/api/compliance/admin/kyc/cases/${c3.id}/expire`, {}, adm)).body.case.status, 'expired');
  assert.equal(s.compliance.tierOf(u.id), 2);
  assert.equal((await call('POST', `/api/compliance/admin/kyc/cases/${c3.id}/expire`, {}, adm)).status, 409);
  // manual tier
  assert.equal((await call('POST', `/api/compliance/admin/users/${u.id}/tier`, { tier: 7 }, adm)).status, 400);
  assert.equal((await call('POST', `/api/compliance/admin/users/${u.id}/tier`, { tier: 0, reason: 'review' }, adm)).body.tier, 0);
  assert.equal(s.compliance.tierOf(u.id), 0);
  assert.equal((await call('POST', `/api/compliance/admin/users/${u.id}/tier`, { tier: 1 }, u.token)).status, 403);
  // validity job: back-date the expiry and run the job
  s.db.prepare("UPDATE kyc_cases SET expires_at=datetime('now','-1 day') WHERE id=?").run(c1.id);
  assert.equal(s.compliance.kyc.expireDue(), 1);
  assert.equal(s.db.prepare('SELECT status FROM kyc_cases WHERE id=?').get(c1.id).status, 'expired');
  // admin user view
  const au = (await call('GET', `/api/compliance/admin/users/${u.id}`, null, adm)).body;
  assert.equal(au.cases.length, 4); assert.equal(au.terms.accepted, true); assert.ok(au.audit.length >= 5);
  assert.equal((await call('GET', '/api/compliance/admin/users/999', null, adm)).status, 404);
  assert.equal((await call('GET', '/api/compliance/admin/users/abc', null, adm)).status, 400);
});

// ---------------------------------------------------------------------------
test('geo: sanctioned header blocks signup/withdraw/trade, derivatives restrictions + admin overrides, declared country fallback', async (t) => {
  const s = await setup(); t.after(s.close);
  const call = mkCall(s.base);
  const adm = await admin(call);
  const kp = await call('POST', '/api/auth/register', { email: 'kp@t.io', password: 'password1' }, null, { 'cf-ipcountry': 'KP' });
  assert.equal(kp.status, 403); assert.equal(kp.body.code, 'COUNTRY_BLOCKED'); assert.equal(kp.body.data.country, 'KP');
  assert.equal((await call('POST', '/api/auth/register', { email: 'xx@t.io', password: 'password1' }, null, { 'cf-ipcountry': 'XX' })).status, 201, 'unknown country is allowed');
  const u = await user(call, 'geo@t.io');
  s.oracle.set('BTC', 100000);
  // header-based blocks on money movement, with flag on login
  const wd = await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '50' }, u.token, { 'cf-ipcountry': 'IR' });
  assert.equal(wd.status, 403); assert.equal(wd.body.code, 'COUNTRY_BLOCKED');
  assert.equal((await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '90000', qty: '0.001' }, u.token, { 'cf-ipcountry': 'cu' })).body.code, 'COUNTRY_BLOCKED');
  assert.equal((await call('POST', '/api/shop/checkout', { plan_id: 'vm-1', pay_with: 'wallet' }, u.token, { 'cf-ipcountry': 'SY' })).body.code, 'COUNTRY_BLOCKED');
  const login = await call('POST', '/api/auth/login', { email: 'geo@t.io', password: 'password1' }, null, { 'cf-ipcountry': 'IR' });
  assert.equal(login.status, 200); assert.equal(login.body.compliance.country, 'IR');
  assert.ok(s.db.prepare("SELECT 1 FROM compliance_flags WHERE user_id=? AND rule='sanctioned_country_login' AND severity='critical'").get(u.id));
  // derivatives: GB blocked by default, spot allowed
  const gb = await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '10', leverage: 2 }, u.token, { 'cf-ipcountry': 'GB' });
  assert.equal(gb.status, 403); assert.equal(gb.body.code, 'PRODUCT_RESTRICTED'); assert.equal(gb.body.data.product, 'perps');
  const chain = (await call('GET', '/api/options/ETH/chain')).body;
  assert.equal((await call('POST', '/api/options/buy', { symbol: 'ETH', kind: 'call', strike: chain.expiries[0].rows[0].strike, expiry: chain.expiries[0].expiry, qty: 0.1 }, u.token, { 'cf-ipcountry': 'US' })).body.code, 'PRODUCT_RESTRICTED');
  assert.equal((await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '90000', qty: '0.001' }, u.token, { 'cf-ipcountry': 'GB' })).status, 201, 'spot still fine in GB');
  assert.equal((await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '10', leverage: 2 }, u.token, { 'cf-ipcountry': 'DE' })).status, 201, 'DE allowed');
  // admin override: allow GB, block DE, sanction a new country
  assert.equal((await call('PUT', '/api/compliance/admin/countries/GB', { derivatives: 'allowed' }, u.token)).status, 403);
  assert.equal((await call('PUT', '/api/compliance/admin/countries/ZZ', { derivatives: 'allowed' }, adm)).status, 400);
  assert.equal((await call('PUT', '/api/compliance/admin/countries/GB', { derivatives: 'maybe' }, adm)).status, 400);
  const ov = (await call('PUT', '/api/compliance/admin/countries/gb', { derivatives: 'allowed', note: 'professional clients only' }, adm)).body.rule;
  assert.equal(ov.derivatives, 'allowed'); assert.equal(ov.source, 'override');
  assert.equal((await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '10', leverage: 2 }, u.token, { 'cf-ipcountry': 'GB' })).status, 201);
  await call('PUT', '/api/compliance/admin/countries/DE', { derivatives: 'blocked' }, adm);
  assert.equal((await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '10', leverage: 2 }, u.token, { 'cf-ipcountry': 'DE' })).body.code, 'PRODUCT_RESTRICTED');
  await call('PUT', '/api/compliance/admin/countries/FR', { sanctioned: true }, adm);
  assert.equal((await call('POST', '/api/auth/register', { email: 'fr@t.io', password: 'password1' }, null, { 'cf-ipcountry': 'FR' })).body.code, 'COUNTRY_BLOCKED');
  const list = (await call('GET', '/api/compliance/admin/countries', null, adm)).body;
  assert.equal(list.countries.length, 249); assert.equal(list.countries.find((c) => c.country === 'FR').sanctioned, true); assert.equal(list.countries.find((c) => c.country === 'JP').derivatives, 'blocked');
  assert.equal((await call('DELETE', '/api/compliance/admin/countries/FR', null, adm)).body.rule.sanctioned, false);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'compliance.country.%'").get().n, 4);
  // declared country fallback (no header): a GB resident declared through KYC is blocked from derivatives... after DE override removed, GB is allowed by override; use US
  await call('DELETE', '/api/compliance/admin/countries/GB', null, adm);
  const us = await user(call, 'us@t.io');
  await approveTier1(call, us, adm, { ...T1, full_name: 'Bob Builder', country: 'US' });
  const r = await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '10', leverage: 2 }, us.token);
  assert.equal(r.body.code, 'PRODUCT_RESTRICTED'); assert.equal(r.body.data.country, 'US');
  assert.equal((await call('GET', '/api/compliance/me', null, us.token)).body.derivatives_allowed, false);
  assert.equal((await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '10', leverage: 2 }, us.token, { 'cf-ipcountry': 'CH' })).status, 201, 'header wins over declared');
  assert.equal((await call('GET', '/api/compliance/countries')).body.countries.length, 249, 'public reference list');
});

// ---------------------------------------------------------------------------
test('terms versioning: bump requires re-acceptance (ACCEPT_TERMS), accept endpoint validates versions', async (t) => {
  const s = await setup(); t.after(s.close);
  const call = mkCall(s.base);
  const u = await user(call, 'terms@t.io');
  assert.equal((await call('GET', '/api/compliance/terms')).body.current.terms_version, '2026-01');
  assert.equal((await call('GET', '/api/compliance/terms', null, u.token)).body.accepted, true);
  s.config.compliance.termsVersion = '2026-07';
  const tr = await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '90000', qty: '0.001' }, u.token);
  assert.equal(tr.status, 403); assert.equal(tr.body.code, 'ACCEPT_TERMS'); assert.deepEqual(tr.body.data, { terms_version: '2026-07', risk_version: '2026-01', accepted_terms_version: '2026-01', accepted_risk_version: '2026-01' });
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '50' }, u.token)).body.code, 'ACCEPT_TERMS');
  assert.equal((await call('POST', '/api/shop/checkout', { plan_id: 'vm-1', pay_with: 'wallet' }, u.token)).status, 200, 'cloud does not need re-acceptance');
  assert.equal((await call('POST', '/api/compliance/terms/accept', { terms_version: '2026-01', risk_version: '2026-01' }, u.token)).status, 409, 'stale version refused');
  const ok = await call('POST', '/api/compliance/terms/accept', { terms_version: '2026-07', risk_version: '2026-01' }, u.token);
  assert.equal(ok.status, 200); assert.equal(ok.body.accepted, true);
  assert.equal((await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '90000', qty: '0.001' }, u.token)).status, 201);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM compliance_terms_acceptances WHERE user_id=?').get(u.id).n, 2);
  assert.equal((await call('GET', '/api/compliance/me', null, u.token)).body.terms.accepted, true);
  assert.equal((await call('GET', '/api/site')).body.compliance.terms_version, '2026-07', 'site exposes current versions');
});

// ---------------------------------------------------------------------------
test('travel rule: withdrawals >= threshold need beneficiary info, stored keyed by withdrawal id; admin list', async (t) => {
  const s = await setup({ config: (c) => { c.compliance = { travelRuleUsd: 500 }; } }); t.after(s.close);
  const call = mkCall(s.base);
  const u = await user(call, 'tr@t.io'); const adm = await admin(call);
  await approveTier1(call, u, adm);
  const q = (await call('GET', '/api/compliance/travel-rule?asset=USDT&amount=600', null, u.token)).body;
  assert.equal(q.required, true); assert.equal(q.threshold_usd, 500);
  assert.equal((await call('GET', '/api/compliance/travel-rule?asset=USDT&amount=100', null, u.token)).body.required, false);
  assert.equal((await call('GET', '/api/compliance/travel-rule?asset=USDT&amount=-1', null, u.token)).status, 400);
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '100' }, u.token)).status, 201, 'below threshold: no info needed');
  const need = await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '600' }, u.token);
  assert.equal(need.status, 400); assert.equal(need.body.code, 'TRAVEL_RULE_INFO_REQUIRED'); assert.equal(need.body.data.amount_usd, 600);
  const bad = await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '600', travel_rule: { beneficiary_name: 'X', beneficiary_type: 'self', wallet_type: 'vasp' } }, u.token);
  assert.equal(bad.body.code, 'TRAVEL_RULE_INFO_REQUIRED'); assert.deepEqual(bad.body.data.errors, ['beneficiary_name', 'vasp_name']);
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '600', travel_rule: { beneficiary_name: 'Alice Example', beneficiary_type: 'self', wallet_type: 'self_hosted' } }, u.token)).body.data.errors[0], 'self_hosted_confirmed');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM compliance_travel_rule').get().n, 0, 'nothing stored for refused requests');
  const ok = await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '600', travel_rule: { beneficiary_name: 'Alice Example', beneficiary_type: 'self', wallet_type: 'self_hosted', self_hosted_confirmed: true } }, u.token);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const rec = s.db.prepare('SELECT * FROM compliance_travel_rule WHERE withdrawal_id=?').get(ok.body.id);
  assert.ok(rec, 'linked to the withdrawal'); assert.equal(rec.beneficiary_name, 'Alice Example'); assert.equal(rec.amount_usd, 600); assert.equal(JSON.parse(rec.originator).name, 'Alice Example');
  // VASP beneficiary, third party, BTC priced via oracle
  s.oracle.set('BTC', 100000);
  const v = await call('POST', '/api/wallet/withdraw', { asset: 'BTC', chain: 'BTC', address: 'bc1qabcdefghijklmnopqrstuvwxyz', amount: '0.01', travel_rule: { beneficiary_name: 'Carol Customer', beneficiary_type: 'third_party', wallet_type: 'vasp', vasp_name: 'Kraken', vasp_country: 'us' } }, u.token);
  assert.equal(v.status, 201);
  const list = (await call('GET', '/api/compliance/admin/travel-rule', null, adm)).body;
  assert.equal(list.total, 2); assert.equal(list.items[0].vasp_country, 'US'); assert.equal(list.items[0].withdrawal_id, v.body.id); assert.equal(list.items[0].withdrawal_status, 'pending');
  assert.equal((await call('GET', '/api/compliance/admin/travel-rule', null, u.token)).status, 403);
  // insufficient funds after the declaration (within limits: 2.5 ETH = $7,500): orphan record is reconciled away later
  s.oracle.set('ETH', 3000);
  const broke = await call('POST', '/api/wallet/withdraw', { asset: 'ETH', chain: 'ERC20', address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', amount: '2.5', travel_rule: { beneficiary_name: 'Alice Example', beneficiary_type: 'self', wallet_type: 'self_hosted', self_hosted_confirmed: true } }, u.token);
  assert.equal(broke.status, 400); assert.match(broke.body.error, /Insufficient/);
  s.db.prepare("UPDATE compliance_travel_rule SET created_at=datetime('now','-2 day') WHERE withdrawal_id IS NULL").run();
  assert.equal(s.compliance.travel.reconcile(), 1, 'stale orphan removed');
  // threshold 0 disables the rule
  s.config.compliance.travelRuleUsd = 0;
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '600' }, u.token)).status, 201);
});

// ---------------------------------------------------------------------------
test('monitoring: velocity flags, pass-through, large withdrawal, round-trip volume, flag review, freeze/unfreeze blocks everything', async (t) => {
  const s = await setup({ config: (c) => { c.compliance = { velocity: { withdrawalsPerHour: 3, depositWithdrawMinutes: 30, roundTripUsd: 1000, largeWithdrawalUsd: 800 } }; } }); t.after(s.close);
  const call = mkCall(s.base);
  const u = await user(call, 'mon@t.io'); const adm = await admin(call);
  await approveTier1(call, u, adm);
  const flags = []; s.events.on('compliance.flag', (e) => flags.push(e));
  await call('POST', '/api/admin/wallet/credit', { user_id: u.id, asset: 'USDT', amount: '100', ref: 'wire' }, adm);
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '20' }, u.token)).status, 201);
  const rules = flags.map((f) => f.rule);
  assert.ok(rules.includes('pass_through'), 'deposit then withdraw'); assert.ok(rules.includes('velocity.withdrawals'), '3 withdrawals/hour');
  assert.equal(flags.filter((f) => f.rule === 'pass_through').length, 1, 'deduplicated within the hour');
  assert.equal(s.db.prepare("SELECT hits FROM compliance_flags WHERE user_id=? AND rule='pass_through'").get(u.id).hits, 3);
  await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '850' }, u.token);
  assert.ok(flags.some((f) => f.rule === 'large_withdrawal' && f.severity === 'low'));
  // round trip: sell 0.02 BTC @ 50000 to a counterparty, buy it back -> $2000 balanced volume
  const cp = await user(call, 'cp@t.io');
  s.oracle.set('BTC', 50000);
  await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '50000', qty: '0.02' }, cp.token);
  await call('POST', '/api/spot/BTC_USDT/orders', { side: 'sell', type: 'limit', price: '50000', qty: '0.02' }, u.token);
  await call('POST', '/api/spot/BTC_USDT/orders', { side: 'sell', type: 'limit', price: '50000', qty: '0.02' }, cp.token);
  await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '50000', qty: '0.02' }, u.token);
  assert.ok(flags.some((f) => f.rule === 'round_trip_volume' && f.userId === u.id), JSON.stringify(flags.map((f) => [f.rule, f.userId])));
  assert.ok(flags.some((f) => f.rule === 'counterparty_concentration'));

  // admin review
  assert.equal((await call('GET', '/api/compliance/admin/flags', null, u.token)).status, 403);
  const open = (await call('GET', '/api/compliance/admin/flags?status=open', null, adm)).body;
  assert.ok(open.total >= 4); assert.equal(open.items[0].email !== undefined, true);
  assert.equal((await call('GET', '/api/compliance/admin/flags?status=weird', null, adm)).status, 400);
  const pt = open.items.find((f) => f.rule === 'pass_through');
  assert.equal((await call('POST', `/api/compliance/admin/flags/${pt.id}/dismiss`, { note: 'known client' }, adm)).body.flag.status, 'dismissed');
  assert.equal((await call('POST', `/api/compliance/admin/flags/${pt.id}/dismiss`, {}, adm)).status, 409);
  const lw = open.items.find((f) => f.rule === 'large_withdrawal');
  assert.equal((await call('POST', `/api/compliance/admin/flags/${lw.id}/escalate`, { note: 'ask for SoF' }, adm)).body.flag.status, 'escalated');
  const frozenEv = []; s.events.on('compliance.account_frozen', (e) => frozenEv.push(e));
  const vel = open.items.find((f) => f.rule === 'velocity.withdrawals');
  const fr = await call('POST', `/api/compliance/admin/flags/${vel.id}/freeze`, { note: 'structuring' }, adm);
  assert.equal(fr.body.flag.status, 'frozen'); assert.equal(frozenEv[0].frozen, true); assert.equal(frozenEv[0].userId, u.id);
  assert.equal(s.db.prepare('SELECT frozen, banned FROM users WHERE id=?').get(u.id).frozen, 1);
  assert.equal(s.db.prepare('SELECT banned FROM users WHERE id=?').get(u.id).banned, 0, 'frozen is not banned');
  for (const [m, p, b] of [['POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '20' }], ['POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '50000', qty: '0.001' }], ['POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '10', leverage: 2 }], ['POST', '/api/cards/products/AEG-001/orders', { side: 'buy', price: '10', qty: 1 }], ['POST', '/api/shop/checkout', { plan_id: 'vm-1', pay_with: 'wallet' }]]) {
    const r = await call(m, p, b, u.token);
    assert.equal(r.status, 403, p); assert.equal(r.body.code, 'ACCOUNT_FROZEN', p);
  }
  assert.equal((await call('GET', '/api/wallet', null, u.token)).status, 200, 'frozen users can still log in and look');
  assert.equal((await call('GET', '/api/compliance/me', null, u.token)).body.frozen, true);
  await assert.rejects(s.compliance.check(u.id, 'withdraw', 1), (e) => e.code === 'ACCOUNT_FROZEN');
  assert.equal((await call('POST', `/api/compliance/admin/users/${u.id}/freeze`, { reason: 'x' }, u.token)).status, 403);
  assert.equal((await call('POST', `/api/compliance/admin/users/${u.id}/unfreeze`, { note: 'cleared' }, adm)).body.frozen, false);
  assert.equal((await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '50000', qty: '0.001' }, u.token)).status, 201);
  assert.equal((await call('POST', `/api/compliance/admin/users/${u.id}/freeze`, { reason: '' }, adm)).status, 400, 'freeze needs a reason');
  assert.equal((await call('POST', '/api/compliance/admin/users/999/freeze', { reason: 'nope' }, adm)).status, 404);
  const acts = s.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'compliance.%' ORDER BY id").all().map((a) => a.action);
  for (const a of ['compliance.flag.dismissed', 'compliance.flag.escalated', 'compliance.flag.frozen', 'compliance.account.frozen', 'compliance.account.unfrozen']) assert.ok(acts.includes(a), a);
  const ovw = (await call('GET', '/api/compliance/admin/overview', null, adm)).body;
  assert.equal(ovw.frozen_users, 0); assert.ok(ovw.flags.medium >= 1);
});

// ---------------------------------------------------------------------------
test('sanctions list: add/import/screen/delete; KYC submission with a matching name is flagged critical', async (t) => {
  const s = await setup(); t.after(s.close);
  const call = mkCall(s.base);
  const u = await user(call, 'sanc@t.io'); const adm = await admin(call);
  assert.equal((await call('POST', '/api/compliance/admin/sanctions', { name: 'Vladimir Petrov' }, u.token)).status, 403);
  assert.equal((await call('POST', '/api/compliance/admin/sanctions', { name: 'V' }, adm)).status, 400);
  const e1 = (await call('POST', '/api/compliance/admin/sanctions', { name: 'Vladimir Petrov', aliases: ['Volodymyr Petrov'], source: 'manual', program: 'TEST', dob: '1970-01-01' }, adm)).body.entry;
  assert.deepEqual(e1.aliases, ['Volodymyr Petrov']);
  const imp = await call('POST', '/api/compliance/admin/sanctions/import', { format: 'ofac_sdn', text: '7157,"ABU MARZOOK, Mousa Mohammed",individual,"SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 09 Feb 1951; nationality Egypt."\n9999,"SOME VESSEL",vessel,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ', alt: '7157,1,aka,"ABU MARZUK, Musa",-0- ' }, adm);
  assert.equal(imp.status, 200); assert.equal(imp.body.imported, 1, 'vessels skipped');
  const imp2 = await call('POST', '/api/compliance/admin/sanctions/import', { format: 'lines', text: 'Jane Roe\nJohn Q Public\n', source: 'eu' }, adm);
  assert.equal(imp2.body.imported, 2);
  assert.equal((await call('POST', '/api/compliance/admin/sanctions/import', { format: 'json', text: '{bad', source: 'eu' }, adm)).status, 400);
  assert.equal((await call('POST', '/api/compliance/admin/sanctions/import', { format: 'lines', text: 'Only One', source: 'eu', replace: true }, adm)).body.removed, 2);
  // multipart import (how real OFAC files arrive)
  const fd = new FormData(); fd.append('format', 'lines'); fd.append('source', 'uk'); fd.append('sdn', new Blob(['Uk Person One\nUk Person Two'], { type: 'text/plain' }), 'list.txt');
  assert.equal((await call('POST', '/api/compliance/admin/sanctions/import', fd, adm)).body.imported, 2);
  const lst = (await call('GET', '/api/compliance/admin/sanctions?q=petrov', null, adm)).body;
  assert.equal(lst.items.length, 1); assert.equal(lst.items[0].id, e1.id);
  const sc = (await call('POST', '/api/compliance/admin/sanctions/screen', { name: 'Petrov, Vladimir' }, adm)).body;
  assert.equal(sc.matches[0].id, e1.id); assert.equal(sc.matches[0].score, 1);
  assert.equal((await call('POST', '/api/compliance/admin/sanctions/screen', { name: 'Musa Abu Marzuk' }, adm)).body.matches[0].ref_id, '7157', 'alias match');
  assert.equal((await call('POST', '/api/compliance/admin/sanctions/screen', { name: 'Alice Example' }, adm)).body.matches.length, 0);
  // KYC submission screening -> critical flag, case keeps the screening result
  const flags = []; s.events.on('compliance.flag', (e) => flags.push(e));
  const c = (await call('POST', '/api/compliance/kyc/cases', { tier: 1 }, u.token)).body.case;
  await call('PUT', `/api/compliance/kyc/cases/${c.id}`, { fields: { ...T1, full_name: 'Vladimír Petrov', dob: '1970-01-01' } }, u.token);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c.id}/submit`, {}, u.token)).status, 200, 'submission is accepted; staff decide');
  assert.equal(flags.length, 1); assert.equal(flags[0].rule, 'sanctions_match'); assert.equal(flags[0].severity, 'critical');
  const q = (await call('GET', '/api/compliance/admin/kyc/queue', null, adm)).body;
  assert.equal(q.items[0].screening_matches, 1);
  const ac = (await call('GET', `/api/compliance/admin/kyc/cases/${c.id}`, null, adm)).body.case;
  assert.equal(ac.screening.matches[0].name, 'Vladimir Petrov'); assert.ok(ac.screening.matches[0].score >= 0.95);
  assert.equal((await call('GET', `/api/compliance/kyc/cases/${c.id}`, null, u.token)).body.case.screening, undefined, 'users never see screening results');
  assert.equal((await call('DELETE', `/api/compliance/admin/sanctions/${e1.id}`, null, adm)).status, 200);
  assert.equal((await call('DELETE', `/api/compliance/admin/sanctions/${e1.id}`, null, adm)).status, 404);
});

// ---------------------------------------------------------------------------
test('audit log viewer: pagination and filters by action/user/date; admin only', async (t) => {
  const s = await setup(); t.after(s.close);
  const call = mkCall(s.base);
  const u = await user(call, 'aud@t.io'); const adm = await admin(call);
  for (let i = 0; i < 7; i++) s.audit(u.id, `test.action${i % 2}`, { i }, { targetId: u.id, ip: '10.0.0.1' });
  await approveTier1(call, u, adm);
  assert.equal((await call('GET', '/api/compliance/admin/audit', null, u.token)).status, 403);
  const p1 = (await call('GET', '/api/compliance/admin/audit?limit=5&page=1', null, adm)).body;
  assert.equal(p1.items.length, 5); assert.equal(p1.total, 9, '7 test rows + kyc submitted + kyc approved'); assert.equal(p1.items[0].id > p1.items[1].id, true, 'newest first');
  const p2 = (await call('GET', '/api/compliance/admin/audit?limit=5&page=2', null, adm)).body;
  assert.notEqual(p2.items[0].id, p1.items[0].id);
  const byAction = (await call('GET', '/api/compliance/admin/audit?action=test.action1', null, adm)).body;
  assert.equal(byAction.total, 3); assert.deepEqual(byAction.items[0].details, { i: 5 }); assert.equal(byAction.items[0].actor_email, 'aud@t.io');
  const prefix = (await call('GET', '/api/compliance/admin/audit?action=compliance.kyc', null, adm)).body;
  assert.ok(prefix.items.every((a) => a.action.startsWith('compliance.kyc'))); assert.equal(prefix.total, 2, 'prefix match: submitted + approved');
  assert.equal((await call('GET', `/api/compliance/admin/audit?user=${u.id}&q=10.0.0.1`, null, adm)).body.total, 7);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await call('GET', `/api/compliance/admin/audit?from=${today}&to=${today}`, null, adm)).body.total, 9);
  assert.equal((await call('GET', '/api/compliance/admin/audit?from=2099-01-01', null, adm)).body.total, 0);
  assert.equal((await call('GET', '/api/compliance/admin/audit?from=yesterday', null, adm)).status, 400);
  assert.equal((await call('GET', '/api/compliance/admin/audit?user=abc', null, adm)).status, 400);
  const actions = (await call('GET', '/api/compliance/admin/audit/actions', null, adm)).body.actions;
  assert.ok(actions.find((a) => a.action === 'compliance.kyc.approved' && a.n === 1));
  assert.equal((await call('GET', '/api/compliance/admin/audit?limit=100000', null, adm)).body.limit, 200, 'limit capped');
});

// ---------------------------------------------------------------------------
test('config: env JSON tiers, disabled plugin skips enforcement, settings override hook, site() output, multipart edge cases', async (t) => {
  process.env.COMPLIANCE_TIERS = JSON.stringify({ 0: { withdraw_daily_usd: 50, label: 'Guest' } });
  process.env.COMPLIANCE_SANCTIONED_COUNTRIES = 'KP,AQ';
  const s = await setup(); t.after(() => { s.close(); delete process.env.COMPLIANCE_TIERS; delete process.env.COMPLIANCE_SANCTIONED_COUNTRIES; });
  const call = mkCall(s.base);
  const site = (await call('GET', '/api/site')).body;
  assert.equal(site.compliance.tiers[0].label, 'Guest'); assert.equal(site.compliance.tiers[0].withdraw_daily_usd, 50); assert.equal(site.compliance.tiers[1].label, 'Basic');
  assert.ok(site.modules.includes('js/compliance.js')); assert.ok(site.plugins.includes('compliance'));
  const u = await user(call, 'cfg@t.io');
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '60' }, u.token)).body.code, 'LIMIT_EXCEEDED');
  assert.equal((await call('POST', '/api/auth/register', { email: 'aq@t.io', password: 'password1' }, null, { 'cf-ipcountry': 'AQ' })).body.code, 'COUNTRY_BLOCKED');
  assert.equal((await call('POST', '/api/auth/register', { email: 'cu@t.io', password: 'password1' }, null, { 'cf-ipcountry': 'CU' })).status, 201, 'env list replaced the default');
  // custom header name
  const s2 = await setup({ config: (c) => { c.compliance = { countryHeader: 'x-geo' }; } }); t.after(s2.close);
  const call2 = mkCall(s2.base);
  assert.equal((await call2('POST', '/api/auth/register', { email: 'g@t.io', password: 'password1' }, null, { 'x-geo': 'KP' })).body.code, 'COUNTRY_BLOCKED');
  assert.equal((await call2('POST', '/api/auth/register', { email: 'g2@t.io', password: 'password1' }, null, { 'cf-ipcountry': 'KP' })).status, 201, 'other header ignored');
  // disabled: no hooks, but API still answers
  const s3 = await setup({ config: (c) => { c.compliance = { enabled: false }; } }); t.after(s3.close);
  const call3 = mkCall(s3.base);
  const u3 = await user(call3, 'off@t.io');
  assert.equal((await call3('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: ADDR, amount: '5000' }, u3.token)).status, 201);
  assert.equal((await call3('GET', '/api/compliance/me', null, u3.token)).status, 200);
  // settings override is read lazily through ctx.settings
  const { effectiveTiers: eff } = require('../src/plugins/compliance/limits');
  assert.equal(eff(s.config.compliance.tiers, { 0: { withdraw_daily_usd: 7 } })[0].withdraw_daily_usd, 7);
  // multipart: missing file part, empty file
  const adm = await admin(call);
  const u4 = await user(call, 'mp@t.io');
  await approveTier1(call, u4, adm);
  const c2 = (await call('POST', '/api/compliance/kyc/cases', { tier: 2 }, u4.token)).body.case;
  const fd = new FormData(); fd.append('kind', 'id_front');
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, fd, u4.token)).body.data.field, 'file');
  assert.equal((await call('POST', `/api/compliance/kyc/cases/${c2.id}/documents`, upload(Buffer.alloc(10), 'e.png', 'image/png'), u4.token)).status, 400);
  assert.equal((await call('POST', `/api/compliance/kyc/cases/abc/documents`, upload(PNG, 'e.png', 'image/png'), u4.token)).status, 400);
});
