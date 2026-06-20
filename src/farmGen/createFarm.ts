import { PrismaClient, Farm, Prisma } from "@prisma/client";
import { generateDebrisGrid } from "./generateDebrisGrid";
import { spiralPosition } from "./worldPlacement";
import { grantStartingInventory } from "../game/inventory";

// Accepts either the top-level PrismaClient or an interactive transaction
// client, so callers can wrap farm + agent creation in one atomic write.
export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreatedFarm {
  farm: Farm;
  weedCount: number;
  rockCount: number;
}

const MAX_PLACEMENT_ATTEMPTS = 5;

// Counting existing farms to pick the next spiral slot only avoids
// collisions when nothing else is concurrently registering; the
// @@unique([worldX, worldY]) constraint is the actual guarantee against two
// farms landing on the same world tile. On a collision (e.g. two concurrent
// registrations racing the same count), retry the next spiral slot instead
// of letting the unique-constraint violation bubble up as an unhandled 500.
async function placeFarm(prisma: Db, name: string, width: number, height: number): Promise<Farm> {
  const baseIndex = await prisma.farm.count();

  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    const { x: worldX, y: worldY } = spiralPosition(baseIndex + attempt);
    try {
      return await prisma.farm.create({ data: { name, width, height, worldX, worldY } });
    } catch (err) {
      const isPlacementConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isPlacementConflict || attempt === MAX_PLACEMENT_ATTEMPTS - 1) throw err;
    }
  }
  throw new Error("unreachable");
}

export async function createFarmWithTiles(
  prisma: Db,
  name: string,
  width = 50,
  height = 50
): Promise<CreatedFarm> {
  const farm = await placeFarm(prisma, name, width, height);
  await grantStartingInventory(prisma, farm.id);
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
