/**
 * GET /api/availability — live room availability ("the diary") from Cloudbeds.
 *
 * Cloudflare Pages Function. It runs on Cloudflare's servers, never in the browser,
 * so the Cloudbeds API key stays secret.
 *
 * Configuration (Cloudflare Pages → Settings → Variables and Secrets):
 *   CLOUDBEDS_API_KEY      secret, a property API key starting "cbat_" with read:rate scope
 *   CLOUDBEDS_PROPERTY_ID  numeric Cloudbeds property ID (default below)
 *
 * Query: ?start=YYYY-MM-DD&days=14   (days 1–21; defaults: today, 14)
 * Response: { start, end, currency, generatedAt, rooms: [{ id, name, days: [{ date, available, rate, closedToArrival, closedToDeparture, minStay }] }] }
 *   `end` is exclusive (the morning after the last night shown).
 *
 * Cloudbeds is always asked for fixed, aligned blocks of nights, cached at the edge, so callers
 * can't multiply upstream calls by varying start/days. If Cloudbeds is busy or failing, the last
 * good copy (up to an hour old) is served instead.
 *
 * Cloudbeds API reference: https://developers.cloudbeds.com/reference (GET /getRatePlans, v1.3)
 */

const API_BASE = "https://api.cloudbeds.com/api/v1.3";
const DEFAULT_PROPERTY_ID = "141393122377981";
const CACHE_SECONDS = 300; // fresh copy
const STALE_SECONDS = 3600; // fallback copy if Cloudbeds is busy or failing
const MAX_DAYS = 21;
const BLOCK_DAYS = 21; // upstream requests cover two aligned blocks (42 nights)
const MAX_AHEAD_DAYS = 540;

// Public room types sold on the website, in display order. Other room types
// (for example corporate allocations) are never returned.
export const ROOM_TYPES = [
  { id: "148837309972637", name: "Single Room" },
  { id: "148838930526405", name: "Twin Room" },
  { id: "148839795253447", name: "Double Room" },
  { id: "158032272887993", name: "Family Room" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign(
      { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" },
      extraHeaders || {}
    ),
  });
}

