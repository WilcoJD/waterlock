/**
 * pokemontcg.io v2 price lookups. Prices come back in EUR (cardmarket) or USD (tcgplayer) and
 * are converted to pence with the configured FX rate.
 */
import { convertToPence } from '@ripvault/shared';
import type { PriceSource } from '../config.ts';
import type { FetchFn } from '../deps.ts';

export const POKEMONTCG_API = 'https://api.pokemontcg.io/v2/cards';
export const BATCH_SIZE = 40;

export interface ApiCard {
  id: string;
  tcgplayer?: { prices?: Record<string, { market?: number | null } | null> | null } | null;
  cardmarket?: { prices?: { trendPrice?: number | null; averageSellPrice?: number | null } | null } | null;
}

export function batchUrl(ids: readonly string[]): string {
  const q = ids.map((id) => `id:"${id.replace(/["\\]/g, '')}"`).join(' OR ');
  // encodeURIComponent (spaces as %20, not "+") is the safest encoding for the Lucene-style q.
  return `${POKEMONTCG_API}?q=${encodeURIComponent(q)}&select=id,tcgplayer,cardmarket&pageSize=250`;
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Price in pence for one card, or null when the source has no usable price. */
export function priceInPence(card: ApiCard, source: PriceSource, fx: { eurGbp: number; usdGbp: number }): number | null {
  if (source === 'cardmarket') {
    const p = card.cardmarket?.prices;
    const eur = positive(p?.trendPrice) ? p!.trendPrice! : positive(p?.averageSellPrice) ? p!.averageSellPrice! : null;
    return eur === null ? null : convertToPence(eur, fx.eurGbp);
  }
  const variants = card.tcgplayer?.prices;
  if (!variants || typeof variants !== 'object') return null;
  let best: number | null = null;
  for (const [variant, v] of Object.entries(variants)) {
    // Our vintage stock is Unlimited print (see seed/README.md): a 1st Edition price would overvalue it.
    if (/^1stedition/i.test(variant)) continue;
    const m = v?.market;
    if (positive(m) && (best === null || m > best)) best = m;
  }
  return best === null ? null : convertToPence(best, fx.usdGbp);
}

export interface FetchBatchOptions {
  fetch: FetchFn;
  apiKey: string | null;
  attempts?: number;
  retryDelayMs?: number;
}

/** Fetch one batch of cards. Retries 429/5xx and network errors. Throws with a readable message. */
export async function fetchBatch(ids: readonly string[], opts: FetchBatchOptions): Promise<ApiCard[]> {
  const attempts = opts.attempts ?? 3;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.apiKey) headers['X-Api-Key'] = opts.apiKey;
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await opts.fetch(batchUrl(ids), { headers, signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        const body = (await res.json()) as { data?: unknown };
        if (!Array.isArray(body.data)) throw new Error('response has no data array');
        return body.data.filter((c): c is ApiCard => !!c && typeof c === 'object' && typeof (c as ApiCard).id === 'string');
      }
      lastError = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < attempts && (opts.retryDelayMs ?? 1_500) > 0) {
      await new Promise((r) => setTimeout(r, (opts.retryDelayMs ?? 1_500) * attempt));
    }
  }
  throw new Error(lastError);
}
