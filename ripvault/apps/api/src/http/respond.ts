import type { ServerResponse } from 'node:http';
import type { ApiErrorBody } from '@ripvault/shared';
import type { ApiError } from '../errors.ts';
import type { HandlerResult } from './router.ts';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
  'Access-Control-Expose-Headers': 'Idempotent-Replayed, Retry-After, X-Request-Id',
  'Access-Control-Max-Age': '600',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

export function baseHeaders(requestId: string): Record<string, string> {
  return { ...CORS_HEADERS, ...SECURITY_HEADERS, 'X-Request-Id': requestId };
}

export function send(res: ServerResponse, requestId: string, result: HandlerResult): void {
  const headers = { ...baseHeaders(requestId), ...result.headers };
  let payload: string | undefined;
  if (result.html !== undefined) {
    headers['Content-Type'] = 'text/html; charset=utf-8';
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
    payload = result.html;
  } else if (result.json !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    payload = result.json;
  } else if (result.body !== undefined && result.status !== 204) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    payload = JSON.stringify(result.body);
  }
  if (payload !== undefined) headers['Content-Length'] = String(Buffer.byteLength(payload));
  if (res.headersSent) return;
  res.writeHead(result.status, headers);
  res.end(payload);
}

export function errorResult(err: ApiError): HandlerResult {
  const result: HandlerResult = { status: err.status, body: err.toBody() };
  if (err.headers) result.headers = err.headers;
  return result;
}

export function internalErrorBody(): ApiErrorBody {
  return { error: { code: 'internal', message: 'Something went wrong. Please try again.' } };
}
