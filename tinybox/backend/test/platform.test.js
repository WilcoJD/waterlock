'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, waitActive } = require('./helpers');

const num = (s) => Number(s);
const bal = async (call, token, asset) => num((await call('GET', '/api/wallet', null, token)).body.balances.find((b) => b.asset === asset).balance);

/** Double-entry invariant: every asset's balances (users + platform) sum to zero. */
function assertConserved(db) {
  for (const r of db.prepare('SELECT asset, SUM(balance) s FROM wallet_balances GROUP BY asset').all()) assert.equal(r.s, 0, `ledger out of balance for ${r.asset}`);
  const escrow = db.prepare("SELECT asset, balance FROM wallet_balances WHERE owner='sys:escrow'").all();
  for (const e of escrow) {
    const need = db.prepare(`SELECT COALESCE(SUM(o.escrow),0) n FROM book_orders o JOIN markets m ON m.id=o.market WHERE o.status='open' AND
      ((o.side='buy' AND m.quote=?) OR (o.side='sell' AND m.kind='spot' AND m.base=?))`).get(e.asset, e.asset).n;
    assert.equal(e.balance, need, `escrow mismatch for ${e.asset}`);
  }
}

async function users(call, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await call('POST', '/api/auth/register', { email: `u${i}@t.io`, password: 'password1' });
    await call('POST', '/api/wallet/faucet', {}, r.body.token);
    out.push({ token: r.body.token, id: r.body.user.id });
  }
  return out;
}

test('unified wallet: faucet, withdraw, admin reject/approve', async (t) => {
  const s = await setup(); t.after(s.close);
  const { call } = s;
  const [a] = await users(call, 1);
  assert.equal(await bal(call, a.token, 'USDT'), 10000);
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: 'TXYZabcdefghijklmnopqrstuv', amount: '1' }, a.token)).status, 400, 'below minimum');
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'BTC', address: 'TXYZabcdefghijklmnopqrstuv', amount: '50' }, a.token)).status, 400, 'wrong chain');
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: 'TXYZabcdefghijklmnopqrstuv', amount: '999999' }, a.token)).status, 400, 'insufficient');
  const w = await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: 'TXYZabcdefghijklmnopqrstuv', amount: '100' }, a.token);
  assert.equal(w.status, 201);
  assert.equal(await bal(call, a.token, 'USDT'), 10000 - 101, 'amount + 1 USDT fee held');
  const admin = (await call('POST', '/api/auth/register', { email: 'admin@x.io', password: 'password1' })).body.token;
  await call('POST', `/api/admin/withdrawals/${w.body.id}/reject`, {}, admin);
  assert.equal(await bal(call, a.token, 'USDT'), 10000);
  const w2 = await call('POST', '/api/wallet/withdraw', { asset: 'BTC', chain: 'BTC', address: 'bc1qabcdefghijklmnopqrstuvwxyz', amount: '0.01' }, a.token);
  assert.equal((await call('POST', `/api/admin/withdrawals/${w2.body.id}/approve`, { txid: 'abc' }, admin)).status, 200);
  assert.equal((await call('GET', '/api/wallet/withdrawals', null, a.token)).body.withdrawals[0].status, 'sent');
  await call('POST', '/api/admin/wallet/credit', { user_id: a.id, asset: 'ETH', amount: '1.5' }, admin);
  assert.equal(await bal(call, a.token, 'ETH'), 3.5);
  assert.ok((await call('GET', '/api/wallet/history', null, a.token)).body.entries.length >= 5);
  assertConserved(s.db);
});

