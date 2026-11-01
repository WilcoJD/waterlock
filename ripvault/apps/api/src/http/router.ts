/**
 * Minimal router: exact segments and `:param` captures. Static segments win over params, so
 * `/inventory/sell` is never captured by `/inventory/:id`.
 */
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { UserRow } from '../services/rows.ts';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestContext {
  req: IncomingMessage;
  requestId: string;
  method: Method;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
  ip: string;
  /** Raw request bytes (empty for GET/DELETE without a body). */
  rawBody: Buffer;
  /** Parsed JSON body (undefined when empty or when the route takes a raw body). */
  body: unknown;
  /** Set for routes with `auth`. */
  user: UserRow | null;
  now: Date;
}

export interface HandlerResult {
  status: number;
  /** Serialised as JSON. */
  body?: unknown;
  /** Pre-serialised JSON (used for idempotent replays so they are byte-for-byte identical). */
  json?: string;
  html?: string;
  headers?: Record<string, string>;
}

export type Handler = (ctx: RequestContext) => HandlerResult | Promise<HandlerResult>;

export interface RouteOptions {
  /** Require a valid bearer token ('user') and additionally role=admin ('admin'). */
  auth?: 'user' | 'admin';
  /** Keep the raw body and skip JSON parsing (Stripe webhook signature check). */
  rawBody?: boolean;
  maxBodyBytes?: number;
  /**
   * Honour the Idempotency-Key header. 'sync' handlers run in the same DB transaction as the
   * key bookkeeping; 'async' handlers (that await network calls) reserve the key first.
   */
  idempotent?: 'sync' | 'async';
  /** Per-IP rate limit bucket. */
  rateLimit?: 'auth';
}

export interface Route {
  method: Method;
  pattern: string;
  segments: string[];
  handler: Handler;
  options: RouteOptions;
  /** Lower sorts first: number of param segments, so static routes win. */
  specificity: number;
}

export type MatchResult =
  | { kind: 'found'; route: Route; params: Record<string, string> }
  | { kind: 'method_not_allowed'; allow: Method[] }
  | { kind: 'not_found' }
  | { kind: 'bad_path' };

export class Router {
  private routes: Route[] = [];

  add(method: Method, pattern: string, handler: Handler, options: RouteOptions = {}): this {
    const segments = splitPath(pattern);
    const specificity = segments.filter((s) => s.startsWith(':')).length;
    this.routes.push({ method, pattern, segments, handler, options, specificity });
    this.routes.sort((a, b) => a.specificity - b.specificity);
    return this;
  }

  get(pattern: string, handler: Handler, options?: RouteOptions): this {
    return this.add('GET', pattern, handler, options);
  }
  post(pattern: string, handler: Handler, options?: RouteOptions): this {
    return this.add('POST', pattern, handler, options);
  }
  put(pattern: string, handler: Handler, options?: RouteOptions): this {
    return this.add('PUT', pattern, handler, options);
  }
  patch(pattern: string, handler: Handler, options?: RouteOptions): this {
    return this.add('PATCH', pattern, handler, options);
  }
  delete(pattern: string, handler: Handler, options?: RouteOptions): this {
    return this.add('DELETE', pattern, handler, options);
  }

  list(): readonly Route[] {
    return this.routes;
  }

  match(method: string, path: string): MatchResult {
    const parts = splitPath(path);
    const allow = new Set<Method>();
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (params === null) continue;
      if (params === undefined) return { kind: 'bad_path' };
      if (route.method === method) return { kind: 'found', route, params };
      allow.add(route.method);
    }
    if (allow.size > 0) return { kind: 'method_not_allowed', allow: [...allow] };
    return { kind: 'not_found' };
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

/** null = no match; undefined = matched but a param was not valid percent-encoding. */
function matchSegments(pattern: string[], parts: string[]): Record<string, string> | null | undefined {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    const v = parts[i]!;
    if (p.startsWith(':')) {
      try {
        params[p.slice(1)] = decodeURIComponent(v);
      } catch {
        return undefined;
      }
    } else if (p !== v) {
      return null;
    }
  }
  return params;
}
