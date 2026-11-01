/**
 * Typed RipVault API client. One function per (non-admin) endpoint in docs/API.md.
 *
 * - All functions return the shared DTO types and throw `ApiError` on any failure (HTTP error,
 *   network failure, timeout). Use `errorMessage(e)` for a user-facing string.
 * - The bearer token is held in memory and set by SessionProvider via `setAuthToken`. Do not call
 *   setAuthToken from screens.
 * - Money-moving POSTs take an `idempotencyKey`. Create ONE key per user action with
 *   `newIdempotencyKey()` (e.g. when the confirm button is pressed) and reuse it for retries of that
 *   same action, so a retry after a timeout never double-charges.
 */
import * as Crypto from 'expo-crypto';
import type {
  Address,
  AddressInput,
  ApiErrorBody,
  AppConfig,
  AuthResponse,
  CancelShipmentResponse,
  CreateShipmentRequest,
  CreateShipmentResponse,
  ErrorCode,
  FairnessState,
  InventoryItem,
  InventoryResponse,
  InventorySort,
  InventoryStatus,
  LoginRequest,
  Me,
  OpeningsResponse,
  OpenPackRequest,
  OpenPackResponse,
  PackDetail,
  PackSummary,
  RegisterRequest,
  RotateSeedRequest,
  RotateSeedResponse,
  SellRequest,
  SellResponse,
  Shipment,
  ShippingQuoteResponse,
  TopupRequest,
  TopupResponse,
  UpdateLimitsRequest,
  UpdateMeRequest,
  VerifyOpeningResponse,
  WalletResponse,
  Withdrawal,
  WithdrawalRequest,
  WithdrawalResponse,
} from '@ripvault/shared';
import { API_URL, REQUEST_TIMEOUT_MS } from '../config.ts';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Server error codes plus client-side failure kinds (status 0). */
export type ApiErrorCode = ErrorCode | 'network' | 'timeout' | 'aborted' | 'bad_response';

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response (network/timeout/aborted). */
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Per-field messages for `validation_failed` (keys match request body fields, e.g. "email"). */
  readonly fields: Readonly<Record<string, string>>;

  constructor(status: number, code: ApiErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
  }

  /** True for failures where retrying the same request may help (offline, timeout, 5xx, 429). */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError || (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'ApiError');
}

/** Normalise anything thrown into an ApiError. */
export function toApiError(e: unknown): ApiError {
  if (isApiError(e)) return e;
  const message = e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
  return new ApiError(0, 'bad_response', message);
}

/** User-facing message for anything thrown by the client (or anything else). */
export function errorMessage(e: unknown): string {
  return toApiError(e).message;
}

/** Field error for a form input, e.g. fieldError(err, 'email'). */
export function fieldError(e: unknown, field: string): string | undefined {
  return isApiError(e) ? e.fields[field] : undefined;
}

const NETWORK_MESSAGE = "Can't reach RipVault. Check your connection and try again.";
const TIMEOUT_MESSAGE = 'RipVault is taking too long to respond. Please try again.';

function fallbackMessage(status: number): string {
  if (status === 401) return 'Please sign in again.';
  if (status === 403) return "You can't do that right now.";
  if (status === 404) return "We couldn't find that.";
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status >= 500) return 'RipVault is having trouble right now. Please try again shortly.';
  return 'Something went wrong. Please try again.';
}

function isErrorBody(x: unknown): x is ApiErrorBody {
  if (typeof x !== 'object' || x === null) return false;
  const err = (x as { error?: unknown }).error;
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string';
}

// ---------------------------------------------------------------------------
// Auth token + 401 listener (wired up by SessionProvider)
// ---------------------------------------------------------------------------

let authToken: string | null = null;
const unauthorizedListeners = new Set<() => void>();