test('spot order book: limit/market, partial fills, fees, cancel, self-trade', async (t) => {
  const s = await setup(); t.after(s.close);
  const { call } = s;
  const [seller, buyer, third] = await users(call, 3);
  // seller asks 0.05 BTC @ 90000 and 0.05 @ 91000
  const a1 = await call('POST', '/api/spot/BTC_USDT/orders', { side: 'sell', type: 'limit', price: '90000', qty: '0.05' }, seller.token);
  assert.equal(a1.status, 201, JSON.stringify(a1.body));
  await call('POST', '/api/spot/BTC_USDT/orders', { side: 'sell', type: 'limit', price: '91000', qty: '0.05' }, seller.token);
  assert.equal(await bal(call, seller.token, 'BTC'), 0, 'BTC escrowed');
  assert.equal((await call('POST', '/api/spot/BTC_USDT/orders', { side: 'sell', type: 'limit', price: '90000.05', qty: '0.01' }, seller.token)).status, 400, 'tick size');
  // self-trade: seller's own buy must not match own asks
  const self = await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '95000', qty: '0.01' }, seller.token);
  assert.equal(self.body.order.filled, '0');
  await call('DELETE', `/api/spot/BTC_USDT/orders/${self.body.order.id}`, null, seller.token);
  // buyer market-buys 0.08 BTC: 0.05 @ 90000 + 0.03 @ 91000 = 4500 + 2730 = 7230, fee 0.1% = 7.23
  const mb = await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'market', qty: '0.08' }, buyer.token);
  assert.equal(mb.status, 201, JSON.stringify(mb.body));
  assert.equal(mb.body.order.status, 'filled');
  assert.equal(await bal(call, buyer.token, 'BTC'), 0.18);
  assert.equal(await bal(call, buyer.token, 'USDT'), 10000 - 7230 - 7.23);
  assert.equal(await bal(call, seller.token, 'USDT'), 10000 + 7230, 'maker pays no fee');
  const depth = (await call('GET', '/api/spot/BTC_USDT/depth')).body;
  assert.deepEqual(depth.asks, [['91000', '0.02']]);
  // buyer limit-bids above best ask -> taker fill at maker price, rest rests
  const lb = await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '92000', qty: '0.025' }, buyer.token);
  assert.equal(lb.body.order.filled, '0.02');
  assert.equal(lb.body.order.status, 'open');
  // a third user hits that bid as taker and pays the fee
  const sb = await call('POST', '/api/spot/BTC_USDT/orders', { side: 'sell', type: 'market', qty: '0.003' }, third.token);
  assert.equal(sb.status, 201, JSON.stringify(sb.body));
  assert.equal(sb.body.order.status, 'filled');
  assert.equal(await bal(call, third.token, 'USDT'), 10000 + 276 - 0.276);
  // cancel the rest and check refunds keep the ledger exact
  await call('DELETE', `/api/spot/BTC_USDT/orders/${lb.body.order.id}`, null, buyer.token);
  assert.equal((await call('GET', '/api/spot/orders', null, buyer.token)).body.open.length, 0);
  const tk = (await call('GET', '/api/spot/markets')).body.markets.find((m) => m.market === 'BTC_USDT');
  assert.equal(tk.last, '92000');
  assert.ok(num((await call('GET', '/api/admin/stats', null, (await call('POST', '/api/auth/register', { email: 'admin@x.io', password: 'password1' })).body.token)).body.fees_usdt) > 7);
  assertConserved(s.db);
});

test('cards exchange: catalogue, vault ship-in, trade, break, ship-out', async (t) => {
  const s = await setup(); t.after(s.close);
  const { call } = s;
  const [alice, bob] = await users(call, 2);
  const admin = (await call('POST', '/api/auth/register', { email: 'admin@x.io', password: 'password1' })).body.token;
  const cat = (await call('GET', '/api/cards/catalog')).body.games;
  assert.equal(cat.length, 2);
  const series = (await call('GET', `/api/cards/series/${cat[0].series[0].id}`)).body;
  assert.equal(series.products[0].kind, 'box');
  assert.ok(series.products.some((p) => p.grade === 'GRADE 10'));
  const sku = 'AEG-001';
  assert.equal((await call('POST', `/api/cards/products/${sku}/orders`, { side: 'sell', price: '50', qty: 1 }, alice.token)).status, 400, 'owns nothing yet');
  // Alice ships 3 cards + 1 pack into the vault, admin verifies
  const r1 = (await call('POST', '/api/cards/requests', { kind: 'ship_in', sku, qty: 3 }, alice.token)).body.request;
  const r2 = (await call('POST', '/api/cards/requests', { kind: 'ship_in', sku: 'AEG-PACK', qty: 1 }, alice.token)).body.request;
  await call('POST', `/api/admin/cards/requests/${r1.id}/complete`, {}, admin);
  await call('POST', `/api/admin/cards/requests/${r2.id}/complete`, {}, admin);
  assert.equal((await call('GET', '/api/cards/holdings', null, alice.token)).body.holdings.length, 2);
  // Trade: Alice asks 2 @ 80, Bob bids 1 @ 85 -> fills at 80; 3% taker fee on Bob
  await call('POST', `/api/cards/products/${sku}/orders`, { side: 'sell', price: '80', qty: 2 }, alice.token);
  const b = await call('POST', `/api/cards/products/${sku}/orders`, { side: 'buy', price: '85', qty: 1 }, bob.token);
  assert.equal(b.body.order.status, 'filled');
  assert.equal(await bal(call, bob.token, 'USDT'), 10000 - 80 - 2.4);
  assert.equal(await bal(call, alice.token, 'USDT'), 10000 + 80);
  const prod = (await call('GET', `/api/cards/products/${sku}`)).body;
  assert.equal(prod.last, '80');
  assert.deepEqual(prod.depth.asks, [['80', 1]]);
  const bobH = (await call('GET', '/api/cards/holdings', null, bob.token)).body.holdings;
  assert.equal(bobH[0].qty, 1);
  // Alice breaks her sealed pack: staff credit the pulls
  const br = (await call('POST', '/api/cards/requests', { kind: 'break', sku: 'AEG-PACK', qty: 1 }, alice.token)).body.request;
  assert.equal((await call('POST', '/api/cards/requests', { kind: 'break', sku, qty: 1 }, alice.token)).status, 400, 'singles cannot be broken');
  await call('POST', `/api/admin/cards/requests/${br.id}/complete`, { pulls: [{ sku: 'AEG-058', qty: 7 }, { sku: 'AEG-014', qty: 1 }] }, admin);
  const ah = (await call('GET', '/api/cards/holdings', null, alice.token)).body.holdings;
  assert.ok(ah.find((h) => h.sku === 'AEG-058' && h.qty === 7));
  assert.ok(!ah.find((h) => h.sku === 'AEG-PACK'));
  // Bob ships his card out
  const so = (await call('POST', '/api/cards/requests', { kind: 'ship_out', sku, qty: 1, address: '1 Test St' }, bob.token)).body.request;
  assert.equal((await call('POST', `/api/cards/products/${sku}/orders`, { side: 'sell', price: '90', qty: 1 }, bob.token)).status, 400, 'locked while shipping');
  await call('POST', `/api/admin/cards/requests/${so.id}/complete`, { tracking: 'TRK1' }, admin);
  assert.equal((await call('GET', '/api/cards/holdings', null, bob.token)).body.holdings.length, 0);
  assertConserved(s.db);
});

