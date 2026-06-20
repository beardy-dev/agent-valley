import { PrismaClient } from "@prisma/client";
import { CROPS } from "./crops";

export async function advanceTick(prisma: PrismaClient): Promise<{ grown: number; affectedFarmIds: string[] }> {
  let grown = 0;
  const affectedFarmIds = new Set<string>();

  for (const [cropType, def] of Object.entries(CROPS)) {
    const where = { cropType, cropStage: { lt: def.matureStage } };

    // Capture which farms actually have a growing tile of this crop type
    // before mutating, so the caller can broadcast only to farms whose state
    // changed this tick instead of every farm with a live viewer.
    const growingTiles = await prisma.tile.findMany({ where, select: { farmId: true }, distinct: ["farmId"] });
    growingTiles.forEach((tile) => affectedFarmIds.add(tile.farmId));

    const result = await prisma.tile.updateMany({ where, data: { cropStage: { increment: 1 } } });
    grown += result.count;
  }

  return { grown, affectedFarmIds: [...affectedFarmIds] };
}
