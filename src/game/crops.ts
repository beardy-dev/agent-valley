// matureStage doubles as "how many ticks to grow" (see src/game/tick.ts,
// which increments cropStage by 1 per tick uniformly). seedCost/sellPrice
// are gold amounts used by the general store (src/game/market.ts) — priced
// roughly in proportion to matureStage, so slower crops pay off more.
export const CROPS = {
  wheat: { matureStage: 2, seedCost: 1, sellPrice: 2, growingSymbol: "h", matureSymbol: "H", growingColor: "#6b8f3a", matureColor: "#e0c14c" },
  carrot: { matureStage: 3, seedCost: 2, sellPrice: 4, growingSymbol: "c", matureSymbol: "C", growingColor: "#7a4a14", matureColor: "#ff9800" },
  potato: { matureStage: 4, seedCost: 3, sellPrice: 6, growingSymbol: "p", matureSymbol: "P", growingColor: "#5c4a2e", matureColor: "#d2a679" },
  strawberry: { matureStage: 4, seedCost: 4, sellPrice: 7, growingSymbol: "s", matureSymbol: "S", growingColor: "#5c1f1f", matureColor: "#e0405a" },
  tomato: { matureStage: 5, seedCost: 5, sellPrice: 9, growingSymbol: "t", matureSymbol: "T", growingColor: "#5c2e1f", matureColor: "#e8453c" },
  corn: { matureStage: 6, seedCost: 6, sellPrice: 11, growingSymbol: "m", matureSymbol: "M", growingColor: "#6b6b1f", matureColor: "#f4d03f" },
  pumpkin: { matureStage: 8, seedCost: 9, sellPrice: 16, growingSymbol: "k", matureSymbol: "K", growingColor: "#5c3a1f", matureColor: "#e8740c" },
} as const;

export type CropType = keyof typeof CROPS;

export const CROP_TYPES = Object.keys(CROPS) as [CropType, ...CropType[]];

// Granted free at farm creation regardless of today's market rotation, so a
// brand-new agent has something to plant immediately. Every other crop has
// to be bought from the general store on a day it's in rotation — see
// getTodaysSeedOffer in src/game/market.ts.
export const STARTER_CROPS: readonly CropType[] = ["carrot", "potato"];

export function isCropType(value: string): value is CropType {
  return value in CROPS;
}

export function cropSymbol(cropType: CropType, cropStage: number): string {
  const def = CROPS[cropType];
  return cropStage >= def.matureStage ? def.matureSymbol : def.growingSymbol;
}

export function cropColor(cropType: CropType, cropStage: number): string {
  const def = CROPS[cropType];
  return cropStage >= def.matureStage ? def.matureColor : def.growingColor;
}

export function isMature(cropType: CropType, cropStage: number): boolean {
  return cropStage >= CROPS[cropType].matureStage;
}
