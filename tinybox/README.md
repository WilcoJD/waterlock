# Platform (codename TinyBox)

One account and one wallet for four products, all on the same website. A tabbed mega menu in the header links the four sections:

| Section | What users can do | Built on |
|---|---|---|
| **Cloud** | Free ad-supported tiny containers, paid containers, full VMs resold from **UpCloud**. Everything is white-labelled: SSH, websites, IPs and a private WireGuard VPN all carry your brand. | Proxmox LXC, UpCloud API, the gateway agent in this repo |
| **Exchange** | Spot BTC, ETH and SOL against USDT, crypto deposits and withdrawals | [OPEX core](https://github.com/opexdev/core) (MIT). There is also a built-in order book for development. |
| **Derivatives** | USDT-margined perpetual futures (up to 20x), daily and weekly European options | Our own engine, modelled on [Opex-v2 perpetuals](https://github.com/hrshtdotme/Opex-Perpetuals-Trading-Platform) |
| **Cards** | Trading-card exchange grouped by game, then series, then box, pack or single (raw or graded). There is an order book per item, plus vault ship-in, ship-out and pack-break requests. | Shared order book in this repo |

Every money movement in every product goes through one wallet interface (`backend/src/wallet`). There are two backends:

* **`opex`** (production). The OPEX wallet is the single wallet of record. Each user gets a shadow OPEX account. Deposits and withdrawals use OPEX's blockchain gateway, and spot orders go to the OPEX matching engine. Cloud, derivatives and cards charge and pay users through OPEX internal transfers.
* **`local`** (development, or operators who don't run OPEX). This is a double-entry ledger in SQLite with the built-in order book. Admins credit deposits by hand and send withdrawals themselves.

```
tinybox/
├── backend/        Node 22 + Express 5 + SQLite – API for every section, engines, adapters, tests
│   └── src/
│       ├── wallet/       local ledger + OPEX adapter (one wallet for everything)
│       ├── trading/      order book, spot (local/OPEX), perps, options, cards, price oracle, demo market maker
│       ├── cloud/        UpCloud client, providers, cloud-init, gateway client, VPN
│       └── routes/       REST API
├── web/            Website (plain JS, no build step): mega-menu header, all four sections, wallet, admin
├── gateway/        White-label edge agent (SSH forwards, HTTPS subdomains/custom domains, WireGuard, egress SNAT)
├── mobile/         Expo app (cloud section; see "Not built yet")
└── infra/          Proxmox setup, gateway setup, docker-compose next to OPEX, systemd, Caddy
```

## Run it locally (everything mocked)

```bash
cd tinybox/backend
cp .env.example .env     # mocks: Proxmox, UpCloud, Stripe, prices; faucet + demo market maker on
npm install
npm run dev              # http://localhost:8080
npm test                 # 8 end-to-end suites, including ledger-conservation checks
```

Sign up and press **Get test funds** in the wallet. You can then trade spot, open futures, buy options, buy cards, and buy a VM paid from the wallet. Set `GATEWAY_MOCK=true` to see the white-label SSH addresses, subdomains and VPN configs. Any email listed in `ADMIN_EMAILS` gets the admin console, which covers withdrawals, manual deposits, the card vault queue, house balances, servers and users.

## Production setup

### 1. White-label gateway (UpCloud)
1. In UpCloud, create a **private SDN network** (for example `10.88.0.0/16`) and an Ubuntu 24.04 VM that has a public IP and is attached to that network.
2. Set the public IP's reverse DNS to your brand.
3. On that VM, run `PUBLIC_HOST=ssh.yourbrand.com APPS_DOMAIN=apps.yourbrand.com bash infra/gateway-setup.sh`. It installs WireGuard, Caddy and the agent, and prints `GATEWAY_URL` and `GATEWAY_TOKEN`.
4. Add DNS records: `ssh.yourbrand.com` and `*.apps.yourbrand.com` → the gateway IP.
5. In the backend `.env`, set `UPCLOUD_MOCK=false`, an API token (or sub-account), `UPCLOUD_ZONE`, `UPCLOUD_NETWORK` (the SDN UUID) and `UPCLOUD_TEMPLATE` (a cloud-init template's storage UUID).

Customer VMs are created **with no public IP**. Here is what customers see:
* SSH: `ssh root@ssh.yourbrand.com -p 40xxx`
* Websites: `https://name-id.apps.yourbrand.com`, or their own domain via a CNAME with automatic HTTPS
* Private access: their own WireGuard config, which can only reach their own servers
* Outbound traffic from their servers leaves through the gateway's IP (SNAT)

cloud-init sets the hostname and an MOTD with your brand, and blocks the provider metadata endpoint after the first boot.

To keep the cheap tiny containers, run Proxmox on one or more UpCloud VMs. LXC doesn't need nested virtualisation. Run `infra/proxmox-setup.sh` on each, and pass `PROXMOX_ROUTE="10.77.0.0/16 via <node private IP>"` to the gateway setup.

### 2. OPEX (wallet, deposits, spot)
1. Deploy [opexdev/core](https://github.com/opexdev/core) with its docker-compose files, then configure currencies, chains and gateways in OPEX.
2. Create a platform account in OPEX for the house. Put its UUID in `OPEX_SYSTEM_ACCOUNTS`. You can add separate UUIDs for `fees`, `perps`, `options`, `cards`, `escrow` and `cloud`.
3. Set `OPEX_ENABLED=true` and the other `OPEX_*` values, and map deposit networks in `OPEX_GATEWAYS`.
4. Run the platform next to OPEX with `docker compose -f infra/docker-compose.yml up -d --build`.

> **Security:** OPEX's wallet service accepts `/v2/transfer/**` and `/deposit/**` on its internal port without a user token. Never expose the wallet service publicly. Only the platform backend should be able to reach it.

The OPEX adapter (`wallet/opex.js`, `trading/spot.js`) was written against OPEX's current controllers: `/opex/v1/wallet/asset`, `/wallet/deposit/address`, `/opex/v1/withdraw`, `/opex/v1/order`, `/opex/v1/market/depth|trades|ticker`, and wallet `/v2/transfer`. It also uses the standard Keycloak admin API. **It has not been run against a live OPEX deployment yet.** Test it on staging before real money touches it.

### 3. Payments, ads, prices
* Cloud can be paid **from the wallet** (USDT) or **by card** through Stripe (`STRIPE_*`).
* Ads use AdMob in the app and AdSense on the website, as before.
* Set `ORACLE_SOURCE=coinbase` for real index prices. Derivatives pause automatically if the feed goes stale for 60 seconds.
* Production refuses to start if `ALLOW_FAUCET`, `MARKET_MAKER` or `ALLOW_DEV_REWARDS` is on.

## How the pieces work

* **Order book** (`trading/book.js`): price-time priority with limit and market orders and self-trade prevention. Makers pay no fee and takers pay one. Funds are moved into escrow *before* an order touches the book, so a fill can never fail halfway. Any payout that does fail goes into a retry queue (`wallet_outbox`). The tests check after every scenario that each asset's ledger sums to zero and that escrow equals the open orders.
* **Perpetuals** (`trading/perps.js`): isolated margin, entry and exit at index ± spread, liquidation at margin minus maintenance, and take-profit/stop-loss. The platform is the counterparty (`sys:perps`). Per-user notional caps limit how much the house can lose.
* **Options** (`trading/options.js`): Black-Scholes quotes at the configured implied volatility plus a spread. Users buy calls and puts and can sell them back at the bid. Expired options are cash-settled automatically at 08:00 UTC. The platform is the counterparty (`sys:options`), and there's a per-user premium cap.
* **Cards** (`trading/cards.js`): each item SKU has its own book. Holdings are locked while listed or while a ship-out or break is pending. Staff complete vault requests in the admin console; for a break, they enter the cards that were pulled. The seeded catalogue (Aetherbound, Kaiju Clash) is fictional, so replace it with your real inventory.

## Before you launch: decisions that are yours

1. **Licensing and KYC.** Holding customer crypto, running an exchange, and especially offering leveraged futures and options to retail users is regulated almost everywhere. Examples are VASP/CASP registration (MiCA in the EU), money-transmitter licences in the US, and the UK's ban on retail crypto derivatives. **This code has no KYC/AML, geo-blocking or travel-rule handling.** You need these, and probably legal advice, before taking real deposits. `DERIVATIVES_ENABLED=false` turns derivatives off entirely.
2. **House risk.** In this design the platform takes the other side of every futures and options trade. Either fund `sys:perps` and `sys:options` and hedge, or later replace them with a matched book.
3. **Limits of the white-labelling.**
   * A WHOIS lookup on the gateway IP still shows UpCloud's network unless you bring your own IP range.
   * Servers on the shared SDN network can reach each other directly. For strict isolation, use one SDN network per customer or add host firewalls.
   * Check UpCloud's terms on reselling. They have a partner programme.
4. **The perpetuals repo has no LICENSE file.** Only its package.json says "ISC". I modelled the engine on its design but didn't copy any code. Ask the author for a licence before reusing their code directly. OPEX is MIT, so you may use it with attribution.
5. **App stores.** Store payment rules (previous README section) still apply to the mobile app, and crypto features in apps have extra store requirements.

## Not built yet
* KYC, 2FA, email verification and password reset
* the mobile app only covers Cloud (no wallet, trading or cards screens)
* websocket streaming (pages poll every 3–5 seconds)
* candlestick charts (pages show a sparkline)
* funding rates on perps
* user-written options
* partial closes
* card images and price history
* a browser console for servers
* backups
