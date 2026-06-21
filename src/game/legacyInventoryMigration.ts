import { PrismaClient } from "@prisma/client";
import { CROP_TYPES } from "./crops";
import { seedItemType } from "./inventory";

// One-time fixup for farms created before seeds and harvested produce were
// split into separate InventoryItem keys (both used to share the bare
// crop-type key, e.g. "carrot"). For any such farm, the existing combined
// count is moved onto the new seed_<crop> key and the bare key is reset to 0
// (which now means "harvested, unsold produce").
//
// Idempotent by construction: a farm only lacks its seed_<crop> row the
// first time this runs (fresh farms get both rows from
// grantStartingInventory), so every later boot is a no-op for already-
// migrated farms.
export async function migrateLegacySeedInventory(prisma: PrismaClient): Promise<void> {
  const farms = await prisma.farm.findMany({ select: { id: true } });

  for (const { id: farmId } of farms) {
    for (const cropType of CROP_TYPES) {
      const seedKey = seedItemType(cropType);
      const existingSeedRow = await prisma.inventoryItem.findUnique({
        where: { farmId_itemType: { farmId, itemType: seedKey } },
      });
      if (existingSeedRow) continue;

      const legacyRow = await prisma.inventoryItem.findUnique({
        where: { farmId_itemType: { farmId, itemType: cropType } },
      });
      const legacyQuantity = legacyRow?.quantity ?? 0;

      await prisma.$transaction([
        prisma.inventoryItem.create({ data: { farmId, itemType: seedKey, quantity: legacyQuantity } }),
        prisma.inventoryItem.upsert({
          where: { farmId_itemType: { farmId, itemType: cropType } },
          create: { farmId, itemType: cropType, quantity: 0 },
          update: { quantity: 0 },
        }),
      ]);
    }
  }
}
