'use strict';
/**
 * Limits engine: per-KYC-tier caps on withdrawals (rolling 24h / 30d in USD),
 * open perpetuals notional, open options premium, cloud spend (rolling 30d) and
 * card order size. Usage is computed from the core tables (withdrawals,
 * perp_positions, option_positions, orders) – nothing is double-booked.
 *
 * References:
 *  - FATF Guidance for a risk-based approach to virtual assets and VASPs (2021), tiered /
 *    risk-based CDD: https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html
 *  - EU AMLR (Reg. (EU) 2024/1624) – simplified due diligence thresholds for low-risk relationships:
 *    https://eur-lex.europa.eu/eli/reg/2024/1624/oj
 */
const { HttpError } = require('../../provisioner');

/** Default tier table (USD). null = unlimited. Operators tune these with COMPLIANCE_TIERS / settings `compliance.tiers`. */
const DEFAULT_TIERS = {
  0: { label: 'Unverified', withdraw_daily_usd: 2000, withdraw_monthly_usd: 5000, perps_notional_usd: 2000, options_premium_usd: 500, cloud_monthly_usd: 200, card_order_usd: 500 },
  1: { label: 'Basic', withdraw_daily_usd: 10000, withdraw_monthly_usd: 50000, perps_notional_usd: 25000, options_premium_usd: 5000, cloud_monthly_usd: 2000, card_order_usd: 5000 },
  2: { label: 'Verified', withdraw_daily_usd: 50000, withdraw_monthly_usd: 250000, perps_notional_usd: 50000, options_premium_usd: 10000, cloud_monthly_usd: 10000, card_order_usd: 25000 },
  3: { label: 'Enhanced', withdraw_daily_usd: 500000, withdraw_monthly_usd: 2000000, perps_notional_usd: 250000, options_premium_usd: 50000, cloud_monthly_usd: 100000, card_order_usd: 250000 },
};
const LIMIT_KEYS = ['withdraw_daily_usd', 'withdraw_monthly_usd', 'perps_notional_usd', 'options_premium_usd', 'cloud_monthly_usd', 'card_order_usd'];
const TIERS = [0, 1, 2, 3];

/** Validate/normalise a tier table coming from env JSON or settings; unknown keys dropped, invalid numbers ignored. */
function normalizeTiers(input, base = DEFAULT_TIERS) {
  const out = {};
  for (const t of TIERS) {
    const b = base[t] || DEFAULT_TIERS[t];
    const o = (input && typeof input === 'object' && (input[t] || input[String(t)])) || {};
    const row = { label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : b.label };
    for (const k of LIMIT_KEYS) {
      const v = o[k];
      if (v === null) row[k] = null;
      else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) row[k] = v;
      else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0) row[k] = Number(v);
      else row[k] = b[k];
    }
    out[t] = row;
  }
  return out;
}

/** config tiers with the optional settings override applied on top. */
function effectiveTiers(configTiers, settingsValue) {
  const base = normalizeTiers(configTiers);
  if (!settingsValue) return base;
  try {
    const sv = typeof settingsValue === 'string' ? JSON.parse(settingsValue) : settingsValue;
    return normalizeTiers(sv, base);
  } catch { return base; }
}

const ACTIONS = {
  withdraw: { label: 'withdrawal', windows: [['withdraw_daily_usd', 'daily', 'in the last 24 hours'], ['withdraw_monthly_usd', 'monthly', 'in the last 30 days']] },
  perps: { label: 'futures position', windows: [['perps_notional_usd', 'open', 'in open positions']] },
  options: { label: 'options premium', windows: [['options_premium_usd', 'open', 'in open positions']] },
  cloud: { label: 'cloud spend', windows: [['cloud_monthly_usd', 'monthly', 'in the last 30 days']] },
  cards: { label: 'card order', windows: [['card_order_usd', 'order', 'per order']] },
  spot: { label: 'spot order', windows: [] },
  trade: { label: 'order', windows: [] },
};

const usd = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

class Limits {
  /**
   * @param {{ db, config, tiersProvider: () => object, usdValue: (asset, units) => number, tierOf: (userId) => number }} deps
   */
  constructor({ db, tiersProvider, usdValue, tierOf }) {
    this.db = db; this.tiersProvider = tiersProvider; this.usdValue = usdValue; this.tierOf = tierOf;
  }

