'use strict';
const express = require('express');
const { HttpError } = require('../provisioner');

module.exports = function shopRoutes({ db, config, auth, prov, stripe, wallet }) {
  const r = express.Router();

  const publicPlan = (p) => ({
    id: p.id, name: p.name, cores: p.cores, cpulimit: p.cpulimit, memory_mb: p.memory_mb, swap_mb: p.swap_mb,
    disk_gb: p.disk_gb, net_rate_mbps: p.net_rate_mbps, price_cents: p.price_cents, days: p.days, is_free: p.price_cents === 0, kind: p.provider === 'upcloud' ? 'vm' : 'container',
  });

  r.get('/plans', (req, res) => {
    const plans = db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY sort').all();
    res.json({ plans: plans.map(publicPlan), free: { ...config.free }, currency: 'usd', brand: config.brand, white_label: { gateway: !!prov.gateway, ssh_host: prov.gateway ? config.gateway.publicHost : null, apps_domain: prov.gateway ? config.gateway.appsDomain : null } });
  });

  r.post('/checkout', auth.requireAuth, async (req, res) => {
    const body = req.body;
    const kind = body.kind || 'new';
    if (!['new', 'renew', 'upgrade'].includes(kind)) throw new HttpError(400, 'Bad order kind');
    let plan = kind === 'renew' ? null : prov.plan(String(body.plan_id || ''));
    let serverId = null;
    let meta = null;

    if (kind === 'new') {
      if (plan.price_cents === 0) throw new HttpError(400, 'The free plan does not need checkout');
      meta = JSON.stringify({ hostname: body.hostname || undefined, sshKey: body.ssh_key || undefined });
      // Validate early so users don't pay for a server that cannot be created.
      if (body.hostname && !/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(String(body.hostname).toLowerCase())) throw new HttpError(400, 'Invalid hostname');
    } else {
      const s = prov.server(Number(body.server_id));
      if (!s || s.user_id !== req.user.id || ['deleted', 'deleting', 'provisioning'].includes(s.state)) throw new HttpError(404, 'Server not found');
      const current = prov.plan(s.plan_id);
      if (kind === 'renew') {
        if (current.price_cents === 0) throw new HttpError(400, 'Free servers are extended by watching ads – or upgrade them!');
        plan = current;
      } else if (plan.price_cents <= current.price_cents) {
        throw new HttpError(400, 'Pick a bigger plan to upgrade');
      } else if (plan.provider !== current.provider) {
        throw new HttpError(400, 'Containers can only be upgraded to container plans, and VMs to VM plans');
      }
      serverId = s.id;
    }

    // Upgrading a paid server mid-term: charge only the price difference.
    let amount = plan.price_cents;
    if (kind === 'upgrade') amount = Math.max(50, plan.price_cents - prov.plan(prov.server(serverId).plan_id).price_cents);

    const payWith = body.pay_with === 'wallet' ? 'wallet' : 'card';
    const info = db.prepare('INSERT INTO orders (user_id, plan_id, server_id, kind, amount_cents, meta, pay_with) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, plan.id, serverId, kind, amount, meta, payWith);
    const orderId = Number(info.lastInsertRowid);

    // Pay from the unified wallet (USDT, 1 USDT = 1 USD).
    if (payWith === 'wallet') {
      try {
        await wallet.transfer({ src: `u:${req.user.id}`, dst: 'sys:cloud', asset: 'USDT', amount: amount * 1e6, kind: 'cloud', ref: `order #${orderId}` });
      } catch (e) {
        db.prepare("UPDATE orders SET status='failed' WHERE id=?").run(orderId);
        throw e;
      }
      const o = await prov.fulfillOrder(orderId);
      if (o.status === 'failed') await wallet.payout({ src: 'sys:cloud', dst: `u:${req.user.id}`, asset: 'USDT', amount: amount * 1e6, kind: 'cloud_refund', ref: `order #${orderId}` });
      return res.json({ order_id: orderId, paid: true, status: o.status });
    }
    // Mobile apps pass their deep link (e.g. tinybox://order); web uses PUBLIC_URL.
    // http(s) return URLs are only accepted on our own domain (no open redirects).
    const ru = typeof body.return_url === 'string' ? body.return_url : '';
    const okReturn = /^[a-z][a-z0-9+.-]*:\/\//i.test(ru) && (!/^https?:/i.test(ru) || ru.startsWith(config.publicUrl + '/'));
    const returnBase = okReturn ? ru : `${config.publicUrl}/#/order`;

    if (!stripe) {
      // Mock checkout for development: fulfil immediately.
      await prov.fulfillOrder(orderId);
      return res.json({ order_id: orderId, url: `${returnBase}?order=${orderId}`, mock: true });
    }

    const label = kind === 'new' ? `${plan.name} server – ${plan.days} days` : kind === 'renew' ? `Renew ${plan.name} – ${plan.days} days` : `Upgrade to ${plan.name}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: req.user.email,
      client_reference_id: String(orderId),
      metadata: { order_id: String(orderId) },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd', unit_amount: amount,
          product_data: { name: `${config.brand}: ${label}`, description: `${plan.cores} vCPU · ${plan.memory_mb} MB RAM · ${plan.disk_gb} GB disk` },
        },
      }],
      success_url: `${returnBase}?order=${orderId}`,
      cancel_url: `${returnBase}?order=${orderId}&cancelled=1`,
    });
    db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run(session.id, orderId);
    res.json({ order_id: orderId, url: session.url });
  });

  r.get('/orders', auth.requireAuth, (req, res) => {
    const rows = db.prepare('SELECT id, plan_id, server_id, kind, amount_cents, status, created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id);
    res.json({ orders: rows });
  });

  r.get('/orders/:id', auth.requireAuth, (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
    if (!o) throw new HttpError(404, 'Order not found');
    // Root password for new servers is revealed exactly once.
    const pw = o.root_password_once;
    if (pw) db.prepare('UPDATE orders SET root_password_once=NULL WHERE id=?').run(o.id);
    const server = o.server_id ? prov.server(o.server_id) : null;
    res.json({
      order: { id: o.id, plan_id: o.plan_id, kind: o.kind, amount_cents: o.amount_cents, status: o.status, server_id: o.server_id },
      server: server ? prov.present(server) : null,
      root_password: pw || null,
    });
  });

  return r;
};

/** Stripe webhook needs the raw body, so it is mounted separately before express.json(). */
module.exports.webhook = function stripeWebhook({ db, config, prov, stripe }) {
  return async (req, res) => {
    if (!stripe) return res.status(404).end();
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
    } catch (e) {
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id=?').get(session.id);
        if (order) await prov.fulfillOrder(order.id);
      }
    }
    res.json({ received: true });
  };
};
