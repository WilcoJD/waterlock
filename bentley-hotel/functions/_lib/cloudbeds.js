/**
 * Cloudbeds integration for the Bentley Hotel site.
 *
 *  - fetchReservation / syncReservations: pull reservations into the bookings register (nightly sync and on demand)
 *  - handleWebhook: Cloudbeds posts reservation/created and reservation/status_changed events to /api/cloudbeds/webhook
 *  - registerWebhooks / listWebhooks / removeWebhooks: manage the Cloudbeds webhook subscriptions from the admin
 *  - reportBooking: send a GA4 Measurement Protocol "purchase" (or custom) event for a confirmed booking
 *
 * Secrets (never in code): CLOUDBEDS_API_KEY (read:reservation, read:hotel; write:webhook? for registering),
 * CLOUDBEDS_WEBHOOK_SECRET (any long random string; sent back by Cloudbeds in the X-Webhook-Secret header),
 * GA4_API_SECRET (from GA4 → Admin → Data streams → Measurement Protocol API secrets), SYNC_SECRET or CRON_SECRET.
 * Cloudbeds API: https://developers.cloudbeds.com/reference (v1.3)
 */
import * as db from "./db.js";

const API = "https://api.cloudbeds.com/api/v1.3";
const DEFAULT_PROPERTY_ID = "141393122377981";
const LIVE_STATUSES = new Set(["confirmed", "checked_in", "checked_out"]);

export function cloudbedsConfigured(env) { return Boolean(env && env.CLOUDBEDS_API_KEY); }
export function ga4Configured(env, site) { return Boolean(env && env.GA4_API_SECRET && site && site.ga4_measurement_id); }
const propertyId = (env) => (env && env.CLOUDBEDS_PROPERTY_ID) || DEFAULT_PROPERTY_ID;

async function cbRequest(env, method, params = {}, { post = false } = {}) {
  if (!cloudbedsConfigured(env)) throw new Error("Cloudbeds API key is not configured (CLOUDBEDS_API_KEY)");
  const headers = { "x-api-key": env.CLOUDBEDS_API_KEY, "X-PROPERTY-ID": propertyId(env), Accept: "application/json" };
  let url = `${API}/${method}`, body;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  if (post) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = q.toString(); } else if ([...q].length) url += "?" + q.toString();
  const res = await fetch(url, { method: post ? "POST" : "GET", headers, body });
  const data = await res.json().catch(() => null);
  if (res.status === 429) throw new Error("Cloudbeds is rate-limiting requests; try again in a minute");
  if (!res.ok || !data || data.success === false) {
    const msg = data && (data.message || data.error_description || data.error) ? String(data.message || data.error_description || data.error) : `HTTP ${res.status}`;
    throw new Error(`Cloudbeds ${method}: ${msg}`);
  }
  return data;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const dateOnly = (s) => (s ? String(s).slice(0, 10) : null);
function nightsBetween(a, b) { if (!a || !b) return 0; return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000)); }

/** Turns a Cloudbeds getReservation payload into a bookings row. Only the fields the hotel needs are kept. */
export function normaliseReservation(data, fallbackCurrency = "GBP") {
  const d = data && data.data ? data.data : data || {};
  const roomsRaw = [...(Array.isArray(d.assigned) ? d.assigned : []), ...(Array.isArray(d.unassigned) ? d.unassigned : [])];
  const rooms = roomsRaw.map((r) => ({ room_type_id: String(r.roomTypeID || ""), room_type_name: r.roomTypeName || "", room_name: r.roomName || "", adults: num(r.adults), children: num(r.children) }));
  const adults = rooms.reduce((s, r) => s + r.adults, 0) || num(d.adults);
  const children = rooms.reduce((s, r) => s + r.children, 0) || num(d.children);
  return {
    reservation_id: String(d.reservationID || ""),
    status: String(d.status || "").toLowerCase(),
    source: String(d.sourceName || d.source || ""),
    guest_name: String(d.guestName || "").trim(),
    checkin: dateOnly(d.startDate), checkout: dateOnly(d.endDate), nights: nightsBetween(dateOnly(d.startDate), dateOnly(d.endDate)),
    adults, children, rooms,
    total: num(d.total), currency: String(d.currency || d.currencyCode || fallbackCurrency).toUpperCase(),
    booked_at: d.dateCreated ? new Date(d.dateCreated.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(d.dateCreated) ? "" : "Z")).toISOString() : null,
    modified_at: d.dateModified ? new Date(d.dateModified.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(d.dateModified) ? "" : "Z")).toISOString() : null,
    cancelled_at: d.dateCancelledUTC || d.dateCancelled ? new Date(String(d.dateCancelledUTC || d.dateCancelled).replace(" ", "T") + (d.dateCancelledUTC ? "Z" : "")).toISOString() : null,
  };
}

