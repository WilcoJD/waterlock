# Seed data: launch card catalogue and pack line-up

These two files are what `npm run seed` loads into a fresh database:

| File | Type (`@ripvault/shared`) | What it holds |
|---|---|---|
| `cards.json` | `SeedCard[]` | 140 real English trading cards that we hold (or will hold) as physical copies in the vault |
| `packs.json` | `SeedPack[]` | The 5 launch packs and their odds tables. Each pack gives exactly **one** card. |

> **⚠️ The values are placeholders.** Every `marketValuePence` in `cards.json` is a rough GBP
> estimate written from memory. It is **not** live market data and may be well out of date.
> Before launch, and on a schedule after it, run
>
> ```sh
> npm run prices:sync        # pulls prices from pokemontcg.io (Cardmarket EUR or TCGplayer USD, converted to GBP)
> ```
>
> Then check every pack's RTP again (see [Checking a pack](#checking-a-pack)). The stats table at the
> bottom of this file only holds for the placeholder values.

## `cards.json`

The file is one JSON object per line, so diffs stay readable.

```json
{"id":"swsh7-215","name":"Umbreon VMAX","setId":"swsh7","setName":"Evolving Skies","number":"215","rarity":"Rare Secret",
 "imageSmall":"https://images.pokemontcg.io/swsh7/215.png","imageLarge":"https://images.pokemontcg.io/swsh7/215_hires.png",
 "marketValuePence":120000,"stock":2}
```

| Field | Rule |
|---|---|
| `id` | The card's [pokemontcg.io](https://pokemontcg.io) API id, `<setId>-<number>`. Price sync looks cards up by this id, so it must be exact. |
| `setId`, `number` | Always the two halves of `id`. `number` is the collector number without leading zeros (`"54"`, not `"054"`). |
| `setName`, `rarity` | Match pokemontcg.io's wording (`"Base"`, `"151"`, `"Rare Holo"`, `"Special Illustration Rare"`, …). Display only. |
| `imageSmall` / `imageLarge` | `https://images.pokemontcg.io/<setId>/<number>.png` and `…/<number>_hires.png`. |
| `marketValuePence` | Integer pence. **Placeholder** until price sync runs. The card's tier comes from this (`tierForValue`): common < £1 ≤ uncommon < £5 ≤ rare < £25 ≤ epic < £100 ≤ legendary. |
| `stock` | Physical copies on hand. `null` = not tracked (cards under £25 are treated as bulk we can always source). Cards worth £25 or more have a count from 2 to 20, with fewer copies of the pricier cards. |

Conditions assumed by the placeholder values: raw (ungraded), near-mint English copies. The WOTC cards
(`base1`, `base2`, `base3`, `base5`, `gym2`, `neo1`, `neo2`) are priced as **Unlimited** prints, not 1st Edition or Shadowless.
pokemontcg.io lists one id per card for all of these, so price sync should read the unlimited
(`unlimitedHolofoil` / `unlimited`) price where the source gives one.

What the catalogue holds:

- **By tier:** 20 common, 30 uncommon, 22 rare, 39 epic and 29 legendary.
- **68 stock-tracked cards:** 664 copies in all, worth about £50,600 at the placeholder values.
- **22 sets from three eras:**
  - **WOTC:** Base, Jungle, Fossil, Team Rocket, Gym Challenge, Neo Genesis and Neo Discovery.
  - **Sword & Shield:** Darkness Ablaze, Champion's Path, Vivid Voltage, Evolving Skies, Fusion Strike, Brilliant Stars, Lost Origin and Silver Tempest.
  - **Scarlet & Violet:** Paldea Evolved, Obsidian Flames, 151, Paldean Fates, Twilight Masquerade, Surging Sparks and Prismatic Evolutions.
- **Every card is in at least one launch pack.**

The catalogue has no Crown Zenith cards. We weren't sure enough of their main-set collector numbers,
so we left them out rather than risk wrong ids. Add them after checking each id against the pokemontcg.io API.

## `packs.json`

```json
{
  "id": "starter", "name": "Starter Rip", "tagline": "…", "pricePence": 100, "sortOrder": 1,
  "theme": {"from":"#1e40af","to":"#0b1530","accent":"#60a5fa"},
  "entries": [ {"cardId":"sv3pt5-10","weight":7500}, … ]
}
```

