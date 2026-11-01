# TinyBox

Free and paid tiny Linux containers on Proxmox, with a website, a REST backend and a mobile app.

* **Free tier.** One tiny Alpine container per user (128 MB RAM, 1 GB disk, 25% CPU, 1 Mbit/s). It starts with 4 hours. Each rewarded ad watched in the app adds 1 hour, up to 24 hours ahead and 12 ads a day. The container is deleted when the time runs out.
* **Shop.** Paid plans (Nano, Micro, Small, Medium) are bought with Stripe Checkout and last 30 days. Users can buy, renew, or upgrade a free or paid server; an upgrade keeps the server's files. Expired paid servers are stopped and deleted after 7 days unless renewed.
* **Ads.** AdMob rewarded and banner ads in the app, with server-side verification so rewards can't be faked. The website shows AdSense to free users.

```
tinybox/
├── backend/   Node 22 + Express 5 + SQLite (node:sqlite). API, Proxmox driver, Stripe, AdMob SSV, expiry job
├── web/       Website (plain HTML/CSS/JS, served by the backend): landing, pricing/shop, dashboard, admin
├── mobile/    Expo / React Native app: servers, rewarded ads, banners, shop, account
└── infra/     Proxmox host setup script, systemd unit, Caddyfile
```

## Quick start (no Proxmox needed)

```bash
cd tinybox/backend
cp .env.example .env          # PROXMOX_MOCK=true, Stripe empty = mock checkout
npm install
npm run dev                   # http://localhost:8080
npm test                      # end-to-end API tests
```

In mock mode the containers are fake, checkout completes immediately and the "+1h (dev reward)" button stands in for an ad. Any email listed in `ADMIN_EMAILS` gets the admin page when it registers.

### Mobile app

```bash
cd tinybox/mobile
npm install
npx expo install --fix        # align native module versions with your Expo SDK
npx expo prebuild
npx expo run:android          # or run:ios. Ads need a dev build; Expo Go won't work.
```

Set `extra.apiUrl` in `app.json` to your backend. `10.0.2.2:8080` reaches your computer from the Android emulator. In development the app uses Google's test ad units.

## Going live

1. **Proxmox host.** Run `WAN_IF=vmbr0 bash infra/proxmox-setup.sh` on the host. It creates the NAT bridge `vmbr1`, the SSH port forwards (port `20000+i` goes to container `i`), SMTP and host-access blocks, a least-privilege API token and the Alpine template. Copy the values it prints into `.env` and set `PROXMOX_MOCK=false`.
2. **Backend.** Copy it to `/opt/tinybox`, then `npm ci --omit=dev`, install `infra/tinybox.service` and put `infra/Caddyfile` in front of it for HTTPS. You can use Docker instead: `docker build -f backend/Dockerfile .` from `tinybox/`.
   Set `NODE_ENV=production`, a long random `JWT_SECRET`, `ALLOW_DEV_REWARDS=false` and `PUBLIC_URL`.
3. **Stripe.** Set `STRIPE_SECRET_KEY`. Add a webhook to `https://YOUR_DOMAIN/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. **AdMob.** Create an app, a rewarded unit and a banner unit. Put the app IDs in the `app.json` plugin config and the unit IDs in `extra.ads`. On the rewarded unit, turn on server-side verification with the callback `https://YOUR_DOMAIN/api/ads/admob-ssv`. You can also put the unit ID in `ADMOB_AD_UNIT_IDS` so only that unit is accepted.
5. **AdSense (web).** Uncomment the script in `web/index.html` and set `ADSENSE_CLIENT` and `ADSENSE_SLOT` in `web/app.js`.
6. **Brand.** "TinyBox" is a placeholder. Change `BRAND_NAME`, the `app.json` name, slug, bundle IDs and scheme, and the logo text.

## How it works

* **Provisioning** (`backend/src/provisioner.js`) picks the online node with the most free RAM and allocates a VMID in `VMID_MIN..VMID_MAX`. It then creates an unprivileged LXC from the template. The container gets a static IP derived from its VMID (`10.77.x.y`), CPU and network limits, and a random root password that is shown to the user once. The user can also supply an SSH key. The NAT rules are generated ahead of time for the whole VMID range, so the backend never needs shell access to the host.
* **Expiry job.** Every minute it deletes expired free servers, stops expired paid ones (state `suspended`) and deletes suspended servers after 7 days. Renewing a suspended server starts it again.
* **Ad rewards.** The app shows a rewarded ad with `userId` and `customData = serverId`. Google calls `/api/ads/admob-ssv`, and the backend checks the ECDSA signature against Google's published keys before adding time. Each transaction is only counted once, and rewards are capped per day.
* **Payments.** Each purchase is first saved as an order. The Stripe webhook then fulfils it, and fulfilment is idempotent, so a webhook delivered twice doesn't apply twice. In the app, checkout opens in an in-app browser and returns to `tinybox://order`.

### API summary

| | |
|---|---|
| `POST /api/auth/register` `login`, `GET /api/auth/me`, `POST /api/auth/change-password` | accounts (JWT) |
| `GET /api/servers`, `POST /api/servers/free`, `GET/DELETE /api/servers/:id`, `POST /api/servers/:id/{start,stop,shutdown,reboot}` | servers |
| `GET /api/shop/plans`, `POST /api/shop/checkout {kind:new\|renew\|upgrade}`, `GET /api/shop/orders[/:id]` | shop |
| `GET /api/ads/status`, `GET /api/ads/admob-ssv`, `POST /api/ads/dev-reward` | ads |
| `GET /api/admin/{stats,users,servers}`, `POST /api/admin/users/:id/ban`, `DELETE /api/admin/servers/:id` | admin |

## Things to decide before launch

* **App store payments.** Apple and Google usually require their own in-app purchase system for digital goods bought inside an app. Hosting that is used outside the app is a grey area. The safest route is to add IAP (for example through RevenueCat) and fulfil orders through the same `fulfillOrder` path, or to sell only on the website. Check current store rules first.
* **Abuse.** Free servers attract crypto miners and spammers. The defaults are a CPU cap, a 1 Mbit/s network limit, SMTP blocked, one free server per account and a global cap (`FREE_MAX_TOTAL`). For more protection, add email verification, a captcha on signup, and PVE firewall rules that isolate containers from each other.
* **Not built yet:**
  * password reset by email
  * a browser console (proxy Proxmox `termproxy`/`vncwebsocket`)
  * IPv6 per container
  * backups for paid plans
  * subscriptions that auto-renew (switch Checkout to `mode: 'subscription'`)