test('perpetuals: open, profit close, liquidation, take-profit', async (t) => {
  const s = await setup(); t.after(s.close);
  const { call, oracle } = s;
  const [u] = await users(call, 1);
  oracle.set('BTC', 100000);
  assert.equal((await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '100', leverage: 500 }, u.token)).status, 400);
  const p = (await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '100', leverage: 10 }, u.token)).body.position;
  assert.ok(p.liq_price < 100000 && p.liq_price > 90000);
  const fee = 1000 * 0.0005;
  assert.equal(await bal(call, u.token, 'USDT'), 10000 - 100 - fee);
  oracle.set('BTC', 105000); // +5% * 10x = ~+50%
  const live = (await call('GET', '/api/perps/positions', null, u.token)).body.positions[0];
  assert.ok(live.roe_pct > 45 && live.roe_pct < 51, String(live.roe_pct));
  const c = (await call('POST', `/api/perps/positions/${p.id}/close`, {}, u.token)).body.position;
  assert.equal(c.status, 'closed');
  assert.ok(num(c.realized_pnl) > 45);
  // short gets liquidated by a 10% pump at 10x
  const sh = (await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'short', margin: '50', leverage: 10 }, u.token)).body.position;
  oracle.set('BTC', 116000);
  await new Promise((r) => setTimeout(r, 20));
  const closed = (await call('GET', '/api/perps/positions?status=closed', null, u.token)).body.positions;
  assert.equal(closed.find((x) => x.id === sh.id).status, 'liquidated');
  // take-profit
  oracle.set('ETH', 3000);
  const tp = (await call('POST', '/api/perps/positions', { symbol: 'ETH', side: 'long', margin: '10', leverage: 5, tp: '3100' }, u.token)).body.position;
  oracle.set('ETH', 3150);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await call('GET', '/api/perps/positions?status=closed', null, u.token)).body.positions.find((x) => x.id === tp.id).status, 'closed');
  assertConserved(s.db);
});

