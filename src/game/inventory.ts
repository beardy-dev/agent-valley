import { Prisma, PrismaClient } from "@prisma/client";
import { CROP_TYPES, CropType, STARTER_CROPS } from "./crops";
import { DEBRIS_ITEM_TYPES, GOLD_ITEM_TYPE } from "./market";

type Db = PrismaClient | Prisma.TransactionClient;

// How many seeds of each *starter* crop a brand-new farm starts with —
// enough to get going immediately. Non-starter crops start at 0 and have to
// be bought from the general store (src/game/market.ts) on a day they're in
// rotation.
export const STARTING_SEED_COUNT = 5;

// Enough to buy a handful of whatever's in today's rotation, or to top up
// on starter seeds, before the agent has sold anything of its own.
export const STARTING_GOLD = 20;

// Seeds and harvested produce of the same crop are tracked as separate
// InventoryItem rows so they can be shown/sold/planted independently — the
// bare CropType key (e.g. "carrot") means harvested produce, and this prefix
// distinguishes the seed counterpart ("seed_carrot"). See
// src/game/legacyInventoryMigration.ts for farms that predate this split.
export const SEED_PREFIX = "seed_";

export function seedItemType(cropType: CropType): string {
  return `${SEED_PREFIX}${cropType}`;
}

export function isSeedItemType(itemType: string): boolean {
  return itemType.startsWith(SEED_PREFIX);
}

export async function grantStartingInventory(db: Db, farmId: string): Promise<void> {
  await db.inventoryItem.createMany({
    data: [
      { farmId, itemType: GOLD_ITEM_TYPE, quantity: STARTING_GOLD },
      ...CROP_TYPES.flatMap((cropType) => [
        {
          farmId,
          itemType: seedItemType(cropType),
          // Pre-seeded at 0 for non-starter crops (rather than omitted) so a
          // fresh farm's inventory always lists every tracked item type up
          // front, same reasoning as the debris items below.
          quantity: STARTER_CROPS.includes(cropType) ? STARTING_SEED_COUNT : 0,
        },
        // Harvested produce always starts at 0 — nothing's been grown yet.
        { farmId, itemType: cropType, quantity: 0 },
      ]),
      ...DEBRIS_ITEM_TYPES.map((itemType) => ({ farmId, itemType, quantity: 0 })),
    ],
  });
}

// Adds `amount` of itemType to a farm's inventory, creating the row if this
// is the first time that item type has shown up. Returns the new quantity.
export async function addItem(db: Db, farmId: string, itemType: string, amount: number): Promise<number> {
  const item = await db.inventoryItem.upsert({
    where: { farmId_itemType: { farmId, itemType } },
    create: { farmId, itemType, quantity: amount },
    update: { quantity: { increment: amount } },
  });
  return item.quantity;
}

// Decrements itemType by amount, but only if there's enough on hand — if
// not, this is a no-op and returns null instead of going negative. Callers
// run this inside the same transaction as whatever it's gating (e.g.
// planting), so a failed precondition check never gets silently undone.
export async function consumeItem(db: Db, farmId: string, itemType: string, amount: number): Promise<number | null> {
  const item = await db.inventoryItem.findUnique({ where: { farmId_itemType: { farmId, itemType } } });
  if ((item?.quantity ?? 0) < amount) return null;

  const updated = await db.inventoryItem.update({
    where: { farmId_itemType: { farmId, itemType } },
    data: { quantity: { decrement: amount } },
  });
  return updated.quantity;
}

export async function getInventory(db: Db, farmId: string) {
  return db.inventoryItem.findMany({ where: { farmId }, orderBy: { itemType: "asc" } });
}

export async function getItemQuantity(db: Db, farmId: string, itemType: string): Promise<number> {
  const item = await db.inventoryItem.findUnique({ where: { farmId_itemType: { farmId, itemType } } });
  return item?.quantity ?? 0;
}
