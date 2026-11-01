/**
 * `npm run prices:sync`: refresh card values from pokemontcg.io and deactivate packs whose EV is
 * now above MAX_PACK_RTP_BPS. Prints the PriceSyncReport.
 */
import { ConfigError, loadConfig } from '../config.ts';
import { openDatabase } from '../db.ts';
import { createLogger } from '../http/logger.ts';
import { syncPrices } from '../prices/sync.ts';

try {
  const config = loadConfig(process.env);
  const db = openDatabase(config.databasePath);
  const report = await syncPrices({
    db,
    config,
    now: () => new Date(),
    fetch: (i, init) => globalThis.fetch(i, init),
    logger: createLogger(),
  });
  db.close();
  console.log(`Price sync (${report.source}) finished at ${report.finishedAt}`);
  console.log(`  updated:   ${report.updated}`);
  console.log(`  unchanged: ${report.unchanged}`);
  console.log(`  missing:   ${report.missing.length}${report.missing.length ? ` (${report.missing.join(', ')})` : ''}`);
  console.log(`  errors:    ${report.errors.length}`);
  for (const e of report.errors) console.log(`    - ${e}`);
  console.log(`  deactivated packs: ${report.deactivatedPacks.length ? report.deactivatedPacks.join(', ') : 'none'}`);
  if (report.errors.length > 0 && report.updated + report.unchanged === 0) process.exit(2);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
