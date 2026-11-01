import type { ApiErrorBody, ErrorCode } from '@ripvault/shared';

/** An error that maps directly onto an `ApiErrorBody` response. Anything else becomes a 500 `internal`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(status: number, code: ErrorCode, message: string, fields?: Record<string, string>, headers?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }

  toBody(): ApiErrorBody {
    const body: ApiErrorBody = { error: { code: this.code, message: this.message } };
    if (this.fields && Object.keys(this.fields).length > 0) body.error.fields = this.fields;
    return body;
  }
}

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message);
export const validationFailed = (fields: Record<string, string>, message = 'Some fields are invalid') =>
  new ApiError(400, 'validation_failed', message, fields);
export const unauthorized = (message = 'Sign in to continue') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this') => new ApiError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
export const invalidState = (message: string) => new ApiError(409, 'invalid_state', message);
export const insufficientFunds = (message = 'Your balance is too low for this') => new ApiError(402, 'insufficient_funds', message);
export const paymentsUnavailable = (message = 'Payments are not available right now') =>
  new ApiError(503, 'payments_unavailable', message);