/** Set (or clear with null) the bearer token sent with every request. Called by SessionProvider only. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/**
 * Subscribe to "the current token was rejected (HTTP 401)". SessionProvider uses this to sign out.
 * Returns an unsubscribe function.
 */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/** A fresh Idempotency-Key (UUID v4). One per user action; reuse it when retrying that action. */
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: HttpMethod;
  /** JSON-serialised as the request body. */
  body?: unknown;
  /** Appended as a query string; null/undefined/'' values are skipped. */
  query?: QueryParams;
  /** Sent as the Idempotency-Key header (money-moving POSTs). */
  idempotencyKey?: string;
  /** Attach the bearer token when one is set (default true). */
  auth?: boolean;
  /** Cancel from outside (e.g. a screen unmounting). Rejects with code "aborted". */
  signal?: AbortSignal;
  timeoutMs?: number;
}

function buildUrl(path: string, query?: QueryParams): string {
  let url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (query) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    if (parts.length > 0) url += `${url.includes('?') ? '&' : '?'}${parts.join('&')}`;
  }
  return url;
}

/**
 * Low-level request. Prefer the typed endpoint functions below; use this only for something they
 * do not cover. Resolves with the parsed JSON body (undefined for 204).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, idempotencyKey, auth = true, signal, timeoutMs = REQUEST_TIMEOUT_MS } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const tokenUsed = auth ? authToken : null;
  if (tokenUsed) headers.Authorization = `Bearer ${tokenUsed}`;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    if (timedOut) throw new ApiError(0, 'timeout', TIMEOUT_MESSAGE);
    if (signal?.aborted) throw new ApiError(0, 'aborted', 'Request cancelled.');
    throw new ApiError(0, 'network', __DEV__ ? `${NETWORK_MESSAGE} (API: ${API_URL})` : NETWORK_MESSAGE);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  if (response.status === 204) return undefined as T;

  let text = '';
  try {
    text = await response.text();
  } catch {
    throw new ApiError(response.status || 0, 'network', NETWORK_MESSAGE);
  }
  let json: unknown = undefined;
  if (text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!response.ok) {
    // Only sign out when the token we sent is still the current one (ignore stale requests).
    if (response.status === 401 && tokenUsed !== null && tokenUsed === authToken) {
      for (const listener of [...unauthorizedListeners]) listener();
    }
    if (isErrorBody(json)) {
      const { code, message, fields } = json.error;
      throw new ApiError(response.status, code, message || fallbackMessage(response.status), fields);
    }
    throw new ApiError(response.status, response.status >= 500 ? 'internal' : 'bad_request', fallbackMessage(response.status));
  }

  if (json === undefined) {
    if (text === '') return undefined as T;
    throw new ApiError(response.status, 'bad_response', 'Unexpected response from RipVault. Please try again.');
  }
  return json as T;
}

const id = (value: string) => encodeURIComponent(value);

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function getHealth(): Promise<{ ok: true; time: string }> {
  return apiRequest('/health', { auth: false });
}

export function getConfig(): Promise<AppConfig> {
  return apiRequest('/config', { auth: false });
}

/** Active packs, in shop order. */
export function listPacks(): Promise<PackSummary[]> {
  return apiRequest('/packs');
}

/** Pack with its full odds table (sorted by card value, highest first). */
export function getPack(packId: string): Promise<PackDetail> {
  return apiRequest(`/packs/${id(packId)}`);
}

// ---------------------------------------------------------------------------
// Auth & me
// ---------------------------------------------------------------------------

export function register(body: RegisterRequest): Promise<AuthResponse> {
  return apiRequest('/auth/register', { method: 'POST', body, auth: false });
}

export function login(body: LoginRequest): Promise<AuthResponse> {
  return apiRequest('/auth/login', { method: 'POST', body, auth: false });
}

export function getMe(): Promise<Me> {
  return apiRequest('/me');
}

export function updateMe(body: UpdateMeRequest): Promise<Me> {
  return apiRequest('/me', { method: 'PATCH', body });
}

