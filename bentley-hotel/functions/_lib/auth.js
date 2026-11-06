/**
 * Admin authentication for the Bentley Hotel site.
 *
 * - Password: compared against the ADMIN_PASSWORD secret, or verified against ADMIN_PASSWORD_HASH
 *   (a PBKDF2-SHA256 hash in the form "pbkdf2$<iterations>$<salt-hex>$<hash-hex>", made with
 *   `node src/hash-password.js`).
 * - Session: a signed, HttpOnly, SameSite=Strict cookie (HMAC-SHA256 with SESSION_SECRET), 12 hours.
 * - CSRF: mutating API requests must carry "X-Requested-With: fetch" and come from the same origin.
 */

const COOKIE = "bh_admin";
const SESSION_SECONDS = 12 * 60 * 60;
const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
function fromHex(h) { return Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16)); }

function timingSafeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = 210000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const out = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${hex(salt)}$${hex(out)}`;
}

export function authConfigured(env) {
  return Boolean((env.ADMIN_PASSWORD_HASH || env.ADMIN_PASSWORD) && env.SESSION_SECRET);
}

export async function verifyPassword(env, password) {
  if (typeof password !== "string" || !password) return false;
  if (env.ADMIN_PASSWORD_HASH) {
    const parts = String(env.ADMIN_PASSWORD_HASH).split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const out = await pbkdf2(password, fromHex(parts[2]), Number(parts[1]) || 210000);
    return timingSafeEqual(hex(out), parts[3]);
  }
  if (env.ADMIN_PASSWORD) return timingSafeEqual(password, env.ADMIN_PASSWORD);
  return false;
}

export async function createSession(env, request) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(enc.encode(JSON.stringify({ iat: now, exp: now + SESSION_SECONDS, n: hex(crypto.getRandomValues(new Uint8Array(8))) })));
  const sig = b64url(await hmac(env.SESSION_SECRET, payload));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${payload}.${sig}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export async function getSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookie = request.headers.get("Cookie") || "";
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  const expected = b64url(await hmac(env.SESSION_SECRET, payload));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

/** True when a state-changing request is a same-origin fetch from the admin app. */
export function csrfOk(request) {
  if (request.headers.get("X-Requested-With") !== "fetch") return false;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("Origin");
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return false; } catch { return false; }
  }
  return true;
}
