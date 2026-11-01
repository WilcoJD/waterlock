import { DEMO_USER_EMAIL } from '../config.ts';
import type { Deps } from '../deps.ts';
import { forbidden, unauthorized } from '../errors.ts';
import type { UserRow } from '../services/rows.ts';
import { getUser } from '../services/users.ts';
import { verifyToken } from './jwt.ts';

/** Resolve the bearer token to a user that still exists. Throws 401/403 ApiErrors. */
export function authenticate(deps: Deps, authorization: string | undefined, role: 'user' | 'admin'): UserRow {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  if (!match) throw unauthorized();
  const claims = verifyToken(match[1]!, deps.config.jwtSecret, deps.now());
  if (!claims) throw unauthorized('Your session has expired. Please sign in again.');
  const user = getUser(deps.db, claims.sub);
  // A token issued before the account's token_version was bumped (password/role reset) is revoked.
  if (!user || user.token_version !== claims.ver) throw unauthorized('Your session has expired. Please sign in again.');
  if (deps.config.env === 'production' && user.email === DEMO_USER_EMAIL) throw unauthorized();
  if (role === 'admin' && user.role !== 'admin') throw forbidden('Admins only');
  return user;
}