/** Set/clear the daily spend limit and/or start a cool-off break. Returns the updated Me. */
export function updateLimits(body: UpdateLimitsRequest): Promise<Me> {
  return apiRequest('/me/limits', { method: 'PUT', body });
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

/** Buy and open `quantity` packs (one card each). Response includes the new balance. */
export function openPack(packId: string, quantity: number, idempotencyKey: string): Promise<OpenPackResponse> {
  const body: OpenPackRequest = { quantity };
  return apiRequest(`/packs/${id(packId)}/open`, { method: 'POST', body, idempotencyKey });
}

// ---------------------------------------------------------------------------
// Inventory (vault)
// ---------------------------------------------------------------------------

export interface InventoryParams {
  /** Default "vaulted". */
  status?: InventoryStatus | 'all';
  /** Default "value_desc". */
  sort?: InventorySort;
}

export function getInventory(params: InventoryParams = {}): Promise<InventoryResponse> {
  return apiRequest('/inventory', { query: { status: params.status, sort: params.sort } });
}

export function getInventoryItem(itemId: string): Promise<InventoryItem> {
  return apiRequest(`/inventory/${id(itemId)}`);
}

/** Sell vaulted items back at the buyback rate. All-or-nothing. */
export function sellItems(itemIds: string[], idempotencyKey: string): Promise<SellResponse> {
  const body: SellRequest = { itemIds };
  return apiRequest('/inventory/sell', { method: 'POST', body, idempotencyKey });
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

/** Balance + newest transactions. Pass the previous page's nextCursor as `before` to page back. */
export function getWallet(before?: string | null, limit?: number): Promise<WalletResponse> {
  return apiRequest('/wallet', { query: { before, limit } });
}

/** Start a top-up: either a Stripe Checkout URL to open, or (dev) an instant credit. */
export function topUp(amountPence: number, idempotencyKey: string): Promise<TopupResponse> {
  const body: TopupRequest = { amountPence };
  return apiRequest('/wallet/topup', { method: 'POST', body, idempotencyKey });
}

export function listWithdrawals(): Promise<Withdrawal[]> {
  return apiRequest('/wallet/withdrawals');
}

export function createWithdrawal(body: WithdrawalRequest, idempotencyKey: string): Promise<WithdrawalResponse> {
  return apiRequest('/wallet/withdrawals', { method: 'POST', body, idempotencyKey });
}

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

export function listAddresses(): Promise<Address[]> {
  return apiRequest('/addresses');
}

export function createAddress(input: AddressInput): Promise<Address> {
  return apiRequest('/addresses', { method: 'POST', body: input });
}

export function deleteAddress(addressId: string): Promise<void> {
  return apiRequest(`/addresses/${id(addressId)}`, { method: 'DELETE' });
}

export function getShippingQuote(itemIds: string[]): Promise<ShippingQuoteResponse> {
  return apiRequest('/shipping/quote', { query: { itemIds: itemIds.join(',') } });
}

/** Newest first. */
export function listShipments(): Promise<Shipment[]> {
  return apiRequest('/shipments');
}

export function getShipment(shipmentId: string): Promise<Shipment> {
  return apiRequest(`/shipments/${id(shipmentId)}`);
}

export function createShipment(body: CreateShipmentRequest, idempotencyKey: string): Promise<CreateShipmentResponse> {
  return apiRequest('/shipments', { method: 'POST', body, idempotencyKey });
}

/** Only while status is "requested"; refunds the fee and re-vaults the items. */
export function cancelShipment(shipmentId: string): Promise<CancelShipmentResponse> {
  return apiRequest(`/shipments/${id(shipmentId)}/cancel`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Provably fair & history
// ---------------------------------------------------------------------------

export function getFairness(): Promise<FairnessState> {
  return apiRequest('/fairness');
}

/** Reveal the current server seed and start a new pair. Omit clientSeed for a random one. */
export function rotateSeed(clientSeed?: string): Promise<RotateSeedResponse> {
  const body: RotateSeedRequest = clientSeed ? { clientSeed } : {};
  return apiRequest('/fairness/rotate', { method: 'POST', body });
}

/** Pack opening history, newest first. Pass nextCursor as `before` to page back. */
export function listOpenings(before?: string | null, limit?: number): Promise<OpeningsResponse> {
  return apiRequest('/openings', { query: { before, limit } });
}

/** Everything needed to recompute an opening locally with verifyPull() from @ripvault/shared. */
export function verifyOpening(openingId: string): Promise<VerifyOpeningResponse> {
  return apiRequest(`/openings/${id(openingId)}/verify`);
}
