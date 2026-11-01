# RipVault HTTP API

Base URL: `http://<host>:4000` (default port `4000`, override with `PORT`).
All request/response bodies are JSON. Types live in `packages/shared/src/types.ts`; this file is the
endpoint contract. **Money is integer pence. Timestamps are ISO-8601 UTC.**

## Conventions

- **Auth:** `Authorization: Bearer <token>` (HS256 JWT, 30-day expiry). Endpoints marked 🔒 need it;
  🛡️ needs `role = admin`.
- **Errors:** non-2xx responses always have the body `ApiErrorBody`:
  `{ "error": { "code": ErrorCode, "message": string, "fields"?: Record<string,string> } }`.
  | HTTP | code(s) |
  |------|---------|
  | 400 | `bad_request`, `validation_failed` (with `fields`) |
  | 401 | `unauthorized`, `invalid_credentials` |
  | 402 | `insufficient_funds` |
  | 403 | `forbidden`, `underage`, `cooling_off`, `spend_limit_reached` |
  | 404 | `not_found` |
  | 409 | `conflict`, `email_taken`, `sold_out`, `pack_unavailable`, `invalid_state` |
  | 429 | `rate_limited` |
  | 503 | `payments_unavailable` |
  | 500 | `internal` |
- **Idempotency:** money-moving `POST`s accept an `Idempotency-Key` header (1–100 chars). The first
  response for a (user, key) pair is stored for 24h and replayed byte-for-byte for repeats, so a
  mobile retry never double-charges. Supported on: open pack, sell, top-up, create shipment,
  withdrawal. The app sends a fresh UUID per user action.
- **Pagination:** cursor based; pass the previous response's `nextCursor` as `?before=`.
- **CORS:** `Access-Control-Allow-Origin: *` (bearer tokens, no cookies).
- **Limits:** JSON bodies max 64 KB. Auth endpoints rate limited per IP (10/min).

## Public

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health` | – | `{ ok: true, time }` |
| GET | `/config` | – | `AppConfig` |
| GET | `/packs` | – | `PackSummary[]` (active packs, sorted by `sortOrder`) |
| GET | `/packs/:id` | – | `PackDetail` (odds sorted by value desc) |
| GET | `/payments/return?status=success\|cancel` | – | small HTML page: "Return to the app" (Stripe redirect target) |
| POST | `/webhooks/stripe` | raw Stripe event | `{ received: true }` — verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`; credits on `checkout.session.completed` once (idempotent on session id) |

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `RegisterRequest` | `201 AuthResponse` |
| POST | `/auth/login` | `LoginRequest` | `AuthResponse` |

Register rules: valid email (lower-cased, unique → `email_taken`), password ≥ 8 chars, display name
1–32 chars, `acceptTerms === true`, `dateOfBirth` valid `YYYY-MM-DD` and age ≥ `minimumAge` (18) → else
`underage`. A fresh server seed / client seed pair is created for the user.

## Me 🔒

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/me` | – | `Me` |
| PATCH | `/me` | `UpdateMeRequest` | `Me` |
| PUT | `/me/limits` | `UpdateLimitsRequest` | `Me` |

Limits: lowering `dailySpendLimitPence` (or setting one where none existed) applies immediately.
Raising it or clearing it (`null`) is stored as pending and applies 24h later
(`pendingEffectiveAt`). `coolOffDays` sets `coolingOffUntil = now + days` (can only be extended, never
shortened). While cooling off: opening packs and top-ups fail with `cooling_off`; selling, shipping
and withdrawals still work.

## Packs 🔒

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/packs/:id/open` | `OpenPackRequest` | `OpenPackResponse` |

Open, in one DB transaction:
1. Pack must exist and be active (`pack_unavailable`), quantity 1..`maxOpenQuantity`.
2. Not cooling off; `spentLast24h + price × quantity ≤ dailySpendLimit` (`spend_limit_reached`).
3. Debit `price × quantity` (`insufficient_funds` if balance too low) — one `pack_purchase`
   transaction per pack.
4. For each pack `i`: `nonce = user.nonce + i`, `drawCard(revisionEntries, serverSeed, clientSeed, nonce)`.
   If the drawn card has tracked stock 0 → whole request rolls back with `sold_out`.
   Decrement tracked stock; create `pack_openings` row + `inventory_items` row (status `vaulted`,
   `valueAtPull = card.marketValuePence`).
5. `user.nonce += quantity`.

## Inventory 🔒

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/inventory?status=vaulted\|shipping\|shipped\|sold\|all&sort=value_desc\|value_asc\|newest\|oldest` | – | `InventoryResponse` (defaults: `status=vaulted`, `sort=value_desc`) |
| GET | `/inventory/:id` | – | `InventoryItem` |
| POST | `/inventory/sell` | `SellRequest` | `SellResponse` |

Sell: all ids must belong to the caller and be `vaulted` (else `invalid_state`, nothing sold). Each
item credits `floor(card.marketValuePence × buybackBps / 10000)` as one `buyback` transaction,
status → `sold`, tracked card stock +1 (the physical card stays in our vault). 1–100 ids.

## Wallet 🔒

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/wallet?before=<cursor>&limit=50` | – | `WalletResponse` |
| POST | `/wallet/topup` | `TopupRequest` | `TopupResponse` |
| GET | `/wallet/withdrawals` | – | `Withdrawal[]` |
| POST | `/wallet/withdrawals` | `WithdrawalRequest` | `201 WithdrawalResponse` |