export async function fetchReservation(env, reservationID, currency) {
  const data = await cbRequest(env, "getReservation", { reservationID, propertyID: propertyId(env) });
  return normaliseReservation(data, currency);
}

export async function testConnection(env) {
  const data = await cbRequest(env, "getHotels", {});
  const hotels = Array.isArray(data.data) ? data.data : [];
  return hotels.map((h) => ({ id: String(h.propertyID), name: h.propertyName, currency: h.propertyCurrency && h.propertyCurrency.currencyCode }));
}

/* ---------- GA4 Measurement Protocol ---------- */

export async function sendGa4Event(env, site, { name, params, clientId }, { debug = false } = {}) {
  if (!ga4Configured(env, site)) throw new Error("GA4 is not configured (ga4_measurement_id in Settings and the GA4_API_SECRET secret)");
  const endpoint = debug ? "https://www.google-analytics.com/debug/mp/collect" : "https://www.google-analytics.com/mp/collect";
  const url = `${endpoint}?measurement_id=${encodeURIComponent(site.ga4_measurement_id)}&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`;
  const body = { client_id: clientId || `server.${crypto.randomUUID()}`, non_personalized_ads: true, events: [{ name, params: { engagement_time_msec: 1, ...params } }] };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (debug) { const v = await res.json().catch(() => ({})); return { ok: res.ok, validation: v.validationMessages || [] }; }
  if (!res.ok) throw new Error(`GA4 returned HTTP ${res.status}`);
  return { ok: true };
}

/** Sends the booking to GA4 once, when it is live (confirmed/checked in/out) and not reported before. */
export async function reportBooking(env, site, database, booking, { force = false } = {}) {
  if (!ga4Configured(env, site)) return { sent: false, reason: "ga4_not_configured" };
  if (!LIVE_STATUSES.has(booking.status)) return { sent: false, reason: `status_${booking.status || "unknown"}` };
  if (booking.reported_at && !force) return { sent: false, reason: "already_reported" };
  const eventName = site.ga4_booking_event === "off" ? null : (site.ga4_booking_event || "purchase");
  if (!eventName) return { sent: false, reason: "reporting_off" };
  const items = (booking.rooms && booking.rooms.length ? booking.rooms : [{ room_type_id: "room", room_type_name: "Room" }]).map((r, i) => ({
    item_id: r.room_type_id || `room-${i}`, item_name: r.room_type_name || "Room", item_category: "Accommodation", quantity: 1,
    price: booking.rooms && booking.rooms.length ? Math.round((booking.total / booking.rooms.length) * 100) / 100 : booking.total,
  }));
  await sendGa4Event(env, site, {
    name: eventName,
    clientId: `booking.${booking.reservation_id}`,
    params: { transaction_id: booking.reservation_id, value: booking.total, currency: booking.currency || "GBP", items, booking_source: booking.source || "unknown",
      nights: booking.nights, check_in: booking.checkin, check_out: booking.checkout, adults: booking.adults, children: booking.children },
  });
  await db.markBookingReported(database, booking.reservation_id);
  await db.logIntegration(database, "ga4", true, `${eventName} sent for reservation ${booking.reservation_id} (${booking.currency} ${booking.total})`);
  return { sent: true };
}

/* ---------- sync ---------- */

