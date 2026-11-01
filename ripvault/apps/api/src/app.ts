/**
 * App factory: wires config, database, clock and fetch into an HTTP request handler.
 *
 *   const app = createApp({ config, db });
 *   http.createServer(app.handle).listen(4000);
 *
 * Tests pass their own `now` (clock) and `fetch` (fake Stripe / pokemontcg.io).
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticate } from './auth/authenticate.ts';
import { getDummyHash } from './auth/password.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { Deps, FetchFn } from './deps.ts';
import { ApiError, badRequest } from './errors.ts';
import { DEFAULT_MAX_BODY_BYTES, parseJsonBody, readRawBody } from './http/body.ts';
import { createLogger, silentLogger } from './http/logger.ts';
import type { Logger } from './http/logger.ts';
import { RateLimiter } from './http/rate-limit.ts';
import { errorResult, internalErrorBody, send } from './http/respond.ts';
import { Router } from './http/router.ts';
import type { HandlerResult, Method, RequestContext } from './http/router.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerFairnessRoutes } from './routes/fairness.ts';
import { registerInventoryRoutes } from './routes/inventory.ts';
import { registerMeRoutes } from './routes/me.ts';
import { registerPackRoutes } from './routes/packs.ts';
import { registerPublicRoutes } from './routes/public.ts';
import { registerShippingRoutes } from './routes/shipping.ts';
import { registerWalletRoutes } from './routes/wallet.ts';
import { readIdempotencyKey, runIdempotentAsync, runIdempotentSync } from './services/idempotency.ts';

export interface CreateAppOptions {
  config: Config;
  db: Db;
  fetch?: FetchFn;
  now?: () => Date;
  logger?: Logger;
}

export interface App {
  deps: Deps;
  router: Router;
  /** Node request listener. Never throws; every failure becomes an ApiErrorBody response. */
  handle: (req: IncomingMessage, res: ServerResponse) => void;
}

const METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function createApp(options: CreateAppOptions): App {
  const config = options.config;
  const deps: Deps = {
    db: options.db,
    config,
    now: options.now ?? (() => new Date()),
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    logger: options.logger ?? (config.env === 'test' ? silentLogger : createLogger()),
  };
  const router = new Router();
  registerPublicRoutes(router, deps);
  registerAuthRoutes(router, deps);
  registerMeRoutes(router, deps);
  registerPackRoutes(router, deps);
  registerInventoryRoutes(router, deps);
  registerWalletRoutes(router, deps);
  registerShippingRoutes(router, deps);
  registerFairnessRoutes(router, deps);
  registerAdminRoutes(router, deps);

  const authLimiter = new RateLimiter(config.authRateLimitPerMinute, 60_000);
  // Compute the decoy hash up front so the first unknown-email login is not measurably slower.
  void getDummyHash();

  function clientIp(req: IncomingMessage): string {
    if (config.trustProxy > 0) {
      // Proxies APPEND the address they received the request from, so only the rightmost
      // `trustProxy` entries were written by proxies we trust; anything further left is whatever the
      // client sent and must never pick the rate-limit bucket.
      const xff = req.headers['x-forwarded-for'];
      const entries = (Array.isArray(xff) ? xff.join(',') : xff ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e !== '');
      if (entries.length > 0) return entries[Math.max(0, entries.length - config.trustProxy)]!;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  async function route(req: IncomingMessage, requestId: string, method: string, url: URL): Promise<{ result: HandlerResult; userId?: string }> {
    if (method === 'OPTIONS') return { result: { status: 204 } };
    if (!METHODS.includes(method)) {
      throw new ApiError(405, 'bad_request', `Method ${method} is not allowed`, undefined, { Allow: METHODS.join(', ') });
    }
    const match = router.match(method, url.pathname);
    if (match.kind === 'not_found') throw new ApiError(404, 'not_found', `No endpoint at ${method} ${url.pathname}`);
    if (match.kind === 'bad_path') throw badRequest('Malformed URL');
    if (match.kind === 'method_not_allowed') {
      throw new ApiError(405, 'bad_request', `Method ${method} is not allowed here`, undefined, {
        Allow: [...match.allow, 'OPTIONS'].join(', '),
      });
    }
    const { route: r, params } = match;
    const ip = clientIp(req);

    if (r.options.rateLimit === 'auth') {
      const wait = authLimiter.hit(`auth:${ip}`, deps.now().getTime());
      if (wait !== null) {
        throw new ApiError(429, 'rate_limited', 'Too many attempts. Please wait a minute and try again.', undefined, {
          'Retry-After': String(wait),
        });
      }
    }

    // Authenticate before touching the body: a bad token is a 401 whatever was sent.
    if (r.options.auth) authenticate(deps, req.headers.authorization, r.options.auth);

    let rawBody: Buffer = Buffer.alloc(0);
    if (method === 'GET' || method === 'DELETE') req.resume();
    else rawBody = await readRawBody(req, r.options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    const contentType = req.headers['content-type'];
    const body = r.options.rawBody ? undefined : parseJsonBody(rawBody, contentType);

    const ctx: RequestContext = {
      req,
      requestId,
      method: method as Method,
      path: url.pathname,
      query: url.searchParams,
      params,
      headers: req.headers,
      ip,
      rawBody,
      body,
      user: null,
      now: deps.now(),
    };
    // Re-resolve after the (async) body read so a user deleted meanwhile is still rejected.
    if (r.options.auth) ctx.user = authenticate(deps, req.headers.authorization, r.options.auth);
    const userId = ctx.user?.id;

    if (r.options.idempotent && ctx.user) {
      const key = readIdempotencyKey(ctx);
      if (key !== null) {
        const user = ctx.user;
        if (r.options.idempotent === 'sync') {
          return {
            userId,
            result: runIdempotentSync(deps, ctx, user.id, key, () => {
              const out = r.handler(ctx);
              if (out instanceof Promise) throw new Error(`route ${r.method} ${r.pattern} is marked sync but returned a Promise`);
              return out;
            }),
          };
        }
        return { userId, result: await runIdempotentAsync(deps, ctx, user.id, key, async () => r.handler(ctx)) };
      }
    }
    return { userId, result: await r.handler(ctx) };
  }

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    const method = (req.method ?? 'GET').toUpperCase();
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      url = new URL('http://localhost/');
    }
    res.on('error', () => {});

    route(req, requestId, method, url)
      .catch((err: unknown) => {
        if (err instanceof ApiError) return { result: errorResult(err), userId: undefined };
        deps.logger.error('unhandled error', {
          requestId,
          method,
          path: url.pathname,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        return { result: { status: 500, body: internalErrorBody() } as HandlerResult, userId: undefined };
      })
      .then(({ result, userId }) => {
        try {
          send(res, requestId, result);
        } catch (err) {
          deps.logger.error('failed to send response', { requestId, error: String(err) });
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        }
        if (config.logRequests) {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          deps.logger.info('request', {
            requestId,
            method,
            path: url.pathname,
            status: result.status,
            ms: Math.round(ms * 10) / 10,
            ...(userId ? { userId } : {}),
          });
        }
      });
  };

  return { deps, router, handle };
}