test('options: chain, buy, sell back, cash settlement', async (t) => {
  const s = await setup(); t.after(s.close);
  const { call, oracle, options } = s;
  const [u] = await users(call, 1);
  oracle.set('ETH', 3000);
  const chain = (await call('GET', '/api/options/ETH/chain')).body;
  assert.ok(chain.expiries.length >= 3);
  const exp = chain.expiries[0];
  const atm = exp.rows.find((r) => r.strike === 3000);
  assert.ok(atm.call.ask > atm.call.bid && atm.call.bid >= 0);
  assert.ok(Math.abs(atm.call.delta - 0.5) < 0.1);
  const before = await bal(call, u.token, 'USDT');
  const p = (await call('POST', '/api/options/buy', { symbol: 'ETH', kind: 'call', strike: 3000, expiry: exp.expiry, qty: 1 }, u.token)).body.position;
  assert.ok(num(p.premium) > 0);
  assert.ok(await bal(call, u.token, 'USDT') < before);
  assert.equal((await call('POST', '/api/options/buy', { symbol: 'ETH', kind: 'call', strike: 3001, expiry: exp.expiry, qty: 1 }, u.token)).status, 400, 'unlisted strike');
  // sell one back
  const p2 = (await call('POST', '/api/options/buy', { symbol: 'ETH', kind: 'put', strike: 2900, expiry: exp.expiry, qty: 0.5 }, u.token)).body.position;
  assert.equal((await call('POST', `/api/options/positions/${p2.id}/close`, {}, u.token)).body.position.status, 'closed');
  // settle the call 200 ITM
  oracle.set('ETH', 3200);
  const b0 = await bal(call, u.token, 'USDT');
  await options.settle(new Date(new Date(exp.expiry).getTime() + 1000));
  assert.equal(await bal(call, u.token, 'USDT'), b0 + 200);
  const settled = (await call('GET', '/api/options/positions?status=closed', null, u.token)).body.positions.find((x) => x.id === p.id);
  assert.equal(settled.status, 'settled');
  assertConserved(s.db);
});

test('cloud: UpCloud VM bought from wallet, white-labelled via gateway + VPN', async (t) => {
  const s = await setup({ gateway: true }); t.after(s.close);
  const { call, gateway } = s;
  const [u] = await users(call, 1);
  const plans = (await call('GET', '/api/shop/plans')).body;
  assert.equal(plans.white_label.ssh_host, 'ssh.brand.test');
  assert.equal(plans.plans.find((p) => p.id === 'vm-1').kind, 'vm');
  const co = await call('POST', '/api/shop/checkout', { plan_id: 'vm-1', hostname: 'web1', pay_with: 'wallet' }, u.token);
  assert.equal(co.status, 200, JSON.stringify(co.body));
  assert.equal(await bal(call, u.token, 'USDT'), 10000 - 9);
  const ord = (await call('GET', `/api/shop/orders/${co.body.order_id}`, null, u.token)).body;
  const d = await waitActive(call, ord.server.id, u.token);
  assert.equal(d.server.provider_kind, 'vm');
  assert.equal(d.server.ssh.host, 'ssh.brand.test', 'customers only see our hostname');
  assert.equal(d.server.ssh.port, 40000);
  assert.equal(d.server.web_url, `https://web1-${d.server.id}.apps.brand.test`);
  assert.match(d.server.private_ip, /^10\.88\./);
  const route = gateway.routes.get(`s${d.server.id}`);
  assert.equal(route.target_ip, d.server.private_ip);
  // custom domain
  assert.equal((await call('PUT', `/api/servers/${d.server.id}/domain`, { domain: 'not a domain' }, u.token)).status, 400);
  await call('PUT', `/api/servers/${d.server.id}/domain`, { domain: 'shop.customer.com' }, u.token);
  assert.equal(gateway.routes.get(`s${d.server.id}`).custom_domain, 'shop.customer.com');
  // VPN
  const conf = (await call('POST', '/api/vpn/config', {}, u.token)).body.config;
  assert.match(conf, /\[Interface\]\nPrivateKey = [A-Za-z0-9+/]{43}=/);
  assert.match(conf, new RegExp(`AllowedIPs = ${d.server.private_ip.replace(/\./g, '\\.')}/32`));
  assert.deepEqual(gateway.peers.get(`u${u.id}`).allowed, [d.server.private_ip]);
  // insufficient wallet funds
  assert.equal((await call('POST', '/api/shop/checkout', { plan_id: 'vm-8', pay_with: 'wallet' }, (await call('POST', '/api/auth/register', { email: 'broke@t.io', password: 'password1' })).body.token)).status, 400);
  // container -> VM upgrade is refused
  const free = (await call('POST', '/api/servers/free', {}, u.token)).body.server;
  await waitActive(call, free.id, u.token);
  assert.equal((await call('POST', '/api/shop/checkout', { kind: 'upgrade', server_id: free.id, plan_id: 'vm-2', pay_with: 'wallet' }, u.token)).status, 400);
  // deleting removes the gateway route and VPN access
  await call('DELETE', `/api/servers/${d.server.id}`, null, u.token);
  assert.ok(!gateway.routes.has(`s${d.server.id}`));
  assert.deepEqual(gateway.peers.get(`u${u.id}`).allowed, ['10.77.0.2']);
  assertConserved(s.db);
});
