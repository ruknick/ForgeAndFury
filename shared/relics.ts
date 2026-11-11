import type { RelicDef, Rarity } from './types';

/** Prototype relic catalogue (spec §6). Taxon = XRPL NFTokenTaxon, one per relic type. Never reuse a taxon. */
export const RELICS: RelicDef[] = [
  { id: 'sling_stone', name: 'Sling Stone', rarity: 'common', taxon: 1, targeting: 'tile', usesMove: false, glyph: '🪨',
    effectText: 'Destroys 1 tile', flavorText: 'A shepherd\'s first weapon, and still his best.' },
  { id: 'torch', name: 'Torch', rarity: 'common', taxon: 2, targeting: 'tile', usesMove: false, glyph: '🪔',
    effectText: 'Burns a tile and its 4 neighbors', flavorText: 'Pitch and rag, lit from the hearth.' },
  { id: 'war_horn', name: 'War Horn', rarity: 'common', taxon: 3, targeting: 'none', usesMove: false, glyph: '📯',
    effectText: '+3 moves', flavorText: 'One blast and tired arms find their strength.' },
  { id: 'spear', name: 'Spear', rarity: 'rare', taxon: 4, targeting: 'tile+axis', usesMove: false, glyph: '🔱',
    effectText: 'Clears a whole row or column', flavorText: 'Long reach, straight line, no mercy.' },
  { id: 'sword', name: 'Sword', rarity: 'rare', taxon: 5, targeting: 'tile', usesMove: false, glyph: '🗡️',
    effectText: 'Spinning slash: clears a 3×3 area', flavorText: 'The blade sings a full circle before it rests.' },
  { id: 'fire_arrow', name: 'Fire Arrow', rarity: 'rare', taxon: 6, targeting: 'tile', usesMove: false, glyph: '🏹',
    effectText: 'Clears both diagonals through a tile', flavorText: 'Loosed at dusk, it lights the sky twice.' },
  { id: 'war_hammer', name: 'War Hammer', rarity: 'epic', taxon: 7, targeting: 'none', usesMove: false, glyph: '🔨',
    effectText: 'Shatters every Stone tile', flavorText: 'Stone was made to be broken.' },
  { id: 'catapult', name: 'Catapult', rarity: 'epic', taxon: 8, targeting: 'none', usesMove: false, glyph: '☄️',
    effectText: 'Hurls 3 boulders (3×3 each)', flavorText: 'Siege engineers do not aim. They estimate.' },
  { id: 'shield_wall', name: 'Shield Wall', rarity: 'epic', taxon: 9, targeting: 'none', usesMove: false, glyph: '🛡️',
    effectText: 'Next 3 moves are free', flavorText: 'Lock shields. Hold the line. Breathe.' },
  { id: 'twin_axes', name: 'Twin Axes', rarity: 'epic', taxon: 10, targeting: 'tile', usesMove: false, glyph: '⚔️',
    effectText: 'Clears the row and column through a tile', flavorText: 'One for each hand, one for each direction.' },
  { id: 'warlords_banner', name: "Warlord's Banner", rarity: 'legendary', taxon: 11, targeting: 'tileType', usesMove: false, glyph: '🚩',
    effectText: 'Turns one tile type into Powder Kegs, then detonates', flavorText: 'Where it flies, the field burns.' },
  { id: 'dragonfire_blade', name: 'Dragonfire Blade', rarity: 'legendary', taxon: 12, targeting: 'none', usesMove: false, glyph: '🐉',
    effectText: 'Clears the whole board', flavorText: 'Forged in a breath that ended a kingdom.' },
];

export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export const RARITY_INFO: Record<Rarity, { name: string; color: number; css: string }> = {
  common: { name: 'Common', color: 0xd9d9d9, css: '#d9d9d9' },
  rare: { name: 'Rare', color: 0x3d8bff, css: '#3d8bff' },
  epic: { name: 'Epic', color: 0xa855f7, css: '#a855f7' },
  legendary: { name: 'Legendary', color: 0xf5b301, css: '#f5b301' },
};

export function relicDef(id: string): RelicDef {
  const r = RELICS.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown relic: ${id}`);
  return r;
}

export function relicByTaxon(taxon: number): RelicDef | undefined {
  return RELICS.find((x) => x.taxon === taxon);
}
