import { PrismaClient, Farm } from "@prisma/client";
import { generateDebrisGrid } from "./generateDebrisGrid";

export interface CreatedFarm {
  farm: Farm;
  weedCount: number;
  rockCount: number;
}

export async function createFarmWithTiles(
  prisma: PrismaClient,
  name: string,
  width = 50,
  height = 50
): Promise<CreatedFarm> {
  const farm = await prisma.farm.create({ data: { name, width, height } });
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
