/**
 * Reads apps/api/seed/cards.json and packs.json (resolved relative to this package, not the cwd).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedCard, SeedPack } from '@ripvault/shared';

export const SEED_DIR = fileURLToPath(new URL('../../seed/', import.meta.url));

export interface SeedData {
  cards: SeedCard[];
  packs: SeedPack[];
}

export class SeedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedFileError';
  }
}

export function seedFilesPresent(dir = SEED_DIR): boolean {
  return existsSync(join(dir, 'cards.json')) && existsSync(join(dir, 'packs.json'));
}

function readJsonArray(dir: string, name: string): unknown[] {
  const path = join(dir, name);
  if (!existsSync(path)) {
    throw new SeedFileError(
      `Seed file not found: ${path}\nThe API expects apps/api/seed/cards.json (SeedCard[]) and apps/api/seed/packs.json (SeedPack[]).`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new SeedFileError(`Seed file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new SeedFileError(`Seed file ${path} must contain a JSON array`);
  return parsed;
}

export function loadSeedFiles(dir = SEED_DIR): SeedData {
  return {
    cards: readJsonArray(dir, 'cards.json') as SeedCard[],
    packs: readJsonArray(dir, 'packs.json') as SeedPack[],
  };
}
