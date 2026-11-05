// Unit tests for functions/api/availability.js — run with:  node --test tests/
// The Cloudbeds response below is a TEST FIXTURE shaped from the official getRatePlans
// OpenAPI schema (field names are real; the values are invented for the test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest, onRequestGet, summarise, blockFor, ROOM_TYPES } from "../functions/api/availability.js";

const DOUBLE = "148839795253447";
const SINGLE = "148837309972637";
const CORPORATE = "160529320075405"; // non-public room type: must never be returned

function isoIn(days) {
  const d = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  return new Date(d.getTime() + days * 86400000).toISOString().slice(0, 10);
}

function fixture(start) {
  const d0 = start, d1 = isoIn(11), d2 = isoIn(12);
  return {
    success: true,
    data: [
      { rateID: "1", isDerived: false, roomTypeID: DOUBLE, roomTypeName: "Standard Double Room", totalRate: 128,
        roomRateDetailed: [
          { date: d0, rateBase: 64, totalRate: 64, roomsAvailable: 3, closedToArrival: false, closedToDeparture: false, blocked: false, minLos: 1 },
          { date: d1, rateBase: "70.00", totalRate: "70.00", roomsAvailable: "1", closedToArrival: "1", closedToDeparture: "0", blocked: "0", minLos: "2" },
          { date: d2, rateBase: 70, totalRate: 70, roomsAvailable: 0, closedToArrival: false, closedToDeparture: false, blocked: false, minLos: 1 },
        ] },
      // Derived refundable plan: dearer, so the lowest price must stay with the base rate
      { rateID: "2", isDerived: true, ratePlanNamePublic: "Refundable", roomTypeID: DOUBLE,
        roomRateDetailed: [
          { date: d0, rateBase: 76.8, totalRate: 76.8, roomsAvailable: 3 },
          { date: d1, rateBase: 84, totalRate: 84, roomsAvailable: 1 },
          { date: d2, rateBase: 84, totalRate: 84, roomsAvailable: 0 },
        ] },
      // Promo-only plan: must be ignored even though it is cheaper
      { rateID: "3", isDerived: true, promoCode: "SECRET", roomTypeID: DOUBLE,
        roomRateDetailed: [{ date: d0, totalRate: 10, roomsAvailable: 3 }] },
      // Blocked night for the single
      { rateID: "4", isDerived: false, roomTypeID: Number(SINGLE),
        roomRateDetailed: [
          { date: d0, totalRate: 55, roomsAvailable: 2, blocked: true },
          { date: d1, totalRate: 55, roomsAvailable: 2 },
        ] },
      { rateID: "5", isDerived: false, roomTypeID: CORPORATE, roomTypeName: "Ensol Double",
        roomRateDetailed: [{ date: d0, totalRate: 40, roomsAvailable: 5 }] },
    ],
  };
}

function ctx(url, env, fetchImpl) {
  globalThis.fetch = fetchImpl;
  return { request: new Request(url), env, waitUntil: () => {} };
}

test("summarise: one row per public room type, in order, with lowest public nightly price", () => {
  const start = isoIn(10);
  const rows = summarise(fixture(start).data, start, isoIn(13));
  assert.deepEqual(rows.map((r) => r.id), ROOM_TYPES.map((r) => r.id));
  assert.ok(!rows.some((r) => r.id === CORPORATE));
  const dbl = rows.find((r) => r.id === DOUBLE);
  assert.equal(dbl.days.length, 3);
  assert.deepEqual(dbl.days[0], { date: start, available: 3, rate: 64, closedToArrival: false, closedToDeparture: false, minStay: null });
  assert.deepEqual(dbl.days[1], { date: isoIn(11), available: 1, rate: 70, closedToArrival: true, closedToDeparture: false, minStay: 2 });
  assert.equal(dbl.days[2].available, 0);
  assert.equal(dbl.days[2].rate, null, "sold-out nights have no price");
});

