export const CROPS = {
  carrot: { matureStage: 3, growingSymbol: "c", matureSymbol: "C", growingColor: "#7a4a14", matureColor: "#ff9800" },
  potato: { matureStage: 4, growingSymbol: "p", matureSymbol: "P", growingColor: "#5c4a2e", matureColor: "#d2a679" },
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

export function cropColor(cropType: CropType, cropStage: number): string {
  const def = CROPS[cropType];
  return cropStage >= def.matureStage ? def.matureColor : def.growingColor;
}

export function isMature(cropType: CropType, cropStage: number): boolean {
  return cropStage >= CROPS[cropType].matureStage;
}
