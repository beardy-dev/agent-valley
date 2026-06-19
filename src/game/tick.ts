import { PrismaClient } from "@prisma/client";
import { CROPS } from "./crops";

export async function advanceTick(prisma: PrismaClient): Promise<{ grown: number }> {
  let grown = 0;
  for (const [cropType, def] of Object.entries(CROPS)) {
    const result = await prisma.tile.updateMany({
      where: { cropType, cropStage: { lt: def.matureStage } },
      data: { cropStage: { increment: 1 } },
    });
    grown += result.count;
  }
  return { grown };
}
