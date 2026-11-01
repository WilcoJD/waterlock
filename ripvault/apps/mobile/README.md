# RipVault mobile (`@ripvault/mobile`)

Expo SDK 54 + Expo Router 6 + TypeScript (strict). Dark mode only. Players buy and rip packs of real
trading cards (one physical card per pack), see the live value of every pull, then keep it in their
vault, sell it back for 90% of market value, or ship it home.

## Run it

```bash
# 1. Install everything from the repo root (npm workspaces).
npm install

# 2. Align native module versions with Expo SDK 54 (run inside apps/mobile).
cd apps/mobile && npx expo install --fix && cd ../..

# 3. Start the API (port 4000, listens on 0.0.0.0). Seeding also creates the dev demo account.
npm run seed
npm run dev:api

# 4. Start the app.
npm run mobile            # same as: cd apps/mobile && npx expo start
```

Then press `i` (iOS simulator), `a` (Android emulator), or scan the QR code with **Expo Go** (SDK 54)
on your phone. Every native module used ships in Expo Go, so no custom dev build is needed. For a
dev build use `npx expo run:ios` / `npx expo run:android` (or EAS Build).

Development demo login: `demo@ripvault.dev` / `ripvault-demo` (the sign-in screen offers a
"Fill demo login" button in dev builds only).

### Pointing the app at the API

See `src/config.ts`. Resolution order:

1. `EXPO_PUBLIC_API_URL` if set, e.g. `EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 npx expo start -c`
   (`-c` clears the cache so the new value is inlined).
2. In development, the LAN address Metro is served from, with port 4000. On a **physical phone**,
   phone and computer must be on the same Wi-Fi and the API must listen on `0.0.0.0` (its default).
3. `http://localhost:4000` (simulators on the same machine).

`expo start --tunnel` does not forward port 4000; expose the API separately (or deploy it) and set
`EXPO_PUBLIC_API_URL`. Production builds must use an `https://` URL.

### Type-check

```bash
npm run typecheck -w @ripvault/mobile    # tsc --noEmit
```

## Route map (`app/`)

| Route | File | Presentation | Purpose |
|---|---|---|---|
| `/login` | `(auth)/login.tsx` | card | Sign in (redirects to `/` once signed in) |
| `/register` | `(auth)/register.tsx` | card | Create account (18+ DOB, terms) |
| `/` | `(tabs)/index.tsx` | tab "Packs" | Pack shop |
| `/vault` | `(tabs)/vault.tsx` | tab "Vault" | Vaulted cards, sell back, ship |
| `/wallet` | `(tabs)/wallet.tsx` | tab "Wallet" | Balance, transactions, top-up, withdraw |
| `/profile` | `(tabs)/profile.tsx` | tab "Profile" | Stats, limits, fairness, settings |
| `/pack/[id]` | `pack/[id].tsx` | modal | Pack detail + odds + open button |
| `/open/[id]` | `open/[id].tsx` | fullScreenModal, no swipe-dismiss | Rip animation + reveal (confirm step without an in-app ticket) |
| `/item/[id]` | `item/[id].tsx` | card | Inventory item detail |
| `/ship` | `ship.tsx` | card | Choose cards + address, request shipment |
| `/addresses` | `addresses.tsx` | card | Saved addresses |
| `/shipments` | `shipments/index.tsx` | card | Shipment list |
| `/shipments/[id]` | `shipments/[id].tsx` | card | Shipment detail / cancel |
| `/topup` | `topup.tsx` | modal | Add funds (Stripe Checkout or dev credit) |
| `/withdraw` | `withdraw.tsx` | card | Request a payout |
| `/fairness` | `fairness.tsx` | card | Seeds, nonce, rotate |
| `/history` | `history.tsx` | card | Pack opening history |
| `/verify/[id]` | `verify/[id].tsx` | card | Recompute an opening locally |
| `/limits` | `limits.tsx` | card | Daily spend limit, cool-off |
| `/edit-profile` | `edit-profile.tsx` | card | Display name |