function parseISODate(s) {
  if (!DATE_RE.test(s || "")) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

function truthy(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn a Cloudbeds getRatePlans response into one row per public room type with
 * one entry per night: rooms left, the lowest public nightly price, and restrictions.
 */
export function summarise(apiData, startISO, endISO) {
  const wanted = new Map(ROOM_TYPES.map((r) => [r.id, r]));
  const dates = [];
  for (let d = parseISODate(startISO); isoDate(d) < endISO; d = addDays(d, 1)) dates.push(isoDate(d));

  const rows = new Map(
    ROOM_TYPES.map((r) => [
      r.id,
      new Map(dates.map((date) => [date, {
        date, available: 0, rate: null, closedToArrival: false, closedToDeparture: false, minStay: null, _rank: 0,
      }])),
    ])
  );

  for (const plan of Array.isArray(apiData) ? apiData : []) {
    const roomTypeID = String(plan && plan.roomTypeID);
    if (!wanted.has(roomTypeID)) continue;
    // Promo-code-only rates are excluded by the request; skip any that slip through.
    if (plan.promoCode) continue;
    const rank = truthy(plan.isDerived) ? 1 : 2;
    for (const day of Array.isArray(plan.roomRateDetailed) ? plan.roomRateDetailed : []) {
      const cell = rows.get(roomTypeID).get(day && day.date);
      if (!cell) continue;
      const available = Math.max(0, num(day.roomsAvailable) || 0);
      const free = truthy(day.blocked) ? 0 : available;
      // Availability is shared by every rate plan of a room type: take the largest figure.
      cell.available = Math.max(cell.available, free);

      // Restrictions come from the base (non-derived) plans when present, otherwise from the
      // derived ones. Across several plans of the same kind the result doesn't depend on their
      // order: a night is closed only if every plan closes it, and the shortest minimum stay wins.
      const cta = truthy(day.closedToArrival);
      const ctd = truthy(day.closedToDeparture);
      const minLos = num(day.minLos);
      const minStay = minLos && minLos > 1 ? minLos : null;
      if (rank > cell._rank) {
        cell._rank = rank;
        cell.closedToArrival = cta;
        cell.closedToDeparture = ctd;
        cell.minStay = minStay;
      } else if (rank === cell._rank) {
        cell.closedToArrival = cell.closedToArrival && cta;
        cell.closedToDeparture = cell.closedToDeparture && ctd;
        cell.minStay = cell.minStay === null || minStay === null ? null : Math.min(cell.minStay, minStay);
      }

      const price = num(day.totalRate) !== null ? num(day.totalRate) : num(day.rateBase);
      if (free > 0 && price !== null && price > 0) {
        cell.rate = cell.rate === null ? price : Math.min(cell.rate, price);
      }
    }
  }

  return ROOM_TYPES.map((r) => ({
    id: r.id,
    name: r.name,
    days: dates.map((date) => {
      const { _rank, ...cell } = rows.get(r.id).get(date);
      if (cell.rate !== null) cell.rate = Math.round(cell.rate * 100) / 100;
      return cell;
    }),
  }));
}

/** The aligned upstream block that covers [start, start + MAX_DAYS). */
export function blockFor(start, today) {
  const base = addDays(today, -1);
  const offset = Math.round((start - base) / 86400000);
  const blockStart = addDays(base, Math.floor(offset / BLOCK_DAYS) * BLOCK_DAYS);
  return { startISO: isoDate(blockStart), endISO: isoDate(addDays(blockStart, 2 * BLOCK_DAYS)) };
}

async function fetchBlock(env, block) {
  const propertyId = (env && env.CLOUDBEDS_PROPERTY_ID) || DEFAULT_PROPERTY_ID;
  const query = new URLSearchParams({
    propertyIDs: propertyId,
    startDate: block.startISO,
    endDate: block.endISO,
    roomTypeID: ROOM_TYPES.map((r) => r.id).join(","),
    detailedRates: "true",
    includePromoCode: "false",
  });
  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/getRatePlans?${query}`, {
      headers: { "x-api-key": env.CLOUDBEDS_API_KEY, "X-PROPERTY-ID": propertyId, Accept: "application/json" },
    });
  } catch (err) {
    return { error: "upstream_unreachable", status: 502 };
  }
  if (upstream.status === 429) {
    return { error: "busy", status: 503, retryAfter: upstream.headers.get("Retry-After") || "10" };
  }
  const body = await upstream.json().catch(() => null);
  if (!upstream.ok || !body || body.success !== true) {
    // Never echo Cloudbeds' error text: it can include account details.
    return { error: "upstream_error", status: 502, upstreamStatus: upstream.status };
  }
  return { summary: { generatedAt: new Date().toISOString(), rooms: summarise(body.data, block.startISO, block.endISO) } };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env || !env.CLOUDBEDS_API_KEY) return json({ error: "not_configured" }, 503, { "Cache-Control": "no-store" });

  const url = new URL(request.url);
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const start = url.searchParams.has("start") ? parseISODate(url.searchParams.get("start")) : today;
  const days = url.searchParams.has("days") ? Number(url.searchParams.get("days")) : 14;
  if (!start) return json({ error: "bad_request", detail: "start must be a date in YYYY-MM-DD format" }, 400);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return json({ error: "bad_request", detail: `days must be a whole number from 1 to ${MAX_DAYS}` }, 400);
  }
  if (start < addDays(today, -1) || start > addDays(today, MAX_AHEAD_DAYS)) {
    return json({ error: "bad_request", detail: "start must be between today and 18 months ahead" }, 400);
  }
  const startISO = isoDate(start);
  const endISO = isoDate(addDays(start, days));
  const block = blockFor(start, today);

  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const freshKey = new Request(`${url.origin}/api/availability/_block?from=${block.startISO}&to=${block.endISO}`);
  const staleKey = new Request(`${url.origin}/api/availability/_stale?from=${block.startISO}&to=${block.endISO}`);
  const read = async (key) => {
    if (!cache) return null;
    const hit = await cache.match(key);
    return hit ? hit.json().catch(() => null) : null;
  };

  let summary = await read(freshKey);
  let stale = false;
  if (!summary) {
    const result = await fetchBlock(env, block);
    if (result.summary) {
      summary = result.summary;
      if (cache) {
        const stores = Promise.all([
          cache.put(freshKey, json(summary, 200, { "Cache-Control": `public, max-age=${CACHE_SECONDS}` })),
          cache.put(staleKey, json(summary, 200, { "Cache-Control": `public, max-age=${STALE_SECONDS}` })),
        ]);
        if (context.waitUntil) context.waitUntil(stores); else await stores;
      }
    } else {
      summary = await read(staleKey);
      stale = Boolean(summary);
      if (!summary) {
        const headers = { "Cache-Control": "no-store" };
        if (result.retryAfter) headers["Retry-After"] = result.retryAfter;
        const body = { error: result.error };
        if (result.upstreamStatus) body.status = result.upstreamStatus;
        return json(body, result.status, headers);
      }
    }
  }

  return json(
    {
      start: startISO,
      end: endISO,
      currency: (env && env.CURRENCY) || "GBP",
      generatedAt: summary.generatedAt,
      stale,
      rooms: summary.rooms.map((r) => ({ ...r, days: r.days.filter((d) => d.date >= startISO && d.date < endISO) })),
    },
    200,
    { "Cache-Control": stale ? "no-store" : `public, max-age=${CACHE_SECONDS}` }
  );
}

export async function onRequest(context) {
  if (context.request.method === "GET" || context.request.method === "HEAD") return onRequestGet(context);
  return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
}