| Pack | `id` | Price | Theme | Idea |
|---|---|---:|---|---|
| Starter Rip | `starter` | £1 | sapphire | Mostly bulk 151 and vintage commons. About 1 pull in 4 is worth £1 or more, and the top pull is the 151 Charmander IR. |
| Rare Hunt | `rare-hunt` | £5 | emerald | No 5p bulk: vintage commons and modern V/ex cards, with WOTC holos and a 151 Charizard ex SIR to chase. |
| Eeveelution Prism | `eeveelution` | £10 | sunset/amber | **Eevee and its evolutions only**: Evolving Skies V/VMAX, Jungle and Neo holos, alt arts and Prismatic Evolutions SIRs. |
| Elite Vault | `elite` | £25 | violet | Nothing under £3.50: 151 illustration rares, WOTC holos, SIRs and modern alt arts. |
| Legend Reserve | `legend` | £100 | gold/black | Every pull is £11 or more. Chase cards include Base Set Charizard, Moonbreon, the Umbreon ex SIR and the Lugia/Giratina alt arts. |

The pack names and the RipVault brand are our own. Only the card names are real.

### How odds work (and how to edit them)

- **Chance and weights.** A card's chance is `weight / sum(weights in the pack)`. Weights must be positive integers, with no
  duplicate `cardId` in a pack (`validateEntries` in `@ripvault/shared`). The weights in each pack add up to
  roughly 100,000, so 1,000 weight is about 1%. That is only a convention: any integers work.
- **Order.** Entry order doesn't matter. Provably-fair draws always sort entries by `cardId` first (`canonicalEntries`).
- **Editing before the first seed.** Change the weights in `packs.json`, check the pack (below), then run `npm run seed`.
- **Editing a live pack.** Use `PUT /admin/packs/:id/odds`, not this file. That creates a new **immutable revision**, so past
  openings can still be verified against the table they used. The API rejects tables whose RTP is above
  `MAX_PACK_RTP_BPS` (default 95%).
- **Sold-out packs.** If any stock-tracked card in a pack reaches 0, the pack shows as sold out until it is restocked
  (`PUT /admin/cards/:id/stock`) or its odds are changed.

Rules every launch pack meets at the placeholder values:

| Rule | Starter | Rare Hunt / Eeveelution | Elite | Legend |
|---|---|---|---|---|
| RTP (EV ÷ price) | 0.82 – 0.90 | 0.82 – 0.90 | 0.82 – 0.90 | 0.82 – 0.90 |
| Hit chance (pull worth ≥ price) | 8 – 35% | 8 – 35% | 8 – 35% | 8 – 35% |
| Lowest pull | ≥ 3% of price | ≥ 10% of price | ≥ 10% of price | ≥ 10% of price |
| Highest pull | ≥ 10× price | ≥ 10× price | ≥ 5× price | ≥ 4× price |
| Chance of the single most valuable card | ≥ 0.05% (1 in 2,000) | same | same | same |

An RTP below 1 is the house edge. It means the operator doesn't lose money on average, even before
the 90% buyback and shipping fees.

### Checking a pack

The pack maths lives in `@ripvault/shared` (`packStats`). To print every pack's stats from the repo root:

```sh
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { packStats } from '@ripvault/shared';
const cards = new Map(JSON.parse(readFileSync('apps/api/seed/cards.json', 'utf8')).map((c) => [c.id, c]));
for (const p of JSON.parse(readFileSync('apps/api/seed/packs.json', 'utf8'))) {
  const s = packStats(p.entries.map((e) => ({ weight: e.weight, valuePence: cards.get(e.cardId).marketValuePence })), p.pricePence);
  console.log(p.id.padEnd(12), 'EV', s.evPence, 'RTP', s.rtp.toFixed(3), 'hit', s.hitChance.toFixed(3), 'min', s.minPence, 'max', s.maxPence);
}"
```

**After a price sync,** compare each pack's RTP with the 0.82–0.90 band. At launch each pack has room for a uniform rise
of about 9–11% across its cards before it reaches the 95% `MAX_PACK_RTP_BPS` ceiling. Price sync
deactivates a pack automatically above that ceiling.

**If a pack drifts,** re-tune it:

