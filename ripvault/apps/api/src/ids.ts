import { randomBytes } from 'node:crypto';

export type IdPrefix = 'usr' | 'itm' | 'opn' | 'bat' | 'shp' | 'adr' | 'wdr' | 'pay';

/** Unguessable, prefixed ids (80 random bits), e.g. "itm_3f9a0c1d2e4b5a6978e0". */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(10).toString('hex')}`;
}

/** 32 random bytes as 64 lowercase hex characters. */
export function newServerSeed(): string {
  return randomBytes(32).toString('hex');
}

/** Random default client seed: 16 hex characters. */
export function newClientSeed(): string {
  return randomBytes(8).toString('hex');
}