test("summarise: blocked nights count as unavailable; missing data is a zero, not an error", () => {
  const start = isoIn(10);
  const rows = summarise(fixture(start).data, start, isoIn(12));
  const single = rows.find((r) => r.id === SINGLE);
  assert.equal(single.days[0].available, 0);
  assert.equal(single.days[0].rate, null);
  assert.equal(single.days[1].available, 2);
  const family = rows.find((r) => r.name === "Family Room");
  assert.ok(family.days.every((d) => d.available === 0 && d.rate === null));
  assert.deepEqual(summarise(undefined, start, isoIn(11))[0].days.length, 1);
});

test("returns 503 not_configured without an API key, and never calls Cloudbeds", async () => {
  let called = false;
  const res = await onRequestGet(ctx("https://example.test/api/availability", {}, async () => { called = true; }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "not_configured" });
  assert.equal(called, false);
});

test("validates start and days", async () => {
  const env = { CLOUDBEDS_API_KEY: "cbat_test" };
  const noFetch = async () => { throw new Error("should not fetch"); };
  for (const q of ["start=2026-13-01", "start=nope", "days=0", "days=22", "days=63", "days=1.5", `start=${isoIn(-5)}`, `start=${isoIn(600)}`]) {
    const res = await onRequestGet(ctx(`https://example.test/api/availability?${q}`, env, noFetch));
    assert.equal(res.status, 400, q);
  }
});

