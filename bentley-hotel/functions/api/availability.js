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
 * Query: ?start=YYYY-MM-DD&days=14   (days 1–62; defaults: today, 14)
 * Response: { start, end, currency, generatedAt, rooms: [{ id, name, days: [{ date, available, rate, closedToArrival, closedToDeparture, minStay }] }] }
 *   `end` is exclusive (the morning after the last night shown).
 *
 * Cloudbeds API reference: https://developers.cloudbeds.com/reference (GET /getRatePlans, v1.3)
 */

const API_BASE = "https://api.cloudbeds.com/api/v1.3";
const DEFAULT_PROPERTY_ID = "141393122377981";
const CACHE_SECONDS = 300;
const MAX_DAYS = 62;

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
        date, available: 0, rate: null, closedToArrival: false, closedToDeparture: false, minStay: null, _base: false,
      }])),
    ])
  );

  for (const plan of Array.isArray(apiData) ? apiData : []) {
    const roomTypeID = String(plan && plan.roomTypeID);
    if (!wanted.has(roomTypeID)) continue;
    // Promo-code-only rates are excluded by the request; skip any that slip through.
    if (plan.promoCode) continue;
    const isBase = !truthy(plan.isDerived);
    for (const day of Array.isArray(plan.roomRateDetailed) ? plan.roomRateDetailed : []) {
      const cell = rows.get(roomTypeID).get(day && day.date);
      if (!cell) continue;
      const available = Math.max(0, num(day.roomsAvailable) || 0);
      const blocked = truthy(day.blocked);
      const free = blocked ? 0 : available;
      // Availability is shared by every rate plan of a room type: take the largest figure.
      cell.available = Math.max(cell.available, free);
      // Restrictions come from the base rate when present, otherwise from the first plan seen.
      if (isBase || !cell._base) {
        cell.closedToArrival = truthy(day.closedToArrival);
        cell.closedToDeparture = truthy(day.closedToDeparture);
        const minLos = num(day.minLos);
        cell.minStay = minLos && minLos > 1 ? minLos : null;
        if (isBase) cell._base = true;
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
      const { _base, ...cell } = rows.get(r.id).get(date);
      if (cell.rate !== null) cell.rate = Math.round(cell.rate * 100) / 100;
      return cell;
    }),
  }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const apiKey = env && env.CLOUDBEDS_API_KEY;
  if (!apiKey) return json({ error: "not_configured" }, 503, { "Cache-Control": "no-store" });

  const url = new URL(request.url);
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const start = url.searchParams.has("start") ? parseISODate(url.searchParams.get("start")) : today;
  const days = url.searchParams.has("days") ? Number(url.searchParams.get("days")) : 14;
  if (!start) return json({ error: "bad_request", detail: "start must be a date in YYYY-MM-DD format" }, 400);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return json({ error: "bad_request", detail: `days must be a whole number from 1 to ${MAX_DAYS}` }, 400);
  }
  if (start < addDays(today, -1) || start > addDays(today, 540)) {
    return json({ error: "bad_request", detail: "start must be between today and 18 months ahead" }, 400);
  }
  const startISO = isoDate(start);
  const endISO = isoDate(addDays(start, days));

  // Serve repeated requests from Cloudflare's edge cache (protects the Cloudbeds rate limit).
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(`${url.origin}/api/availability?start=${startISO}&days=${days}`, { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const propertyId = (env && env.CLOUDBEDS_PROPERTY_ID) || DEFAULT_PROPERTY_ID;
  const query = new URLSearchParams({
    propertyIDs: propertyId,
    startDate: startISO,
    endDate: endISO,
    roomTypeID: ROOM_TYPES.map((r) => r.id).join(","),
    detailedRates: "true",
    includePromoCode: "false",
  });

  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/getRatePlans?${query}`, {
      headers: { "x-api-key": apiKey, "X-PROPERTY-ID": propertyId, Accept: "application/json" },
    });
  } catch (err) {
    return json({ error: "upstream_unreachable" }, 502, { "Cache-Control": "no-store" });
  }
  if (upstream.status === 429) {
    return json({ error: "busy" }, 503, { "Retry-After": upstream.headers.get("Retry-After") || "10", "Cache-Control": "no-store" });
  }
  const body = await upstream.json().catch(() => null);
  if (!upstream.ok || !body || body.success !== true) {
    // Never echo Cloudbeds' error text: it can include account details.
    return json({ error: "upstream_error", status: upstream.status }, 502, { "Cache-Control": "no-store" });
  }

  const response = json(
    {
      start: startISO,
      end: endISO,
      currency: (env && env.CURRENCY) || "GBP",
      generatedAt: new Date().toISOString(),
      rooms: summarise(body.data, startISO, endISO),
    },
    200,
    { "Cache-Control": `public, max-age=${CACHE_SECONDS}` }
  );
  if (cache) {
    const store = cache.put(cacheKey, response.clone());
    if (context.waitUntil) context.waitUntil(store); else await store;
  }
  return response;
}

export async function onRequest(context) {
  if (context.request.method === "GET" || context.request.method === "HEAD") return onRequestGet(context);
  return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
}
