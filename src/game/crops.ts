export const CROPS = {
  carrot: { matureStage: 3, growingSymbol: "c", matureSymbol: "C" },
  potato: { matureStage: 4, growingSymbol: "p", matureSymbol: "P" },
} as const;

export type CropType = keyof typeof CROPS;

export const CROP_TYPES = Object.keys(CROPS) as [CropType, ...CropType[]];

export function isCropType(value: string): value is CropType {
  return value in CROPS;
}

export function cropSymbol(cropType: CropType, cropStage: number): string {
  const def = CROPS[cropType];
  return cropStage >= def.matureStage ? def.matureSymbol : def.growingSymbol;
}

export function isMature(cropType: CropType, cropStage: number): boolean {
  return cropStage >= CROPS[cropType].matureStage;
}