async function storeReservation(env, site, database, reservationID) {
  const booking = await fetchReservation(env, reservationID, (site && site.currency_code) || "GBP");
  if (!booking.reservation_id) throw new Error(`Reservation ${reservationID} came back empty`);
  const existing = await db.getBooking(database, booking.reservation_id);
  await db.upsertBooking(database, booking);
  const merged = { ...booking, reported_at: existing ? existing.reported_at : null };
  let ga4 = { sent: false, reason: "skipped" };
  try { ga4 = await reportBooking(env, site, database, merged); } catch (e) { await db.logIntegration(database, "ga4", false, `GA4 failed for ${booking.reservation_id}: ${e.message}`); ga4 = { sent: false, reason: e.message }; }
  return { booking, ga4, isNew: !existing };
}

/**
 * Pulls reservations modified since the last sync (default: the last 30 days on first run).
 * Returns a summary and records the run in the integration log.
 */
export async function syncReservations(env, site, database, { since, max = 60 } = {}) {
  await db.ensureSchema(database);
  const settings = await db.getSettings(database);
  const state = settings.integrations || {};
  const from = since || state.last_sync || new Date(Date.now() - 30 * 86400000).toISOString();
  const started = new Date().toISOString();
  const summary = { from, fetched: 0, stored: 0, created: 0, ga4_sent: 0, errors: [] };
  try {
    let page = 1, ids = [];
    while (page <= 10) {
      const data = await cbRequest(env, "getReservations", { propertyID: propertyId(env), modifiedFrom: from.replace("T", " ").slice(0, 19), pageSize: 100, pageNumber: page, sortByRecent: "false" });
      const items = Array.isArray(data.data) ? data.data : [];
      ids.push(...items.map((r) => String(r.reservationID)).filter(Boolean));
      if (items.length < 100) break;
      page++;
    }
    ids = [...new Set(ids)];
    summary.fetched = ids.length;
    for (const id of ids.slice(0, max)) {
      try {
        const r = await storeReservation(env, site, database, id);
        summary.stored++; if (r.isNew) summary.created++; if (r.ga4.sent) summary.ga4_sent++;
      } catch (e) { summary.errors.push(`${id}: ${e.message}`); }
      await new Promise((res) => setTimeout(res, 120)); // stay well inside Cloudbeds' rate limit
    }
    if (ids.length > max) summary.errors.push(`${ids.length - max} more reservations left for the next run`);
    await db.setSetting(database, "integrations", { ...state, last_sync: ids.length > max ? state.last_sync || from : started, last_sync_summary: summary });
    await db.logIntegration(database, "sync", summary.errors.length === 0, `Synced ${summary.stored}/${summary.fetched} reservations since ${from}${summary.errors.length ? "; errors: " + summary.errors.slice(0, 3).join(" | ") : ""}`);
  } catch (e) {
    summary.errors.push(e.message);
    await db.logIntegration(database, "sync", false, `Sync failed: ${e.message}`);
  }
  return summary;
}

/* ---------- webhooks ---------- */

export const WEBHOOK_EVENTS = [["reservation", "created"], ["reservation", "status_changed"]];

export function webhookUrl(site) { return (site.site_url || "").replace(/\/$/, "") + "/api/cloudbeds/webhook"; }

