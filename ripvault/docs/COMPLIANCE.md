# Before you take real money: compliance checklist

RipVault's core loop is *pay → random outcome → item with cash value → sell back / cash out*. That is
the same shape regulators use to define gambling. This file lists what to sort out before launch.
It's a checklist of questions for a lawyer, not legal advice.

## 1. Gambling licensing (UK) — the big one

- Under the Gambling Act 2005, paying for a chance to win a *prize of money or money's worth* can be
  **gaming** or a **lottery**, and both need a Gambling Commission licence. A card you can sell back
  for 90% credit and then **withdraw as cash** is hard to argue isn't "money's worth".
- The UK Gambling Commission has said loot boxes fall outside gambling law when their contents
  *can't be cashed out*. RipVault's buyback and withdrawal features are exactly what moves it
  inside. Physical "mystery box" products have drawn regulatory attention for the same reason.
- Ways to lower the risk, each with a product cost:
  - Set `WITHDRAWALS_ENABLED=0` so buyback only gives non-withdrawable store credit.
  - Remove buyback and ship every pull. This is closer to a blind-box retail model.
  - Get a UKGC remote gaming licence. That brings KYC/AML, safer-gambling and technical standards.
- Other countries differ. Most US states, Belgium and the Netherlands are strict about this.
  Geo-restrict to the places you're cleared for.

## 2. App store rules

- **Apple App Store guideline 5.3** (Gaming, Gambling and Lotteries): real-money gaming apps need
  licences for each region they're offered in, must be free to download, and must be geo-restricted.
  **Guideline 3.1.1** makes you publish the odds of each item type before purchase. The odds sheet
  does this already.
- **Google Play's real-money gambling policy** needs an approved country (the UK is one), a valid
  licence and an application to Google.
- Payments: physical goods can be paid for outside in-app purchase. Apple may still treat a wallet
  balance spent on random digital "packs" as digital content that needs IAP. Get a ruling before
  you submit.

## 3. Age and identity

- The app collects a date of birth and blocks under-18s. That is **self-declaration only**. A
  licensed operator needs real age and identity checks (KYC, through providers such as Yoti, Onfido
  or Veriff) before deposits or withdrawals, plus AML monitoring and source-of-funds checks above
  set thresholds.

## 4. Safer play (already built, extend as needed)

Built so far: daily spend limits (raising a limit waits 24h, lowering is immediate), cool-off
breaks of 1, 7 or 30 days, published odds, provably fair draws, and links to BeGambleAware and
GamCare. A licensed operator also needs: GAMSTOP integration, deposit limits (as well as spend
limits), reality checks and session timers, affordability checks, and staff interaction triggers.

## 5. Intellectual property

- "Pokémon" and the Pokémon characters are trademarks of Nintendo, Creatures Inc., GAME FREAK and
  The Pokémon Company. Keep them out of the app name, icon, pack names and marketing. RipVault's
  pack names are original for this reason. Card names in listings describe genuine products.
- Reselling genuine physical cards is generally allowed (exhaustion of rights). Showing card
  artwork, especially in ads, is a separate question. Images currently load from
  `images.pokemontcg.io`, so check their terms, or photograph your own stock.
- Card prices come from the pokemontcg.io API (Cardmarket and TCGplayer data). Check its terms
  for commercial use and rate limits.

## 6. Consumer and data law

- Terms of service, a refund and cancellation policy (the 14-day cooling-off rules for distance
  sales have exceptions here), clear pricing, and ASA/CAP rules for ads aimed at young audiences.
- UK GDPR: privacy notice, lawful basis, retention policy and data-subject requests. Dates of birth
  and addresses are personal data. Payout details are sensitive and should be encrypted at rest
  in production.

## 7. Operational controls

- Fund segregation: hold player balances in a separate account, which a licence usually requires.
- Physical stock: `cards.stock` must match your real vault. A pack shows as sold out as soon as any
  card in it hits zero tracked stock, so published odds always stay true.
- Pricing risk: run `npm run prices:sync` on a schedule. Packs whose expected value goes above
  `MAX_PACK_RTP_BPS` of their price are switched off automatically.
