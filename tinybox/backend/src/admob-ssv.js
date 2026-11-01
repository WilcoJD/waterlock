'use strict';
/**
 * Google AdMob rewarded-ad Server-Side Verification (SSV).
 * https://developers.google.com/admob/android/ssv
 *
 * AdMob calls GET <callback>?ad_network=..&ad_unit=..&custom_data=..&reward_amount=..
 *   &reward_item=..&timestamp=..&transaction_id=..&user_id=..&signature=..&key_id=..
 * The signature is an ECDSA/SHA-256 signature (DER, web-safe base64) over the
 * raw query string up to, but not including, "&signature=".
 */
const crypto = require('node:crypto');

const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
let cache = { at: 0, keys: new Map() };

async function fetchKeys(force = false) {
  if (!force && Date.now() - cache.at < 24 * 3600 * 1000 && cache.keys.size) return cache.keys;
  const res = await fetch(KEYS_URL);
  if (!res.ok) throw new Error(`Failed to fetch AdMob keys: ${res.status}`);
  const json = await res.json();
  const keys = new Map(json.keys.map((k) => [String(k.keyId), k.pem]));
  cache = { at: Date.now(), keys };
  return keys;
}

/**
 * @param {string} rawQuery the query string exactly as received (no leading "?")
 * @param {Map<string,string>} [keys] optional keyId->PEM map (for tests)
 * @returns {Promise<URLSearchParams>} parsed params if valid; throws otherwise
 */
async function verifySsv(rawQuery, keys) {
  const idx = rawQuery.indexOf('&signature=');
  if (idx < 0) throw new Error('missing signature');
  const message = rawQuery.slice(0, idx);
  const params = new URLSearchParams(rawQuery);
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  if (!signature || !keyId) throw new Error('missing signature/key_id');

  let pem = (keys || (await fetchKeys())).get(keyId);
  if (!pem && !keys) pem = (await fetchKeys(true)).get(keyId); // key rotation
  if (!pem) throw new Error('unknown key_id');

  const sig = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const ok = crypto.verify('sha256', Buffer.from(message), pem, sig);
  if (!ok) throw new Error('bad signature');
  return params;
}

module.exports = { verifySsv, fetchKeys };
