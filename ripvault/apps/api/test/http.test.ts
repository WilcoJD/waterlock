import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/http/router.ts';
import { startApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

describe('http layer', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('health', async () => {
    const res = await app.request('GET', '/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, time: '2026-06-01T12:00:00.000Z' });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('x-request-id')!, /^[0-9a-f-]{36}$/);
  });

  test('CORS preflight', async () => {
    const res = await fetch(`${app.url}/packs/starter/open`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:8081', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,idempotency-key' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-headers')!, /Idempotency-Key/);
    assert.match(res.headers.get('access-control-allow-methods')!, /PATCH/);
  });

  test('unknown routes are 404 not_found, wrong methods 405, both as ApiErrorBody', async () => {
    const nf = await app.request('GET', '/nope');
    assert.equal(nf.status, 404);
    assert.equal(nf.body.error.code, 'not_found');
    const m = await app.request('DELETE', '/packs');
    assert.equal(m.status, 405);
    assert.equal(m.body.error.code, 'bad_request');
    assert.match(m.headers.get('allow')!, /GET/);
  });

  test('invalid JSON, non-object bodies, wrong content type and oversized bodies are rejected', async () => {
    const u = app.user();
    const bad = await app.request('PATCH', '/me', { token: u.token, rawBody: '{oops', headers: { 'Content-Type': 'application/json' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'bad_request');
    const arr = await app.request('PATCH', '/me', { token: u.token, body: [1, 2] });
    assert.equal(arr.status, 400);
    const form = await app.request('PATCH', '/me', { token: u.token, rawBody: 'a=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 400);
    const big = await app.request('PATCH', '/me', { token: u.token, body: { displayName: 'x', pad: 'y'.repeat(70 * 1024) } });
    assert.equal(big.status, 413);
    assert.equal(big.body.error.code, 'bad_request');
  });

  test('internal errors are a generic 500 without stack traces', async () => {
    const u = app.user();
    // Break the schema under the app to force an unexpected SQLite error.
    app.db.exec('ALTER TABLE seed_history RENAME TO seed_history_gone');
    try {
      const res = await app.request('GET', '/fairness', { token: u.token });
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
      assert.equal(/at |sqlite|seed_history/i.test(res.text), false);
    } finally {
      app.db.exec('ALTER TABLE seed_history_gone RENAME TO seed_history');
    }
  });

  test('malformed percent-encoding in a path param is a 400', async () => {
    const res = await app.request('GET', '/packs/%E0%A4%A');
    assert.equal(res.status, 400);
  });
});

test('router prefers static segments over params', () => {
  const r = new Router();
  r.get('/inventory/:id', () => ({ status: 200, body: 'param' }));
  r.post('/inventory/sell', () => ({ status: 200, body: 'static' }));
  r.get('/inventory/sell-history', () => ({ status: 200, body: 'static2' }));
  const m = r.match('GET', '/inventory/sell-history');
  assert.equal(m.kind, 'found');
  if (m.kind === 'found') assert.equal(m.route.pattern, '/inventory/sell-history');
  const p = r.match('GET', '/inventory/itm_1');
  assert.equal(p.kind === 'found' && p.params.id, 'itm_1');
  assert.equal(r.match('PUT', '/inventory/sell').kind, 'method_not_allowed');
});

test('authentication is checked before the body is parsed', async () => {
  const app = await startApp();
  try {
    const res = await app.request('POST', '/inventory/sell', { rawBody: '{oops', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthorized');
  } finally {
    await app.close();
  }
});