- **RTP too high:** move weight from the hit cards to the floor cards.
- **RTP too low:** move weight the other way.

## Per-pack stats at placeholder values

`packStats` floors EV to whole pence, and RTP is computed from that floored EV.

| Pack | Price | Cards | EV | RTP | Hit chance (≥ price) | Min pull | Max pull | Top card | Top card chance |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| `starter` | £1.00 | 35 | £0.86 | 86.0% | 23.9% (1 in 4) | £0.05 | £18.00 | Charmander IR (sv3pt5-168) | 0.11% (1 in 922) |
| `rare-hunt` | £5.00 | 35 | £4.33 | 86.6% | 21.3% (1 in 5) | £0.60 | £190.00 | Charizard ex SIR (sv3pt5-199) | 0.088% (1 in 1,137) |
| `eeveelution` | £10.00 | 32 | £8.73 | 87.3% | 10.1% (1 in 10) | £1.80 | £1,200.00 | Umbreon VMAX alt art (swsh7-215) | 0.056% (1 in 1,797) |
| `elite` | £25.00 | 35 | £21.68 | 86.7% | 27.6% (1 in 4) | £3.50 | £500.00 | Rayquaza VMAX alt art (swsh7-218) | 0.069% (1 in 1,453) |
| `legend` | £100.00 | 35 | £85.82 | 85.8% | 25.1% (1 in 4) | £11.00 | £1,200.00 | Umbreon VMAX alt art (swsh7-215) | 0.28% (1 in 356) |

The tier mix is each tier's share of pulls. Tiers are set by card value (see `tierForValue` above).

| Pack | Common | Uncommon | Rare | Epic | Legendary |
|---|---:|---:|---:|---:|---:|
| `starter` | 76.1% | 21.1% | 2.86% | – | – |
| `rare-hunt` | 19.5% | 59.1% | 18.5% | 2.76% | 0.088% |
| `eeveelution` | – | 82.1% | 7.79% | 8.81% | 1.31% |
| `elite` | – | 11.2% | 61.2% | 24.4% | 3.24% |
| `legend` | – | – | 8.33% | 66.6% | 25.1% |

### Stock runway

"Opens until the first card is expected to sell out" is the minimum of `stock ÷ chance` over each pack's tracked cards.
It treats each pack on its own. Some cards are in more than one pack (for example Moonbreon is in both
Eeveelution and Legend), so real runway is shorter. Restock before these numbers run out.

| Pack | Stock-tracked cards | EV share of its 3 most valuable cards | Opens until first card is expected to sell out | Limiting card |
|---|---:|---:|---:|---|
| `starter` | 0 | 8.9% | n/a (no tracked cards) | – |
| `rare-hunt` | 8 | 9.9% | ~2,842 | Zapdos ex SIR (sv3pt5-202, stock 10) |
| `eeveelution` | 18 | 13.4% | ~719 | Flareon holo (base2-3, stock 20) |
| `elite` | 19 | 8.0% | ~436 | Snorlax holo (base2-11, stock 12) |
| `legend` | 29 | 10.6% | ~240 | Blastoise (base1-2, stock 10) |

## Ids to double-check

The card ids were written from memory. Price sync reports any id that pokemontcg.io doesn't know in
`PriceSyncReport.missing`, so run it once and fix or remove what it lists.

These ids are the most likely to be wrong:

- **Evolving Skies regular V/VMAX:** `swsh7-7`, `swsh7-8`, `swsh7-40`, `swsh7-41`, `swsh7-64`, `swsh7-65`, `swsh7-74`, `swsh7-75`.
- **Evolving Skies VMAX alt arts:** `swsh7-205`, `swsh7-209`, `swsh7-212`.
- **Prismatic Evolutions SIRs:** `sv8pt5-155`, `sv8pt5-156`, `sv8pt5-167`.
- **151:** `sv3pt5-179`, `sv3pt5-181`, `sv3pt5-201`, `sv3pt5-202`, `sv3pt5-203`, `sv3pt5-205`.
- **Others:** `sv4pt5-54`, `sv4pt5-232`, `sv8-57`, `swsh3-19`.
- **Rarity wording only:** `swsh35-74` and `swsh4-188` are labelled `"Rare Rainbow"`, but pokemontcg.io may say `"Rare Secret"`.