export async function registerWebhooks(env, site, database) {
  if (!env.CLOUDBEDS_WEBHOOK_SECRET) throw new Error("Set the CLOUDBEDS_WEBHOOK_SECRET secret first (any long random string)");
  if (!/^https:\/\//.test(site.site_url || "")) throw new Error("Settings → Site URL must be the live https address before registering webhooks");
  const existing = await listWebhooks(env).catch(() => []);
  const results = [];
  for (const [object, action] of WEBHOOK_EVENTS) {
    const already = existing.find((w) => w.object === object && w.action === action && w.url === webhookUrl(site));
    if (already) { results.push({ object, action, id: already.id, status: "already registered" }); continue; }
    const data = await cbRequest(env, "postWebhook", { propertyID: propertyId(env), endpointUrl: webhookUrl(site), object, action, authHeaderName: "X-Webhook-Secret", authHeaderValue: env.CLOUDBEDS_WEBHOOK_SECRET }, { post: true });
    results.push({ object, action, id: data.data && (data.data.subscriptionID || data.data.id), status: "registered" });
  }
  const settings = await db.getSettings(database);
  await db.setSetting(database, "integrations", { ...(settings.integrations || {}), webhooks: results, webhooks_registered_at: new Date().toISOString() });
  await db.logIntegration(database, "webhook_register", true, results.map((r) => `${r.object}/${r.action}: ${r.status}`).join("; "));
  return results;
}

export async function listWebhooks(env) {
  const data = await cbRequest(env, "getWebhooks", { propertyID: propertyId(env) });
  const list = Array.isArray(data.data) ? data.data : [];
  return list.map((w) => ({ id: String(w.id || w.subscriptionID || ""), object: w.event && w.event.entity ? w.event.entity : w.object, action: w.event && w.event.action ? w.event.action : w.action, url: w.subscriptionData && w.subscriptionData.url ? w.subscriptionData.url : w.endpointUrl }));
}

export async function removeWebhooks(env, site, database) {
  const existing = await listWebhooks(env);
  const mine = existing.filter((w) => w.url === webhookUrl(site));
  for (const w of mine) await cbRequest(env, "deleteWebhook", { propertyID: propertyId(env), subscriptionID: w.id }, { post: true });
  const settings = await db.getSettings(database);
  await db.setSetting(database, "integrations", { ...(settings.integrations || {}), webhooks: [], webhooks_registered_at: null });
  await db.logIntegration(database, "webhook_register", true, `Removed ${mine.length} webhook subscription(s)`);
  return mine.length;
}

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** Handles a webhook POST from Cloudbeds. Always answers quickly; the reservation is fetched with the API key. */
export async function handleWebhook(request, env, site, database) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  const secret = env.CLOUDBEDS_WEBHOOK_SECRET;
  if (!secret || !timingSafeEqual(request.headers.get("X-Webhook-Secret") || "", secret)) {
    await db.ensureSchema(database); await db.logIntegration(database, "webhook", false, "Rejected a webhook call: missing or wrong X-Webhook-Secret header");
    return new Response("Forbidden", { status: 403 });
  }
  let payload = {};
  const type = request.headers.get("Content-Type") || "";
  try {
    if (type.includes("json")) payload = await request.json();
    else { const form = await request.formData(); for (const [k, v] of form.entries()) payload[k] = v; }
  } catch { return new Response("Bad request", { status: 400 }); }
  await db.ensureSchema(database);
  const event = String(payload.event || "");
  const reservationID = payload.reservationID_str || payload.reservationID;
  if (!reservationID || !/^reservation\//.test(event)) {
    await db.logIntegration(database, "webhook", true, `Ignored ${event || "unknown event"}`);
    return Response.json({ ok: true, ignored: true });
  }
  try {
    const r = await storeReservation(env, site, database, String(reservationID));
    await db.logIntegration(database, "webhook", true, `${event}: reservation ${reservationID} ${r.booking.status} (${r.booking.source || "no source"})${r.ga4.sent ? ", reported to GA4" : ""}`);
    return Response.json({ ok: true });
  } catch (e) {
    await db.logIntegration(database, "webhook", false, `${event} for ${reservationID}: ${e.message}`);
    return Response.json({ ok: false, error: "stored later by the nightly sync" }, { status: 202 });
  }
}

/** GET /api/cloudbeds/sync — for Vercel cron (Authorization: Bearer CRON_SECRET) or any scheduler sending X-Sync-Key: SYNC_SECRET. */
export async function handleSync(request, env, site, database) {
  const auth = request.headers.get("Authorization") || "";
  const key = request.headers.get("X-Sync-Key") || new URL(request.url).searchParams.get("key") || "";
  const okCron = env.CRON_SECRET && auth === `Bearer ${env.CRON_SECRET}`;
  const okKey = env.SYNC_SECRET && timingSafeEqual(key, env.SYNC_SECRET);
  if (!okCron && !okKey) return new Response("Forbidden", { status: 403 });
  if (!cloudbedsConfigured(env)) return Response.json({ ok: false, error: "Cloudbeds API key not configured" }, { status: 503 });
  const summary = await syncReservations(env, site, database);
  return Response.json({ ok: summary.errors.length === 0, ...summary }, { headers: { "Cache-Control": "no-store" } });
}
