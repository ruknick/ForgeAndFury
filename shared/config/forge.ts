import type { SpecialKind } from '../types';

/**
 * The Forge (spec §4.4 stretch goal): clearing the input tile types charges a meter.
 * When full, the player can strike the forge for free: random plain tiles become specials.
 */
export const FORGE = {
  inputs: ['iron', 'fire'],
  cost: 24,
  produces: ['axeRow', 'axeCol', 'keg'] as SpecialKind[],
};
