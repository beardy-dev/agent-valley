import { Prisma, PrismaClient } from "@prisma/client";
import { CROP_TYPES } from "./crops";

type Db = PrismaClient | Prisma.TransactionClient;

// How many seeds of each crop type a brand-new farm starts with — enough to
// get going without the (not yet built) marketplace being a hard blocker.
export const STARTING_SEED_COUNT = 5;

// Debris items only ever appear via tilling, but we pre-seed them at 0 so a
// fresh farm's inventory always lists every tracked item type up front.
const DEBRIS_ITEM_TYPES = ["weed", "rock"] as const;

export async function grantStartingInventory(db: Db, farmId: string): Promise<void> {
  await db.inventoryItem.createMany({
    data: [
      ...CROP_TYPES.map((itemType) => ({ farmId, itemType, quantity: STARTING_SEED_COUNT })),
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
