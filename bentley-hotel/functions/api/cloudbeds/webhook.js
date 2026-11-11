/**
 * POST /api/cloudbeds/webhook — Cloudbeds calls this when a reservation is created or changes status.
 * Registered from the admin (Bookings → Register webhooks); verified with the X-Webhook-Secret header
 * (secret CLOUDBEDS_WEBHOOK_SECRET). See functions/_lib/cloudbeds.js.
 */
import * as db from "../../_lib/db.js";
import { handleWebhook } from "../../_lib/cloudbeds.js";
import SEED from "../../_lib/seed-data.js";

export async function onRequest({ request, env }) {
  if (!env.DB) return new Response(JSON.stringify({ ok: false, error: "database not configured" }), { status: 503, headers: { "Content-Type": "application/json" } });
  const site = (await db.getSettings(env.DB)).site || SEED.settings.site;
  return handleWebhook(request, env, site, env.DB);
}
