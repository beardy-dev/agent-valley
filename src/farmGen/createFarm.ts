import { PrismaClient, Farm, Prisma } from "@prisma/client";
import { generateDebrisGrid } from "./generateDebrisGrid";
import { spiralPosition } from "./worldPlacement";

// Accepts either the top-level PrismaClient or an interactive transaction
// client, so callers can wrap farm + agent creation in one atomic write.
export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreatedFarm {
  farm: Farm;
  weedCount: number;
  rockCount: number;
}

export async function createFarmWithTiles(
  prisma: Db,
  name: string,
  width = 50,
  height = 50
): Promise<CreatedFarm> {
  // Counting existing farms to pick the next spiral slot only avoids
  // collisions when this call runs inside a transaction (the count and the
  // create commit atomically); the @@unique([worldX, worldY]) constraint is
  // the actual guarantee against two farms landing on the same world tile.
  const placementIndex = await prisma.farm.count();
  const { x: worldX, y: worldY } = spiralPosition(placementIndex);

  const farm = await prisma.farm.create({ data: { name, width, height, worldX, worldY } });
  const debrisGrid = generateDebrisGrid(width, height);

  let weedCount = 0;
  let rockCount = 0;

  const tileData = debrisGrid.flatMap((row, y) =>
    row.map((debris, x) => {
      if (debris === "WEED") weedCount++;
      if (debris === "ROCK") rockCount++;
      return { farmId: farm.id, x, y, debris };
    })
  );

  await prisma.tile.createMany({ data: tileData });

  return { farm, weedCount, rockCount };
}
