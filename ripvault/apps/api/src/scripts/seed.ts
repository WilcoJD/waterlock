/**
 * `npm run seed`: upsert cards and packs from apps/api/seed/*.json, plus the admin (ADMIN_EMAIL /
 * ADMIN_PASSWORD) and, outside production, the demo player. Safe to run repeatedly.
 */
import { ConfigError, loadConfig } from '../config.ts';
import { openDatabase } from '../db.ts';
import { silentLogger } from '../http/logger.ts';
import { SeedFileError, loadSeedFiles } from '../seed/load.ts';
import { seedDatabase } from '../seed/seed.ts';

try {
  const config = loadConfig(process.env);
  const db = openDatabase(config.databasePath);
  const report = await seedDatabase(
    { db, config, now: () => new Date(), fetch: (i, init) => globalThis.fetch(i, init), logger: silentLogger },
    loadSeedFiles(),
  );
  db.close();
  console.log(`Seeded ${config.databasePath}`);
  console.log(`  cards:     ${report.cardsInserted} new, ${report.cardsUpdated} updated`);
  console.log(`  packs:     ${report.packsInserted} new, ${report.packsUpdated} updated, ${report.revisionsCreated} new odds revisions`);
  console.log(`  admin:     ${report.admin}`);
  console.log(`  demo user: ${report.demoUser}`);
  if (report.deactivatedPacks.length > 0) {
    console.log(`  WARNING: inactive because EV is above MAX_PACK_RTP_BPS: ${report.deactivatedPacks.join(', ')}`);
  }
} catch (err) {
  if (err instanceof ConfigError || err instanceof SeedFileError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
