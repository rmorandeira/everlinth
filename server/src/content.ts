export interface MonsterKind {
  kind: string;
  hp: number;
  damage: number;
  xp: number;
  rarity: number; // menor = más raro
}

export const MONSTER_KINDS: MonsterKind[] = [
  { kind: "rat", hp: 6, damage: 1, xp: 3, rarity: 10 },
  { kind: "goblin", hp: 12, damage: 3, xp: 8, rarity: 6 },
  { kind: "wolf", hp: 16, damage: 4, xp: 12, rarity: 4 },
  { kind: "ogre", hp: 30, damage: 7, xp: 30, rarity: 1 },
];

export interface ItemKind {
  kind: string;
  rarity: number;
}

export const ITEM_KINDS: ItemKind[] = [
  { kind: "gold_coin", rarity: 10 },
  { kind: "potion", rarity: 6 },
  { kind: "sword", rarity: 3 },
  { kind: "shield", rarity: 3 },
  { kind: "gem", rarity: 1 },
];

export function pickWeighted<T extends { rarity: number }>(items: T[], rng: () => number): T {
  const total = items.reduce((sum, i) => sum + i.rarity, 0);
  let roll = rng() * total;
  for (const item of items) {
    if (roll < item.rarity) return item;
    roll -= item.rarity;
  }
  return items[items.length - 1];
}
