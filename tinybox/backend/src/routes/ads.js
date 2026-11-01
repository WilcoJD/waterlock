'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { HttpError } = require('../provisioner');
const { verifySsv } = require('../admob-ssv');

module.exports = function adRoutes({ db, config, auth, prov, log = console, ssvKeys }) {
  const r = express.Router();

  const adsToday = (userId) => db.prepare("SELECT COUNT(*) n FROM ad_rewards WHERE user_id=? AND created_at >= datetime('now','-1 day')").get(userId).n;

  /** Grant a reward. Returns new expiry or throws HttpError. Idempotent per transaction id. */
  function grant({ userId, serverId, transactionId, source }) {
    const s = prov.server(serverId);
    if (!s || s.user_id !== userId || !['active', 'provisioning'].includes(s.state)) throw new HttpError(404, 'Server not found');
    if (prov.plan(s.plan_id).price_cents !== 0) throw new HttpError(400, 'Ads only extend free servers');
    if (adsToday(userId) >= config.free.maxAdsPerDay) throw new HttpError(429, 'Daily ad limit reached – come back tomorrow or upgrade!');
    try {
      db.prepare('INSERT INTO ad_rewards (user_id, server_id, transaction_id, source) VALUES (?,?,?,?)').run(userId, serverId, transactionId, source);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return { duplicate: true };
      throw e;
    }
    return { expires_at: prov.extendFree(s, config.free.hoursPerAd).toISOString() };
  }

  // Called by Google's servers, not by the app.
  r.get('/admob-ssv', async (req, res) => {
    const raw = req.originalUrl.split('?')[1] || '';
    if (!raw) return res.status(200).send('ok'); // AdMob console "verify URL" ping
    let params;
    try {
      params = await verifySsv(raw, ssvKeys);
    } catch (e) {
      log.warn?.('[ssv] rejected:', e.message);
      return res.status(400).send('invalid');
    }
    if (config.admob.adUnitIds.length && !config.admob.adUnitIds.includes(params.get('ad_unit'))) return res.status(400).send('unit');
    try {
      grant({
        userId: Number(params.get('user_id')),
        serverId: Number(params.get('custom_data')),
        transactionId: 'admob:' + params.get('transaction_id'),
        source: 'admob',
      });
    } catch (e) {
      // Still 200 so AdMob doesn't retry forever on a business-rule rejection.
      log.warn?.('[ssv] not granted:', e.message);
    }
    res.status(200).send('ok');
  });

  r.get('/status', auth.requireAuth, (req, res) => {
    const used = adsToday(req.user.id);
    res.json({ ads_today: used, max_per_day: config.free.maxAdsPerDay, remaining: Math.max(0, config.free.maxAdsPerDay - used), hours_per_ad: config.free.hoursPerAd, max_hours_ahead: config.free.maxHoursAhead, dev_rewards: config.admob.allowDevRewards });
  });

  // Development / web-demo only: reward without a verified ad view.
  r.post('/dev-reward', auth.requireAuth, (req, res) => {
    if (!config.admob.allowDevRewards) throw new HttpError(403, 'Disabled');
    const out = grant({ userId: req.user.id, serverId: Number(req.body.server_id), transactionId: 'dev:' + crypto.randomUUID(), source: 'dev' });
    res.json(out);
  });

  return r;
};