Auth gating: `(tabs)/_layout.tsx` shows a spinner while the saved session is checked and redirects
to `/login` when signed out; `app/_layout.tsx` also sends signed-out players on any other non-auth
route to `/login`. Deep link scheme: `ripvault://` (the Stripe return page links to
`ripvault://wallet?topup=success|cancel`). Links never buy packs: `app/+native-intent.tsx` sends
`ripvault://open/<pack>` to the odds sheet `/pack/<pack>`, and the rip screen only starts a purchase
on its own when an in-app Rip button sent the player there (single-use in-memory ticket); otherwise
it shows a confirm step with the cost and balance. Authenticated requests wait until the saved token
has been read at launch, so a screen opened by a link on a cold start does not get a 401.

## Folder structure

```
apps/mobile
├── app/                     Expo Router routes (screens only)
├── src/
│   ├── api/client.ts        typed API client, ApiError, newIdempotencyKey
│   ├── state/session.tsx    SessionProvider / useSession (token in SecureStore)
│   ├── state/config.tsx     AppConfigProvider / useAppConfig (GET /config)
│   ├── hooks/useQuery.ts    data fetching hook for screens
│   ├── components/          UI kit (import from components/index.ts)
│   ├── lib/                 haptics, date/format helpers, form validation
│   ├── theme.ts             colours, tier colours, gradients, spacing, radii, typography
│   └── config.ts            API_URL resolution, timeouts, support links
├── app.json  metro.config.js  tsconfig.json  expo-env.d.ts
```

## Conventions (for anyone adding screens)

- **Imports:** relative paths with the file extension (`'../src/components/index.ts'`,
  `'./Button.tsx'`), `import type` for types, no path aliases. DTO types and money/odds/fairness
  helpers come from `@ripvault/shared`.
- **Allowed packages only:** expo, expo-router, react, react-native, react-native-safe-area-context,
  react-native-screens, expo-linking, expo-constants, expo-status-bar, expo-linear-gradient,
  expo-secure-store, expo-haptics, expo-web-browser, expo-crypto, expo-clipboard,
  @expo/vector-icons (Ionicons), @ripvault/shared. Animations use React Native's `Animated`
  (`useNativeDriver: true` for transform/opacity).
- **Money is integer pence.** Show it with `<MoneyText pence={...} />` or `formatPence()`; parse
  input with `parsePounds()`; buyback offers with `buybackPence(value, config.buybackBps)`.
- **Screens:** `<Screen header={<AppHeader ... />}>`. Tab roots use `<AppHeader />` (wordmark +
  balance); pushed screens `<AppHeader title="..." back />`; sheet modals (`/topup`, `/pack/[id]`)
  use `<Screen modal ...>` and `<AppHeader title="..." back="close" />`.
- **Lists:** fetch with `useQuery`, and always handle `loading` (`LoadingState`/`Skeleton`), empty
  (`EmptyState`), error (`ErrorState` with `onRetry={q.refetch}` when there is no data, otherwise a
  toast) and pull-to-refresh (`refreshControl={themedRefreshControl(q.refreshing, q.refresh)}`).
  For a FlatList inside `<Screen>` (non-scroll), add
  `contentContainerStyle={{ paddingBottom: useScreenBottomPadding() }}`.
- **Money-moving actions:** create one `newIdempotencyKey()` per user action and reuse it for
  retries; after success call `setBalance(res.balancePence)` from `useSession()`, fire a haptic
  (`haptic.success()`), and confirm with `useToast().success(...)`. Show `errorMessage(e)` on
  failure (`toast.error(e)`).
- **Style:** tokens from `src/theme.ts` only (no stray hex values), `StyleSheet.create`, radius
  16-28 for surfaces, `AppText variant="label"` for small uppercase labels, `variant="money"` for
  amounts. Primary CTA is `<Button variant="holo" />`.
- **Accessibility:** every tappable has `accessibilityRole` + `accessibilityLabel` (the kit's
  components set these), 44pt minimum touch targets, respect safe areas.
- **Branding:** the app is "RipVault". Do not use the Pokémon name or logos in app text, pack
  names or icons; card names in listings are fine.
