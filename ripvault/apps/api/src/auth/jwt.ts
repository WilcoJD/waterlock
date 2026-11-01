/**
 * HS256 JSON Web Tokens with node:crypto. Only HS256 is accepted (the header's alg is checked,
 * so "none" or RS/HS confusion tricks fail), signatures are compared in constant time, and
 * `exp` is mandatory.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface TokenClaims {
  sub: string;
  iat: number;
  exp: number;
  /** The user's token_version when issued (0 when absent, for tokens issued before versions existed). */
  ver: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signToken(userId: string, secret: string, now: Date, ttlSeconds = TOKEN_TTL_SECONDS, tokenVersion = 0): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, iat, exp: iat + ttlSeconds, ver: tokenVersion }));
  const signature = sign(`${header}.${payload}`, secret).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Returns the claims, or null for anything malformed, wrongly signed or expired. */
export function verifyToken(token: string, secret: string, now: Date): TokenClaims | null {
  if (token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const b64 = /^[A-Za-z0-9_-]+$/;
  if (!b64.test(h) || !b64.test(p) || !b64.test(s)) return null;

  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object' || (header as { alg?: unknown }).alg !== 'HS256') return null;

  const expected = sign(`${h}.${p}`, secret);
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object') return null;
  const { sub, iat, exp, ver = 0 } = claims as Record<string, unknown>;
  if (typeof ver !== 'number' || !Number.isSafeInteger(ver) || ver < 0) return null;
  if (typeof sub !== 'string' || sub === '') return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (nowSeconds >= exp) return null;
  // Reject tokens issued in the future (beyond a minute of clock skew).
  if (iat > nowSeconds + 60) return null;
  return { sub, iat, exp, ver };
}
