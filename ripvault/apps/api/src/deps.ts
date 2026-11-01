import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { Logger } from './http/logger.ts';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Everything a service needs. Tests inject their own clock and fetch. */
export interface Deps {
  db: Db;
  config: Config;
  now: () => Date;
  fetch: FetchFn;
  logger: Logger;
}

export function iso(date: Date): string {
  return date.toISOString();
}
