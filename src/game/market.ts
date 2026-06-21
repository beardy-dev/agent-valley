import { CROP_TYPES, CROPS, CropType } from "./crops";
import { isTreeType, TREE_TYPES, TREES } from "./trees";

// The general/auto store's currency. Just another InventoryItem key (see
// src/game/inventory.ts) rather than a dedicated column — reuses
// addItem/consumeItem's atomic increment/decrement instead of a parallel
// set of money-handling helpers.
export const GOLD_ITEM_TYPE = "gold";

// Debris only ever appears via tilling and isn't a strategic resource —
// selling it is mostly a way to bootstrap gold before your first harvest.
export const DEBRIS_ITEM_TYPES = ["weed", "rock"] as const;
type DebrisItemType = (typeof DEBRIS_ITEM_TYPES)[number];

const DEBRIS_SELL_PRICES: Record<DebrisItemType, number> = {
  weed: 1,
  rock: 2,
};

// Tree fruit is sellable; saplings are not (same rule as seeds — neither
// "seed_x" nor "sapling_x" ever appears here).
export const SELLABLE_ITEM_TYPES = [...CROP_TYPES, ...DEBRIS_ITEM_TYPES, ...TREE_TYPES] as [string, ...string[]];

export function getSellPrice(itemType: string): number | undefined {
  if (itemType in CROPS) return CROPS[itemType as CropType].sellPrice;
  if (itemType in DEBRIS_SELL_PRICES) return DEBRIS_SELL_PRICES[itemType as DebrisItemType];
  if (isTreeType(itemType)) return TREES[itemType].fruitSellPrice;
  return undefined;
}

// How many crop types are buyable as seeds on any given day, out of the
// full CROP_TYPES pool — keeps agents from having every plant available at
// once (see getTodaysSeedOffer below).
export const MARKET_ROTATION_SIZE = 4;

function hashStringToSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Tiny seeded PRNG (mulberry32) so the rotation is a pure function of the
// date — every request recomputes the same answer for "today" rather than
// needing a scheduled job or a stored "current rotation" row.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], rand: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function marketDateKey(now: Date): string {
  return now.toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

// The crop seeds purchasable from the general store today — rotates daily
// (UTC) and is identical for every farm. Only gates *buying new* seeds;
// it doesn't affect selling or seeds an agent already has in hand.
export function getTodaysSeedOffer(now: Date = new Date()): CropType[] {
  const rand = mulberry32(hashStringToSeed(marketDateKey(now)));
  const shuffled = seededShuffle(CROP_TYPES, rand);
  return shuffled.slice(0, MARKET_ROTATION_SIZE).sort();
}
