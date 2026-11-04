# Compliance plugin

`backend/src/plugins/compliance/` + `web/js/compliance.js`. KYC tiers, tiered limits, geo and product restrictions, terms/risk-disclosure versioning, travel-rule data, transaction monitoring with account freezing, sanctions screening, and an audit-log viewer. Everything is enforced server-side through the platform hooks; the browser module only adds the pages and modals.

> **Not legal advice.** The defaults (tier limits, restricted countries, thresholds) are sensible starting points taken from public regulatory sources (see References) but every operator must set them with their own counsel for the jurisdictions they serve.

## What users get

* **Verification levels 0–3** (`#/verify-identity`, also linked from *Exchange → Account → Verification*):
  * **Level 1 – Basic**: full legal name, date of birth (18+), nationality, country of residence, address, phone.
  * **Level 2 – Identity document**: document type / number / issuing country / expiry, plus uploads of the ID front, ID back (not for passports) and a selfie holding the document.
  * **Level 3 – Enhanced**: proof of address upload, optional source-of-funds evidence, and a questionnaire (occupation, employer, source of funds, expected monthly volume, PEP self-declaration).
  * Levels are applied for in order. Users keep a **draft** (fields and documents are saved as they go), then **submit**. They see *under review*, *approved*, or *rejected with the reviewer's reason*, and can start again after a rejection or expiry.
  * Uploads: JPEG, PNG or PDF, max 8 MB each (`COMPLIANCE_MAX_FILE_MB`), checked by **magic bytes** (the client's content-type is ignored). Files are stored under `<DB directory>/kyc/<userId>/<random>.<ext>` with mode 0600, optionally **AES-256-GCM encrypted** at rest (`COMPLIANCE_FILE_KEY`), and are **only** served to admins through an authenticated endpoint (never by the static file server, never back to the user).
* **Limits & usage** on the verification page and in the Account panel: withdrawals (24h / 30d), open futures notional, open options premium, cloud spend (30d), maximum card order. Bars turn amber at 80 % and red when exhausted.
* **Clear errors**: when a cap is hit the API answers `400 { code: 'LIMIT_EXCEEDED', data: { action, window, key, limit, used, requested, tier, tier_required } }` with a sentence that names the limit, the usage and the level that would raise it; the website shows a modal with a *Verify identity* button.
* **Terms & risk disclosure versions**: registering accepts the current versions (the signup form says so). When `COMPLIANCE_TERMS_VERSION` / `COMPLIANCE_RISK_VERSION` change, the next trade or withdrawal returns `403 { code: 'ACCEPT_TERMS', data: { terms_version, risk_version, accepted_* } }`; the website opens an acceptance modal and retries the call.
* **Travel rule**: a withdrawal worth ≥ `COMPLIANCE_TRAVEL_RULE_USD` (default $1,000, FATF R.16 / EU TFR threshold) without beneficiary data returns `400 { code: 'TRAVEL_RULE_INFO_REQUIRED', data: { threshold_usd, amount_usd, fields, errors } }`. The website collects beneficiary name, self/third-party, self-hosted vs VASP (name + country) and a self-custody attestation, then retries with `travel_rule: {...}` in the body. The declaration is stored with the withdrawal together with a snapshot of the originator (the user's verified identity).
* **Geo-restrictions**: residents of sanctioned countries cannot sign up, trade, withdraw or buy cloud (`403 COUNTRY_BLOCKED`); residents of derivatives-restricted countries cannot open perpetuals or buy options (`403 PRODUCT_RESTRICTED`). The country is the `cf-ipcountry` header (or whatever `COMPLIANCE_COUNTRY_HEADER` names) when present, else the residence the user declared at level 1.
* **Frozen accounts** (`users.frozen = 1`, set by compliance staff) can log in and look, but every withdrawal, order, position or cloud purchase answers `403 ACCOUNT_FROZEN`. Frozen is independent of `banned`.

## Admin pages (`#/admin?tab=compliance`)

| Sub-tab | What it does |
|---|---|
| **KYC queue** | Submitted cases oldest-first (filters: status, email/id). *Review* opens the case: declared fields, documents rendered inline (images and PDFs, fetched with the admin JWT), sanctions-screening result, the user's other cases and open flags. Actions: **Approve**, **Reject…** (reason is mandatory and shown to the user), **Expire** (approved cases), **Set level** manually (0–3, with a reason), **Freeze / Unfreeze** the account. Every action and every document view is written to `audit_log`. |
| **Flags** | Monitoring hits with severity, rule, user, details JSON, hit counter. **Dismiss**, **Escalate**, **Freeze** (freezes the user and closes the flag). Clicking a user opens a compliance overview (limits, withdrawals, travel-rule declarations, flags, audit trail). |
| **Countries & sanctions** | Every ISO 3166-1 country with its effective rule (sanctioned yes/no, derivatives default/allowed/blocked, note); overrides are stored in `compliance_country_rules` and win over the env defaults. Below: the sanctions name list — add single entries, **import** OFAC `SDN.CSV` (+`ALT.CSV` aliases), one-name-per-line, or JSON; **screen** a name to test the matcher. |
| **Travel rule** | Declarations with the linked withdrawal (and its status), beneficiary, wallet type / VASP, and the originator snapshot. |
| **Audit log** | Paginated view of the core `audit_log` (all plugins), filterable by action prefix, user id (actor or target), date range and free text (details, email, IP). |

The compliance header line shows the current terms/risk versions, travel-rule threshold, whether documents are encrypted, and how many accounts are frozen.

## Configuration

All keys are read by the plugin's `config()`; `config.compliance` can also be pre-set in tests. Tier limits can additionally be overridden at runtime through the settings plugin key `compliance.tiers` (same JSON shape as `COMPLIANCE_TIERS`; read lazily via `ctx.settings.get`).

| Env | Default | Meaning |
|---|---|---|
| `COMPLIANCE_ENABLED` | `true` | `false` keeps the API and admin pages but registers **no hooks** (nothing is enforced). Logged loudly at start. |
| `COMPLIANCE_COUNTRY_HEADER` | `cf-ipcountry` | Request header carrying the visitor's ISO alpha-2 country (Cloudflare's header; set your own with nginx/`geoip2`, AWS `CloudFront-Viewer-Country`, …). Values that are not a known code (`XX`, `T1`) mean *unknown*. **Only trust it when your proxy sets it** – a client can send it directly otherwise. |
| `COMPLIANCE_TERMS_VERSION` | `2026-01` | Current terms-of-service version. Bump to force re-acceptance. |
| `COMPLIANCE_RISK_VERSION` | `2026-01` | Current risk-disclosure version. |
| `COMPLIANCE_TRAVEL_RULE_USD` | `1000` | Withdrawals at or above this USD value need beneficiary information. `0` disables. |
| `COMPLIANCE_SANCTIONED_COUNTRIES` | `CU,IR,KP,SY` | Comma list of comprehensively sanctioned countries (no signup/trade/withdraw/cloud). Empty string = none. |
| `COMPLIANCE_DERIVATIVES_RESTRICTED` | `US,GB,CA,JP,HK,SG,KR,CN,BE,AU` | Countries whose residents may not use perpetuals/options (retail derivatives bans/licensing – see `countries.js` for the source per country). |
| `COMPLIANCE_TIERS` | see below | JSON object `{ "0": {...}, "1": {...}, "2": {...}, "3": {...} }`; keys `label`, `withdraw_daily_usd`, `withdraw_monthly_usd`, `perps_notional_usd`, `options_premium_usd`, `cloud_monthly_usd`, `card_order_usd`. `null` = unlimited. Missing keys keep the default. |
| `COMPLIANCE_KYC_DIR` | `<dir of DB_PATH>/kyc` | Where documents are stored (a temp dir for `:memory:` databases). Keep it out of any web root and in your backups/retention policy. |
| `COMPLIANCE_FILE_KEY` | *(empty)* | Passphrase for AES-256-GCM encryption of stored documents (`.enc` files; key = SHA-256 of the passphrase). Strongly recommended in production (a warning is logged when missing). Rotating it requires re-encrypting existing files. |
| `COMPLIANCE_MAX_FILE_MB` | `8` | Per-document upload limit. |
| `COMPLIANCE_KYC_VALIDITY_DAYS` | `0` | Approved cases expire after this many days (hourly job); `0` = never. Expiry lowers the user's level to the highest still-valid approval. |
| `COMPLIANCE_VELOCITY_WITHDRAWALS_PER_HOUR` | `5` | Flag (medium) when a user requests this many withdrawals within an hour. |
| `COMPLIANCE_VELOCITY_DEPOSIT_WITHDRAW_MINUTES` | `30` | Flag (high, "pass-through") when a withdrawal follows a deposit within this many minutes. |
| `COMPLIANCE_VELOCITY_ROUND_TRIP_USD` | `100000` | Flag (medium) when a user's 24h spot volume reaches this and buys ≈ sells (within 20 %); also flags ≥ 80 % of volume against a single counterparty. |
| `COMPLIANCE_LARGE_WITHDRAWAL_USD` | `10000` | Flag (low, informational) for single withdrawals at or above this value. |
| `COMPLIANCE_SCREENING_THRESHOLD` | `0.85` | Name-similarity score (0–1) above which a sanctions-list entry counts as a match (max of Jaro–Winkler and token-set overlap; +0.05 when the year of birth matches). |

Default tier table (USD):

| Level | Withdraw / 24h | Withdraw / 30d | Open futures notional | Open options premium | Cloud / 30d | Max card order |
|---|---|---|---|---|---|---|
| 0 Unverified | 2,000 | 5,000 | 2,000 | 500 | 200 | 500 |
| 1 Basic | 10,000 | 50,000 | 25,000 | 5,000 | 2,000 | 5,000 |
| 2 Verified | 50,000 | 250,000 | 50,000 | 10,000 | 10,000 | 25,000 |
| 3 Enhanced | 500,000 | 2,000,000 | 250,000 | 50,000 | 100,000 | 250,000 |

Engine-level caps (`PERPS_MAX_NOTIONAL`, `OPTIONS_MAX_PREMIUM`) still apply on top. Non-USDT withdrawals are valued with the index oracle at check time (stale feed ⇒ `503 PRICE_UNAVAILABLE`, the withdrawal is refused rather than unchecked).

## Database

Added by the plugin schema/migration (all idempotent): `users.kyc_tier`, `users.frozen`; tables `compliance_profiles`, `kyc_cases`, `kyc_documents`, `compliance_terms_acceptances`, `compliance_country_rules`, `compliance_travel_rule`, `compliance_flags`, `compliance_sanctions`. `users.kyc_tier` is the single source of truth for the level (approve = max(current, case tier); expire = highest remaining approval; manual set = exact).

## REST API

All paths are under `/api/compliance`. User endpoints need `Authorization: Bearer <jwt>`; admin endpoints need an admin JWT. Errors are `{ error, code?, data? }`.

### Public
| Method & path | Returns |
|---|---|
| `GET /countries` | `{ countries: [{ code, name }] }` (ISO 3166-1 alpha-2 reference list) |
| `GET /terms` | `{ current: { terms_version, risk_version }, accepted }` (acceptance details when a JWT is sent) |
| `GET /kyc/schema` | Field/document schema per tier (types, enums, which documents are required) – drives the forms |

### User
| Method & path | Body / query | Returns |
|---|---|---|
| `GET /me` | | tier, label, frozen, country `{ code, name, source: header|declared, declared }`, `derivatives_allowed`, `terms`, `travel_rule_usd`, `limits`, `usage`, `rows` (per limit: limit/used/remaining), `tiers`, `kyc { next_tier, pending_case, current_case, cases }` |
| `GET /limits` | | `{ tier, label, limits, usage, rows, tiers }` |
| `POST /terms/accept` | `{ terms_version, risk_version }` (must equal current) | acceptance status; `409 ACCEPT_TERMS` if stale |
| `GET /travel-rule?asset=&amount=` | | `{ required, threshold_usd, amount_usd, fields }` – ask before showing the withdraw form |
| `GET /kyc/cases` | | `{ cases, next_tier, tier }` |
| `POST /kyc/cases` | `{ tier }` (must be current level + 1) | `201 { case }` – creates or returns the draft; `409 KYC_PENDING` while a review is open |
| `GET /kyc/cases/:id` | | `{ case }` (own cases only) |
| `PUT /kyc/cases/:id` | `{ fields: {...} }` (partial; `null` clears) | `{ case }` – draft only; values are validated for shape, required fields are checked at submit |
| `POST /kyc/cases/:id/documents` | `multipart/form-data`: `kind` (`id_front`,`id_back`,`selfie`,`proof_of_address`,`source_of_funds_doc`) + `file` | `201 { document: { id, kind, mime, size, original_name } }`; replaces an existing document of the same kind. `400 UNSUPPORTED_FILE_TYPE`, `413 FILE_TOO_LARGE`, `400 BAD_MULTIPART` |
| `DELETE /kyc/cases/:id/documents/:docId` | | `{ ok }` (draft only) |
| `POST /kyc/cases/:id/submit` | | `{ case }` with `status: 'submitted'`; `400 VALIDATION { data.field }` names the first missing field/document |

Case object: `{ id, user_id, tier, status: draft|submitted|approved|rejected|expired, fields, reason, created_at, updated_at, submitted_at, decided_at, expires_at, documents[], required_documents[{ kind, label, required }] }`. Screening results are admin-only.

Withdrawal with travel-rule data: `POST /api/wallet/withdraw { asset, chain, address, amount, travel_rule: { beneficiary_name, beneficiary_type: self|third_party, wallet_type: self_hosted|vasp, vasp_name?, vasp_country?, self_hosted_confirmed? } }`.

Login response (`POST /api/auth/login`) gains `compliance: { tier, frozen, terms_accepted, country }` for mobile clients.

### Admin (`/api/compliance/admin/...`)
| Method & path | Body / query | Notes |
|---|---|---|
| `GET /overview` | | counts of cases by status, open flags by severity, frozen users, users per tier, list sizes, current config |
| `GET /kyc/queue` | `status` (default `submitted`, or `all`), `q`, `page`, `limit` | PII-free rows + `counts` |
| `GET /kyc/cases/:id` | | full case incl. `fields`, `documents`, `screening` (audited `compliance.kyc.viewed`) |
| `GET /kyc/documents/:id` | | the file, `Content-Disposition: inline`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, sandboxed CSP (audited `compliance.kyc.document_viewed`) |
| `POST /kyc/cases/:id/approve` | `{ note? }` | sets the level, copies name/DOB/country to the profile, notifies the user |
| `POST /kyc/cases/:id/reject` | `{ reason }` (required) | user can resubmit |
| `POST /kyc/cases/:id/expire` | `{ reason? }` | approved → expired, level recomputed |
| `GET /users/:id` | | profile, terms, limits, cases, flags, travel-rule records, withdrawals, audit trail |
| `POST /users/:id/tier` | `{ tier: 0-3, reason? }` | manual level |
| `POST /users/:id/freeze` / `unfreeze` | `{ reason }` / `{ note? }` | emits `compliance.account_frozen`, notifies the user |
| `GET /flags` | `status` (default `open`), `severity`, `user`, `page`, `limit` | |
| `POST /flags/:id/dismiss|escalate|freeze` | `{ note? }` | `freeze` also freezes the user |
| `GET /countries` | | all countries with effective rule, env defaults, header name |
| `PUT /countries/:code` | `{ sanctioned?: bool, derivatives?: allowed|blocked|default, note? }` | upsert override |
| `DELETE /countries/:code` | | remove override |
| `GET /sanctions` | `q`, `page`, `limit` | |
| `POST /sanctions` | `{ name, aliases[], source?, program?, ref_id?, country?, dob?, note?, type? }` | |
| `DELETE /sanctions/:id` | | |
| `POST /sanctions/import` | JSON `{ format: ofac_sdn|lines|json, text, alt?, source?, replace? }` or multipart (`sdn`, `alt` files + `format`/`source`/`replace` fields, up to 64 MB) | `{ imported, removed, source }` |
| `POST /sanctions/screen` | `{ name, dob?, threshold? }` | `{ matches: [{ id, name, matched, score, source, program, ref_id, country, dob }] }` |
| `GET /travel-rule` | `user`, `page`, `limit` | declarations joined with withdrawal status |
| `GET /audit` | `action` (prefix), `actor`, `target`, `user`, `from`, `to` (YYYY-MM-DD), `q`, `page`, `limit` (≤200) | `{ items, total, page, limit }` |
| `GET /audit/actions` | | distinct actions with counts (for the filter dropdown) |

### Error codes
`LIMIT_EXCEEDED` (400), `TRAVEL_RULE_INFO_REQUIRED` (400), `VALIDATION` (400, `data.field`), `UNSUPPORTED_FILE_TYPE` (400), `BAD_MULTIPART` (400), `FILE_TOO_LARGE` (413), `ACCEPT_TERMS` (403 on actions, 409 on a stale accept), `COUNTRY_BLOCKED` (403), `PRODUCT_RESTRICTED` (403), `ACCOUNT_FROZEN` (403), `KYC_PENDING` (409), `NOT_DRAFT` (409), `TIER_ORDER` (400), `ALREADY_VERIFIED` (400), `PRICE_UNAVAILABLE` (503).

## Hooks, events and the `ctx.compliance` service

Hooks registered (when enabled): `auth.register.before` (sanctioned country), `auth.login.after` (adds `extra.compliance`, flags sanctioned-country logins), `withdraw.before` (frozen → country → terms → limits → travel rule), `trade.before` (frozen → country → terms → derivatives restriction → perps notional / options premium / card order size), `cloud.checkout.before` (frozen → country → monthly cloud cap).

Events consumed: `user.registered` (records implicit terms acceptance), `withdraw.requested` (links the travel-rule record to the withdrawal id, runs velocity rules), `deposit.credited` (feeds the pass-through rule for wallet backends without ledger entries), `order.filled` (round-trip / counterparty rules).

Events emitted:

| Event | Payload |
|---|---|
| `compliance.kyc_submitted` | `{ case, userId, tier }` |
| `compliance.kyc_decided` | `{ case, userId, decision: approved|rejected|expired, tier, reviewerId, tier_before, tier_after }` |
| `compliance.tier_changed` | `{ userId, from, to, actorId }` |
| `compliance.flag` | `{ flag, userId, rule, severity }` |
| `compliance.account_frozen` | `{ userId, frozen: true|false, reason?, actorId, flagId? }` |

Audit actions written: `compliance.kyc.submitted|viewed|document_viewed|approved|rejected|expired`, `compliance.tier.set`, `compliance.terms.accepted`, `compliance.flag.dismissed|escalated|frozen`, `compliance.account.frozen|unfrozen`, `compliance.country.rule|rule_removed`, `compliance.sanctions.added|removed|imported`.

Service (`ctx.compliance`, for other plugins):
* `tierOf(userId)` → 0–3; `limits(userId)` → `{ tier, label, limits, usage, rows, tiers }`
* `async check(userId, action, amountUsd, { req?, restrictions? })` – `action` ∈ `withdraw|perps|options|cloud|cards|spot|trade`; throws the same `HttpError`s the hooks throw (frozen, sanctioned declared country, terms, caps)
* `isFrozen(userId)`, `countryOf(req, userId)`, `usdValue(asset, units, { lenient })`
* sub-services `geo`, `terms`, `travel`, `kyc`, `monitor`, `limitsEngine`, `files`, plus `overview`, `adminUser`, `auditLog`

Notifications go through `ctx.notify.notify(userId, { type: 'compliance.kyc'|'compliance.frozen', title, body, link })` when the notify plugin is present.

## Operations runbook

* **Geo header**: terminate TLS at a proxy that sets the country header (Cloudflare → enable *Add visitor location headers*; nginx → `proxy_set_header CF-IPCountry $geoip2_data_country_code;`) and **strip any client-supplied value**. Without the header only the declared residence is used.
* **Document storage**: set `COMPLIANCE_FILE_KEY` before the first upload; back up the KYC directory with the database; restrict filesystem access to the backend user; define a retention period (AMLD5: 5 years after the end of the relationship) and delete `kyc_documents` rows + files together.
* **Sanctions lists**: download `SDN.CSV` + `ALT.CSV` from the OFAC Sanctions List Service (and the EU consolidated list / UK OFSI list converted to the JSON or line format), import with *Replace existing entries of this source* checked, on a schedule (OFAC changes several times a week). Name screening is fuzzy; every match is a **flag for a human**, nothing is auto-rejected. For production-grade screening (transliteration, DOB/ID matching, ongoing re-screening) plug a provider in by replacing `monitor.screen()`.
* **Travel rule messaging**: the plugin stores originator/beneficiary data; transmitting it to the beneficiary VASP (TRISA, OpenVASP/TRP, Notabene, Sumsub…) is done by your messaging provider – read `GET /admin/travel-rule` or subscribe to `withdraw.requested` and join `compliance_travel_rule`. With the OPEX wallet backend no `withdraw.requested` event exists; the hourly `reconcile()` links declarations to withdrawal rows by user/asset/address/amount and deletes declarations that never produced a withdrawal after 24 h.
* **Freezing vs banning**: freezing keeps the account visible to the user and keeps their servers running; use the core *Ban* for abuse. Unfreezing is audited and notifies the user.
* **Changing terms**: bump the version env, redeploy; users are prompted on their next trade/withdrawal; acceptance records (`compliance_terms_acceptances`) include IP and user agent.
* **Tuning limits in production**: change `COMPLIANCE_TIERS` (restart) or set `compliance.tiers` in the settings plugin (immediate). Limits apply at request time; open positions are never force-closed.
* **Rate limits**: per-user limits on case creation (30/h), field saves (120/h), uploads (40/h), submits (20/h), terms acceptance (30/h); document views (600/h per admin).
* **Disabling**: `COMPLIANCE_ENABLED=false` removes all enforcement (development only; the log says so at start).

## References

* FATF – Updated Guidance for a Risk-Based Approach to Virtual Assets and VASPs (2021), incl. Recommendation 16 "travel rule" and the USD/EUR 1,000 threshold: https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html
* FATF – High-risk and other monitored jurisdictions: https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html
* FATF – Politically exposed persons (R.12/R.22): https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Peps-r12-r22.html
* Regulation (EU) 2023/1113 (Transfer of Funds Regulation, crypto travel rule, applies from 30 Dec 2024): https://eur-lex.europa.eu/eli/reg/2023/1113/oj
* Regulation (EU) 2023/1114 (MiCA): https://eur-lex.europa.eu/eli/reg/2023/1114/oj
* Directive (EU) 2018/843 (AMLD5 – CDD for crypto exchanges, 5-year record keeping): https://eur-lex.europa.eu/eli/dir/2018/843/oj
* FCA PS20/10 – Prohibiting the sale to retail clients of investment products that reference cryptoassets (in force 6 Jan 2021): https://www.fca.org.uk/publications/policy-statements/ps20-10-prohibiting-sale-retail-clients-investment-products-reference-cryptoassets
* OFAC Sanctions List Service – SDN list downloads and file formats (SDN.CSV / ALT.CSV / ADD.CSV, `-0-` null convention): https://sanctionslist.ofac.treas.gov/Home/SdnList and https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists
* OFAC sanctions programs and country information: https://ofac.treasury.gov/sanctions-programs-and-country-information
* EU consolidated financial sanctions list: https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions
* EU Sanctions Map API (regimes): https://www.sanctionsmap.eu/api/v1/regime
* UK OFSI consolidated list: https://www.gov.uk/government/publications/the-uk-sanctions-list
* FinCEN advisory FIN-2019-A003 – red flags for convertible virtual currency: https://www.fincen.gov/resources/advisories/fincen-advisory-fin-2019-a003
* ISO 3166-1 alpha-2 country codes: https://www.iso.org/iso-3166-country-codes.html (cross-checked against https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
* Cloudflare `CF-IPCountry` header (`XX` unknown, `T1` Tor): https://developers.cloudflare.com/fundamentals/reference/http-headers/
* RFC 7578 multipart/form-data: https://www.rfc-editor.org/rfc/rfc7578 · RFC 2046 multipart syntax: https://www.rfc-editor.org/rfc/rfc2046 · RFC 6266 Content-Disposition: https://www.rfc-editor.org/rfc/rfc6266
* File signatures (JPEG/PNG/PDF magic bytes): https://en.wikipedia.org/wiki/List_of_file_signatures
* Jaro–Winkler similarity: https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance
* express-rate-limit: https://github.com/express-rate-limit/express-rate-limit · Node `crypto` AES-GCM: https://nodejs.org/api/crypto.html
