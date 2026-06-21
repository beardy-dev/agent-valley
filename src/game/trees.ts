// Trees are the slowest, biggest planting in the game: a permanent 3x3
// footprint (see TREE_FOOTPRINT_OFFSETS/treeFootprint) that, once mature,
// never wilts itself — instead it periodically drops a single ripe fruit
// onto one of its 8 surrounding tiles (src/game/tick.ts), which *does*
// wilt (reusing the existing crop-wilting marker) if left uncollected.
// matureStage/fruitIntervalTicks/saplingCost scale with the species so a
// bigger investment also produces more valuable fruit less often.
export const TREES = {
  apple: {
    matureStage: 20,
    fruitIntervalTicks: 6,
    saplingCost: 12,
    fruitSellPrice: 5,
    saplingSymbol: "a",
    matureSymbol: "A",
    fruitSymbol: "@",
    saplingColor: "#3a5f1f",
    matureColor: "#a8342a",
    fruitColor: "#c0392b",
  },
  orange: {
    matureStage: 24,
    fruitIntervalTicks: 7,
    saplingCost: 14,
    fruitSellPrice: 6,
    saplingSymbol: "o",
    matureSymbol: "O",
    fruitSymbol: "*",
    saplingColor: "#3a5f1f",
    matureColor: "#e8740c",
    fruitColor: "#f39c12",
  },
  banana: {
    matureStage: 28,
    fruitIntervalTicks: 8,
    saplingCost: 16,
    fruitSellPrice: 7,
    saplingSymbol: "b",
    matureSymbol: "B",
    fruitSymbol: "%",
    saplingColor: "#3a6b1f",
    matureColor: "#e8d23c",
    fruitColor: "#f7dc6f",
  },
} as const;

// Flat grace period (in ticks) a dropped fruit survives before it wilts —
// a separate constant from crops' WILT_TICKS (src/game/crops.ts) even
// though it starts at the same value, since it's a different concept and
// shouldn't silently couple to future crop-balance tuning.
export const FRUIT_WILT_TICKS = 5;

export type TreeType = keyof typeof TREES;

export const TREE_TYPES = Object.keys(TREES) as [TreeType, ...TreeType[]];

export function isTreeType(value: string): value is TreeType {
  return value in TREES;
}

export function treeSymbol(treeType: TreeType, cropStage: number): string {
  const def = TREES[treeType];
  return cropStage >= def.matureStage ? def.matureSymbol : def.saplingSymbol;
}

export function treeColor(treeType: TreeType, cropStage: number): string {
  const def = TREES[treeType];
  return cropStage >= def.matureStage ? def.matureColor : def.saplingColor;
}

export function isTreeMature(treeType: TreeType, cropStage: number): boolean {
  return cropStage >= TREES[treeType].matureStage;
}

// The 8 tiles surrounding a tree's center, in a fixed order (used for both
// claiming a footprint on plant_tree and finding an empty slot for a
// dropped fruit).
export const TREE_FOOTPRINT_OFFSETS: readonly [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export function treeFootprint(centerX: number, centerY: number): { x: number; y: number }[] {
  return TREE_FOOTPRINT_OFFSETS.map(([dx, dy]) => ({ x: centerX + dx, y: centerY + dy }));
}