  tiers() { return this.tiersProvider(); }
  tierLimits(tier) { const t = this.tiers(); return t[tier] || t[0]; }

  /** Current usage for every limited window, in USD. */
  usage(userId) {
    const w = (since) => this.db.prepare(`SELECT asset, COALESCE(SUM(amount),0) n FROM withdrawals WHERE user_id=? AND status!='rejected' AND created_at >= datetime('now', ?) GROUP BY asset`).all(userId, since)
      .reduce((sum, r) => sum + this.usdValue(r.asset, r.n, { lenient: true }), 0);
    const perps = this.db.prepare("SELECT COALESCE(SUM(qty*entry),0) n FROM perp_positions WHERE user_id=? AND status='open'").get(userId).n;
    const options = this.db.prepare("SELECT COALESCE(SUM(premium),0) n FROM option_positions WHERE user_id=? AND status='open'").get(userId).n / 1e8;
    const cloud = this.db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM orders WHERE user_id=? AND status IN ('pending','fulfilled') AND created_at >= datetime('now','-30 day')").get(userId).n / 100;
    return { withdraw_daily_usd: w('-1 day'), withdraw_monthly_usd: w('-30 day'), perps_notional_usd: perps, options_premium_usd: options, cloud_monthly_usd: cloud, card_order_usd: 0 };
  }

  /** Limits + usage summary for the UI. */
  summary(userId) {
    const tier = this.tierOf(userId);
    const tiers = this.tiers();
    const limits = tiers[tier] || tiers[0];
    const usage = this.usage(userId);
    const rows = LIMIT_KEYS.map((k) => ({ key: k, limit: limits[k], used: Math.round(usage[k] * 100) / 100, remaining: limits[k] === null ? null : Math.max(0, Math.round((limits[k] - usage[k]) * 100) / 100) }));
    return { tier, label: limits.label, limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, limits[k]])), usage, rows, tiers: TIERS.map((t) => ({ tier: t, ...tiers[t] })) };
  }

  /** Lowest tier above `tier` whose cap fits `needed`, or null when no tier does. */
  tierRequired(key, tier, needed) {
    const tiers = this.tiers();
    for (const t of TIERS) if (t > tier && (tiers[t][key] === null || tiers[t][key] >= needed)) return t;
    return null;
  }

  /**
   * Throws HttpError(403, ..., { code: 'LIMIT_EXCEEDED', data }) when `amountUsd` would push the user over a cap.
   * Actions: withdraw | perps | options | cloud | cards | spot | trade
   */
  check(userId, action, amountUsd) {
    const def = ACTIONS[action];
    if (!def) throw new HttpError(400, `Unknown compliance action ${action}`);
    const amount = Number(amountUsd);
    if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'Invalid amount');
    if (!def.windows.length) return { ok: true, action };
    const tier = this.tierOf(userId);
    const limits = this.tierLimits(tier);
    const usage = def.windows.some(([k]) => k !== 'card_order_usd') ? this.usage(userId) : { card_order_usd: 0 };
    for (const [key, win, phrase] of def.windows) {
      const limit = limits[key];
      if (limit === null) continue;
      const used = usage[key] || 0;
      if (used + amount > limit + 1e-9) {
        const tierRequired = this.tierRequired(key, tier, used + amount);
        const hint = tierRequired !== null ? ` Verify your identity (tier ${tierRequired}) to raise it.` : ' Contact support to raise it.';
        const msg = win === 'order'
          ? `Maximum ${def.label} size for your verification level is ${usd(limit)}.${hint}`
          : `Your ${win === 'open' ? '' : win + ' '}${def.label} limit of ${usd(limit)} would be exceeded (${usd(used)} used ${phrase}).${hint}`;
        // 400 (not 403): the request itself can be fixed by lowering the amount or verifying; clients key on `code`.
        throw new HttpError(400, msg, { code: 'LIMIT_EXCEEDED', data: { action, window: win, key, limit, used: Math.round(used * 100) / 100, requested: Math.round(amount * 100) / 100, tier, tier_required: tierRequired } });
      }
    }
    return { ok: true, action, tier };
  }
}

module.exports = { Limits, DEFAULT_TIERS, LIMIT_KEYS, TIERS, normalizeTiers, effectiveTiers, ACTIONS };