Top-up: amount within `topup.minPence..maxPence`, not cooling off. If Stripe is configured →
creates a Checkout Session (`kind: "checkout"`, open `checkoutUrl` in a browser; the webhook credits
the wallet). Else if `DEV_TOPUPS=1` and not production → credits instantly (`kind: "credited"`).
Else `payments_unavailable`.

Withdrawals: debit immediately (`withdrawal` transaction, status `pending`); an admin marks them
`paid` or `rejected` (rejected refunds via `withdrawal_reversal`). `payoutDetails` 3–200 chars.

## Shipping 🔒

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/addresses` | – | `Address[]` |
| POST | `/addresses` | `AddressInput` | `201 Address` |
| DELETE | `/addresses/:id` | – | `204` (soft delete) |
| GET | `/shipping/quote?itemIds=a,b,c` | – | `ShippingQuoteResponse` |
| GET | `/shipments` | – | `Shipment[]` (newest first) |
| GET | `/shipments/:id` | – | `Shipment` |
| POST | `/shipments` | `CreateShipmentRequest` | `201 CreateShipmentResponse` |
| POST | `/shipments/:id/cancel` | – | `CancelShipmentResponse` |

Create shipment: 1..`maxItemsPerShipment` vaulted items owned by caller, address owned by caller and
country in `shipping.countries`. Fee = `shippingFeePence(totalValue, config.shipping)`, debited as
`shipping_fee` (`insufficient_funds` if needed). Items → `shipping`. Address is snapshotted onto the
shipment. Cancel: only while `requested`; refunds fee (`shipping_refund`), items → `vaulted`.

## Provably fair 🔒

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/fairness` | – | `FairnessState` |
| POST | `/fairness/rotate` | `RotateSeedRequest` | `RotateSeedResponse` |
| GET | `/openings?before=<cursor>&limit=50` | – | `OpeningsResponse` |
| GET | `/openings/:id/verify` | – | `VerifyOpeningResponse` |

Rotate: reveals the current server seed (stored in seed history with its client seed and final
nonce), generates a new server seed, sets the client seed (given or random 16 hex chars), nonce → 0.
`Opening.serverSeed` is filled in for openings whose seed has been revealed.

## Admin 🛡️

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/admin/shipments?status=` | – | `Shipment[]` (+ `userEmail` on each) |
| PATCH | `/admin/shipments/:id` | `AdminUpdateShipmentRequest` | `Shipment` (transitions per `SHIPMENT_TRANSITIONS`; admin cancel also refunds and re-vaults; `shipped` sets items `shipped`) |
| GET | `/admin/withdrawals?status=` | – | `Withdrawal[]` (+ `userEmail`) |
| PATCH | `/admin/withdrawals/:id` | `AdminUpdateWithdrawalRequest` | `Withdrawal` (only from `pending`) |
| GET | `/admin/packs/:id/report` | – | `AdminPackReport` |
| PUT | `/admin/packs/:id/odds` | `AdminSetOddsRequest` | `PackDetail` (new immutable revision; rejected if RTP > `MAX_PACK_RTP_BPS`) |
| PUT | `/admin/cards/:id/stock` | `{ stock: number \| null }` | `CardSummary` |
| POST | `/admin/prices/sync` | – | `PriceSyncReport` |

## Environment variables (apps/api)

| Var | Default | Notes |
|---|---|---|
| `PORT` | `4000` | |
| `DATABASE_PATH` | `./data/ripvault.db` | `:memory:` for tests |
| `JWT_SECRET` | dev value | **required** (≥ 32 chars) when `NODE_ENV=production` |
| `BUYBACK_BPS` | `9000` | 90% |
| `MAX_PACK_RTP_BPS` | `9500` | packs whose EV/price exceeds this are auto-deactivated by price sync |
| `SHIPPING_FLAT_FEE_PENCE` | `399` | |
| `SHIPPING_FREE_OVER_PENCE` | `5000` | empty = never free |
| `SHIPPING_COUNTRIES` | `GB` | comma separated |
| `DEV_TOPUPS` | `1` in dev | ignored in production |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | – | enables Stripe Checkout top-ups |
| `PUBLIC_URL` | `http://localhost:4000` | for Stripe redirect URLs |
| `WITHDRAWALS_ENABLED` | `1` | |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | – | seed creates/updates this admin |
| `SEED_DEMO_USER` | `1` in dev | creates `demo@ripvault.dev` / `ripvault-demo` with £50 |
| `POKEMONTCG_API_KEY` | – | optional, raises pokemontcg.io rate limit |
| `PRICE_SOURCE` | `cardmarket` | or `tcgplayer` |
| `FX_EUR_GBP` / `FX_USD_GBP` | `0.86` / `0.79` | |
