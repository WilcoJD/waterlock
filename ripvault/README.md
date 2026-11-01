# RipVault

A mobile app for buying and opening packs of real, physical trading cards. Each pack contains one
real card. You see what it's worth straight away, and then you choose:

- **Vault it.** The card stays in our vault, listed at its live market value.
- **Sell it back** for **90% of its current market value**, credited to your balance at once.
- **Ship it.** We post the physical card to you (flat fee, free over £50 by default).

Every pull is **provably fair**. The draw comes from a server seed that is committed (hashed)
before you open the pack, your own client seed, and a nonce. Rotate your seed and you can re-check
every past opening on your phone.

```
ripvault/
├── packages/shared   Contract + maths shared by API and app: DTO types, SHA-256/HMAC,
│                     provably-fair draw, money (integer pence), pack odds/EV/tiers
├── apps/api          HTTP API: Node ≥ 22.18 with zero runtime dependencies
│                     (node:http, node:sqlite, node:crypto), plus seed data and tests
├── apps/mobile       Expo SDK 54 / Expo Router app (iOS + Android)
└── docs              API.md (endpoint contract), COMPLIANCE.md (read before taking real money)
```

## Quick start

Requirements: Node **22.18+** (it runs TypeScript natively; no build step), npm 10+, and Expo Go
(SDK 54) on a phone, or an iOS simulator or Android emulator.

```bash
npm install                                   # all workspaces
(cd apps/mobile && npx expo install --fix)    # align native module versions with Expo SDK 54

cp apps/api/.env.example apps/api/.env        # optional: defaults are fine for development
npm run seed                                  # creates the DB, 140 cards, 5 packs, demo user
npm run dev:api                               # http://localhost:4000 (listens on 0.0.0.0)

npm run mobile                                # Expo dev server: press i / a, or scan the QR code
```

Demo login: **`demo@ripvault.dev` / `ripvault-demo`** (£50 balance; development only).

On a **physical phone**, the phone and computer must be on the same Wi-Fi. The app works out the
API address from Metro's LAN address. To point it somewhere else, start Expo with
`EXPO_PUBLIC_API_URL=http://<your-ip>:4000 npx expo start -c`. See
[apps/mobile/README.md](apps/mobile/README.md).

Development top-ups credit instantly (`DEV_TOPUPS=1`). For real card payments, set
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and point a Stripe webhook at
`{PUBLIC_URL}/webhooks/stripe`.

### Other commands

| Command | What it does |
|---|---|
| `npm test` | Shared and API test suites (`node:test`) |
| `npm run typecheck` | `tsc` for shared, API and mobile |
| `npm run prices:sync` | Refreshes card values from pokemontcg.io (Cardmarket EUR or TCGplayer USD → GBP) and switches off any pack whose RTP goes over `MAX_PACK_RTP_BPS` |
| `npm run seed` | Idempotent: loads `apps/api/seed/*.json` and creates the admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) and demo users |

## How the money works

- **Everything is integer pence.** Rates are basis points: `BUYBACK_BPS=9000` is 90%. Rounding is
  always down.
- **Packs.** Each pack has an immutable odds *revision*: card weights plus the price. The app
  shows every card's odds, the minimum and maximum pull and the "hit chance" (the chance of
  pulling something worth at least the pack price) before you buy. The seed packs sit at about
  86–87% RTP.
- **Ledger.** Every balance change is an append-only ledger row inside one SQLite transaction:
  pack purchase, buyback, top-up, shipping fee and refund, withdrawal and reversal. The balance
  always equals the sum of the ledger.
- **Idempotency.** Every money-moving request carries an `Idempotency-Key`, so a retry on a
  flaky connection never charges twice.
- **Stock.** Cards worth £25 or more have tracked physical stock. If any tracked card in a pack
  reaches zero, the pack shows **sold out**, so the published odds always stay true. A
  sold-back card goes back into stock.
- **Safer play.** Sign-up is 18+ (by date of birth). Players can set a daily spend limit (raising
  it takes 24 hours to apply) and take a cool-off break of 1, 7 or 30 days.

## Provably fair

```
roll   = first 52 bits of HMAC_SHA256(serverSeed, "<clientSeed>:<nonce>:0") / 2^52
card   = weighted pick over the revision's entries (sorted by cardId) at floor(roll × totalWeight)
commit = SHA256(serverSeed) is shown before any opening; rotating the seed reveals it
```

`packages/shared/src/fairness.ts` is the only implementation. The API uses it to draw, and the
app uses it to verify (`/verify/[id]`).

## Docs

- [docs/API.md](docs/API.md): every endpoint, error code and environment variable.
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md): **read this before taking real money.** Paid random
  packs whose contents can be sold back for withdrawable cash are likely gambling under the UK
  Gambling Act 2005, and the app stores have specific rules for this.
- [apps/api/seed/README.md](apps/api/seed/README.md): catalogue format, how to edit odds, and pack
  stats. Seed prices are **placeholders** until you run `npm run prices:sync`.
- [apps/mobile/README.md](apps/mobile/README.md): running the app, route map, UI conventions.

## Branding

The app name, icon, pack names and marketing are original ("RipVault", "Starter Rip", "Legend
Reserve", …). Card names in listings describe genuine products. Pokémon and its characters are
trademarks of Nintendo, Creatures Inc., GAME FREAK and The Pokémon Company. This project is not
affiliated with or endorsed by them.
