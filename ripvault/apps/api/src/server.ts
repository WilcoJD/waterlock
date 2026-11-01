/**
 * Entry point: `npm run dev` / `npm start` in apps/api.
 */
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import type { Config } from './config.ts';
import { openDatabase } from './db.ts';
import { createLogger } from './http/logger.ts';
import { loadSeedFiles, seedFilesPresent, SEED_DIR } from './seed/load.ts';
import { seedDatabase } from './seed/seed.ts';

const logger = createLogger();

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const db = openDatabase(config.databasePath);
const app = createApp({ config, db, logger });

const packCount = (db.prepare('SELECT COUNT(*) AS n FROM packs').get() as { n: number }).n;
if (packCount === 0) {
  if (seedFilesPresent()) {
    try {
      const report = await seedDatabase(app.deps, loadSeedFiles());
      logger.info('database was empty; seeded', { ...report });
    } catch (err) {
      logger.error('auto-seed failed', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  } else {
    logger.warn('no packs in the database and no seed files found; run `npm run seed`', { seedDir: SEED_DIR });
  }
}

const server = createServer(app.handle);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  logger.info('RipVault API listening', {
    port,
    env: config.env,
    database: config.databasePath,
    stripe: config.stripe !== null,
    devTopups: config.devTopups,
  });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  const force = setTimeout(() => {
    logger.warn('forcing exit after 10s');
    process.exit(1);
  }, 10_000);
  force.unref();
  server.close(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    logger.info('bye');
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
