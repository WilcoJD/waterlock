/**
 * Google Analytics 4 for the public site.
 *
 *  analyticsHead(site)  → markup for <head>: search-engine verification tags and, when site.ga4_measurement_id is set,
 *                         the consent defaults and configuration the cookie banner in main.js uses. It must NOT load gtag.js
 *                         itself: nothing from Google loads until the visitor accepts analytics cookies (UK PECR).
 *  analyticsBody(site)  → markup before </body> (the cookie banner shell, if any).
 *
 * Settings used: ga4_measurement_id, ga4_linker_domains, cookie_banner_text, google_site_verification, bing_site_verification.
 * Server-side booking events are sent from functions/_lib/cloudbeds.js, not from here.
 */
import { escapeHtml } from "./markdown.js";

const attr = (v) => escapeHtml(v == null ? "" : String(v));

export function analyticsHead(site) {
  let out = "";
  if (site.google_site_verification) out += `\n  <meta name="google-site-verification" content="${attr(site.google_site_verification)}">`;
  if (site.bing_site_verification) out += `\n  <meta name="msvalidate.01" content="${attr(site.bing_site_verification)}">`;
  return out;
}

export function analyticsBody(site) {
  return "";
}
