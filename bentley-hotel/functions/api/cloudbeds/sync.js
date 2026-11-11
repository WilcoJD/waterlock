/**
 * GET /api/cloudbeds/sync — pulls recently modified reservations from Cloudbeds into the bookings register
 * and reports new confirmed bookings to GA4. Called nightly by the platform scheduler (Vercel cron with
 * Authorization: Bearer CRON_SECRET) or by any scheduler sending X-Sync-Key: SYNC_SECRET.
 * The admin's "Sync now" button uses /admin/api/bookings/sync instead (session login).
 */
import * as db from "../../_lib/db.js";
import { handleSync } from "../../_lib/cloudbeds.js";
import SEED from "../../_lib/seed-data.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  if (!env.DB) return new Response(JSON.stringify({ ok: false, error: "database not configured" }), { status: 503, headers: { "Content-Type": "application/json" } });
  const site = (await db.getSettings(env.DB)).site || SEED.settings.site;
  return handleSync(request, env, site, env.DB);
}
