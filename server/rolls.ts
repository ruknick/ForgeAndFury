import { randomInt, randomUUID } from 'node:crypto';

/** Cryptographically secure float in [0,1). All relic rolls go through this (spec §7). */
export const secureRandom = () => randomInt(0, 2 ** 48 - 1) / 2 ** 48;
export const secureSeed = () => randomInt(1, 2 ** 31 - 1);
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
