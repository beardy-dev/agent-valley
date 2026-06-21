import { PrismaClient } from "@prisma/client";
import { CROPS, WILT_TICKS } from "./crops";

export async function advanceTick(
  prisma: PrismaClient
): Promise<{ grown: number; wilted: number; affectedFarmIds: string[] }> {
  let grown = 0;
  let wilted = 0;
  const affectedFarmIds = new Set<string>();

  for (const [cropType, def] of Object.entries(CROPS)) {
    const matureStage = def.matureStage;
    const wiltStage = matureStage + WILT_TICKS;

    // Growing: cropStage keeps climbing toward matureStage.
    const growingWhere = { cropType, cropStage: { lt: matureStage } };
    const growingTiles = await prisma.tile.findMany({ where: growingWhere, select: { farmId: true }, distinct: ["farmId"] });
    growingTiles.forEach((tile) => affectedFarmIds.add(tile.farmId));
    const growResult = await prisma.tile.updateMany({ where: growingWhere, data: { cropStage: { increment: 1 } } });
    grown += growResult.count;

    // Aging: mature but not yet wilted — cropStage keeps climbing (still
    // shows the mature sprite, see cropSymbol/cropColor) so the wilting
    // pass below can detect when it's been unharvested too long.
    const agingWhere = { cropType, cropStage: { gte: matureStage, lt: wiltStage } };
    const agingTiles = await prisma.tile.findMany({ where: agingWhere, select: { farmId: true }, distinct: ["farmId"] });
    agingTiles.forEach((tile) => affectedFarmIds.add(tile.farmId));
    await prisma.tile.updateMany({ where: agingWhere, data: { cropStage: { increment: 1 } } });

    // Wilting: anything that just aged into (or already was past) the wilt
    // threshold dies this same tick — cleared back to an empty tile with
    // WILTED debris, same as a fresh weed/rock until it's tilled away.
    const wiltWhere = { cropType, cropStage: { gte: wiltStage } };
    const wiltingTiles = await prisma.tile.findMany({ where: wiltWhere, select: { farmId: true }, distinct: ["farmId"] });
    wiltingTiles.forEach((tile) => affectedFarmIds.add(tile.farmId));
    const wiltResult = await prisma.tile.updateMany({
      where: wiltWhere,
      data: { cropType: null, cropStage: 0, plantedAt: null, debris: "WILTED" },
    });
    wilted += wiltResult.count;
  }

  return { grown, wilted, affectedFarmIds: [...affectedFarmIds] };
}
