/**
 * Refresh every card's market value from pokemontcg.io, then switch off any active pack whose
 * expected value is now above MAX_PACK_RTP_BPS of its price (so the house never sells packs at a
 * guaranteed loss after a price spike).
 */
import type { PriceSyncReport } from '@ripvault/shared';
import { all, tx } from '../db.ts';
import type { Deps } from '../deps.ts';
import { RTP_DEACTIVATED_PREFIX, exceedsMaxRtp, rtpPercent } from '../services/admin.ts';
import { getPackEntriesWithValues } from '../services/packs.ts';
import type { PackRow } from '../services/rows.ts';
import { BATCH_SIZE, fetchBatch, priceInPence } from './pokemontcg.ts';
import type { ApiCard } from './pokemontcg.ts';

export interface SyncOptions {
  retryDelayMs?: number;
  attempts?: number;
}

export async function syncPrices(deps: Deps, opts: SyncOptions = {}): Promise<PriceSyncReport> {
  const { db, config } = deps;
  const source = config.priceSource;
  const ids = all<{ id: string }>(db, 'SELECT id FROM cards ORDER BY id');
  const report: PriceSyncReport = {
    updated: 0,
    unchanged: 0,
    missing: [],
    errors: [],
    deactivatedPacks: [],
    source,
    finishedAt: '',
  };

  const update = db.prepare(
    'UPDATE cards SET market_value_pence = ?, price_source = ?, price_updated_at = ?, updated_at = ? WHERE id = ?',
  );
  const touch = db.prepare('UPDATE cards SET price_source = ?, price_updated_at = ? WHERE id = ?');

  // Fetch every batch first, then apply all new prices and the over-RTP deactivation in ONE
  // transaction. Committing batch by batch would leave a pack pushed over the cap by an early batch on
  // sale (at the new values) while later batches are still fetching, or for good if the process died.
  const fetched: { batch: string[]; byId: Map<string, ApiCard> }[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE).map((c) => c.id);
    try {
      const cards = await fetchBatch(batch, {
        fetch: deps.fetch,
        apiKey: config.pokemontcgApiKey,
        attempts: opts.attempts,
        retryDelayMs: opts.retryDelayMs,
      });
      fetched.push({ batch, byId: new Map(cards.map((c) => [c.id, c])) });
    } catch (err) {
      const msg = `Batch ${i / BATCH_SIZE + 1} (${batch[0]} .. ${batch[batch.length - 1]}): ${(err as Error).message}`;
      report.errors.push(msg);
      deps.logger.warn('price sync batch failed', { error: msg });
    }
  }

  const at = deps.now().toISOString();
  tx(db, () => {
    const current = new Map(
      all<{ id: string; market_value_pence: number }>(db, 'SELECT id, market_value_pence FROM cards').map((c) => [c.id, c.market_value_pence]),
    );
    for (const { batch, byId } of fetched) {
      for (const id of batch) {
        const card = byId.get(id);
        if (!card) {
          report.missing.push(id);
          continue;
        }
        let pence: number | null;
        try {
          pence = priceInPence(card, source, { eurGbp: config.fxEurGbp, usdGbp: config.fxUsdGbp });
        } catch (err) {
          report.errors.push(`${id}: ${(err as Error).message}`);
          continue;
        }
        if (pence === null) {
          report.errors.push(`${id}: no ${source} price available`);
          continue;
        }
        if (!current.has(id)) continue; // deleted while fetching
        if (pence !== current.get(id)) {
          update.run(pence, source, at, at, id);
          report.updated++;
        } else {
          touch.run(source, at, id);
          report.unchanged++;
        }
      }
    }
    report.deactivatedPacks = deactivateOverRtpPacks(deps);
  });

  report.finishedAt = deps.now().toISOString();
  deps.logger.info('price sync finished', {
    updated: report.updated,
    unchanged: report.unchanged,
    missing: report.missing.length,
    errors: report.errors.length,
    deactivated: report.deactivatedPacks,
  });
  return report;
}

/**
 * Deactivate active packs whose exact EV / price exceeds the configured maximum. Returns their ids.
 * Joins the caller's transaction when called inside tx().
 */
export function deactivateOverRtpPacks(deps: Deps): string[] {
  const deactivated: string[] = [];
  const at = deps.now().toISOString();
  tx(deps.db, () => {
    const packs = all<PackRow>(deps.db, 'SELECT * FROM packs WHERE active = 1 ORDER BY sort_order, id');
    for (const pack of packs) {
      const entries = getPackEntriesWithValues(deps.db, pack.id);
      if (exceedsMaxRtp(entries, pack.price_pence, deps.config.maxPackRtpBps)) {
        const rtpPct = rtpPercent(entries, pack.price_pence);
        deps.db
          .prepare('UPDATE packs SET active = 0, deactivated_reason = ?, updated_at = ? WHERE id = ?')
          .run(`${RTP_DEACTIVATED_PREFIX}${rtpPct}% above maximum ${(deps.config.maxPackRtpBps / 100).toFixed(2)}%`, at, pack.id);
        deactivated.push(pack.id);
      }
    }
  });
  return deactivated;
}