test("calls getRatePlans with the right parameters and headers, and keeps the key out of the response", async () => {
  const start = isoIn(10);
  let seen;
  const env = { CLOUDBEDS_API_KEY: "cbat_secret_value", CLOUDBEDS_PROPERTY_ID: "141393122377981" };
  const res = await onRequestGet(ctx(`https://example.test/api/availability?start=${start}&days=3`, env, async (url, init) => {
    seen = { url: new URL(url), headers: init.headers };
    return new Response(JSON.stringify(fixture(start)), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  assert.equal(res.status, 200);
  assert.equal(seen.url.origin + seen.url.pathname, "https://api.cloudbeds.com/api/v1.3/getRatePlans");
  // Cloudbeds is asked for the aligned 42-night block that contains the request
  assert.equal(seen.url.searchParams.get("startDate"), isoIn(-1));
  assert.equal(seen.url.searchParams.get("endDate"), isoIn(41));
  assert.equal(seen.url.searchParams.get("detailedRates"), "true");
  assert.equal(seen.url.searchParams.get("includePromoCode"), "false");
  assert.equal(seen.url.searchParams.get("propertyIDs"), "141393122377981");
  assert.equal(seen.url.searchParams.get("roomTypeID"), ROOM_TYPES.map((r) => r.id).join(","));
  assert.equal(seen.headers["x-api-key"], "cbat_secret_value");
  assert.equal(seen.headers["X-PROPERTY-ID"], "141393122377981");
  const text = await res.text();
  assert.ok(!text.includes("cbat_"), "API key must not appear in the response");
  const body = JSON.parse(text);
  assert.equal(body.start, start);
  assert.equal(body.end, isoIn(13));
  assert.equal(body.currency, "GBP");
  assert.equal(body.rooms.length, 4);
  assert.deepEqual(body.rooms.find((r) => r.id === DOUBLE).days.map((d) => d.date), [start, isoIn(11), isoIn(12)]);
  assert.equal(body.stale, false);
  assert.match(res.headers.get("Cache-Control"), /max-age=300/);
});

test("maps Cloudbeds failures to 502/503 without echoing upstream details", async () => {
  const env = { CLOUDBEDS_API_KEY: "cbat_x" };
  let res = await onRequestGet(ctx("https://example.test/api/availability", env, async () =>
    new Response(JSON.stringify({ success: false, message: "Property 123 owner john@example.com" }), { status: 401 })));
  assert.equal(res.status, 502);
  assert.ok(!(await res.text()).includes("john@"));
  res = await onRequestGet(ctx("https://example.test/api/availability", env, async () => new Response("slow down", { status: 429, headers: { "Retry-After": "7" } })));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Retry-After"), "7");
  res = await onRequestGet(ctx("https://example.test/api/availability", env, async () => { throw new Error("network down"); }));
  assert.equal(res.status, 502);
});

test("rejects methods other than GET", async () => {
  const res = await onRequest({ request: new Request("https://example.test/api/availability", { method: "POST" }), env: {} });
  assert.equal(res.status, 405);
});

test("restrictions don't depend on the order of rate plans", () => {
  const start = isoIn(10);
  const a = { isDerived: false, roomTypeID: DOUBLE, roomRateDetailed: [{ date: start, totalRate: 64, roomsAvailable: 2, closedToArrival: true, minLos: 3 }] };
  const b = { isDerived: false, roomTypeID: DOUBLE, roomRateDetailed: [{ date: start, totalRate: 90, roomsAvailable: 2, closedToArrival: false, minLos: 1 }] };
  const d = { isDerived: true, roomTypeID: DOUBLE, roomRateDetailed: [{ date: start, totalRate: 70, roomsAvailable: 2, closedToArrival: true, minLos: 5 }] };
  for (const order of [[a, b, d], [d, b, a], [b, d, a]]) {
    const cell = summarise(order, start, isoIn(11)).find((r) => r.id === DOUBLE).days[0];
    assert.equal(cell.closedToArrival, false, "open if any base plan is open");
    assert.equal(cell.minStay, null, "shortest base-plan minimum stay wins");
    assert.equal(cell.rate, 64);
  }
});

test("blockFor aligns requests to fixed 21-night blocks", () => {
  const today = new Date(isoIn(0) + "T00:00:00Z");
  const at = (n) => blockFor(new Date(isoIn(n) + "T00:00:00Z"), today);
  assert.deepEqual(at(-1), { startISO: isoIn(-1), endISO: isoIn(41) });
  assert.deepEqual(at(19), { startISO: isoIn(-1), endISO: isoIn(41) });
  assert.deepEqual(at(20), { startISO: isoIn(20), endISO: isoIn(62) });
  // every allowed request (start + up to 21 nights) fits inside its block
  for (let n = -1; n < 120; n++) {
    const b = at(n);
    assert.ok(b.startISO <= isoIn(n) && isoIn(n + 21) <= b.endISO, `start +${n}`);
  }
});

function fakeCaches() {
  const store = new Map();
  return {
    store,
    default: {
      async match(req) { const r = store.get(req.url); return r ? r.clone() : undefined; },
      async put(req, res) { store.set(req.url, res.clone()); },
    },
  };
}

test("uses the edge cache, and serves the last good copy if Cloudbeds fails", async () => {
  const start = isoIn(10);
  const env = { CLOUDBEDS_API_KEY: "cbat_x" };
  const fc = fakeCaches();
  globalThis.caches = fc;
  try {
    let calls = 0;
    const ok = async () => { calls++; return new Response(JSON.stringify(fixture(start)), { status: 200 }); };
    let res = await onRequestGet(ctx(`https://example.test/api/availability?start=${start}&days=3`, env, ok));
    assert.equal(res.status, 200);
    // a different start/days inside the same block is served from cache
    res = await onRequestGet(ctx(`https://example.test/api/availability?start=${isoIn(11)}&days=7`, env, ok));
    assert.equal(res.status, 200);
    assert.equal(calls, 1, "second request must not reach Cloudbeds");
    assert.equal((await res.json()).rooms[0].days.length, 7);
    // fresh copy expires; Cloudbeds now rate-limits: the stale copy is served
    for (const k of [...fc.store.keys()]) if (k.includes("/_block?")) fc.store.delete(k);
    res = await onRequestGet(ctx(`https://example.test/api/availability?start=${start}&days=3`, env, async () => new Response("", { status: 429 })));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stale, true);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    // with no stale copy either, the error is passed on
    fc.store.clear();
    res = await onRequestGet(ctx(`https://example.test/api/availability?start=${start}&days=3`, env, async () => new Response("", { status: 429, headers: { "Retry-After": "9" } })));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("Retry-After"), "9");
  } finally {
    delete globalThis.caches;
  }
});
