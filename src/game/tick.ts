import { PrismaClient } from "@prisma/client";
import { CROPS, WILT_TICKS } from "./crops";
import { FRUIT_WILT_TICKS, treeFootprint, TREES, TreeType } from "./trees";

export async function advanceTick(
  prisma: PrismaClient
): Promise<{ grown: number; wilted: number; fruited: number; affectedFarmIds: string[] }> {
  let grown = 0;
  let wilted = 0;
  let fruited = 0;
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

  // Trees: unlike crops, a tree never wilts once mature — cropStage just
  // keeps climbing forever (one unconditional pass per type, no upper
  // bound), which also drives the fruit-drop timer below.
  for (const treeType of Object.keys(TREES)) {
    const treeWhere = { treeType };
    const treeTiles = await prisma.tile.findMany({ where: treeWhere, select: { farmId: true }, distinct: ["farmId"] });
    treeTiles.forEach((tile) => affectedFarmIds.add(tile.farmId));
    const treeResult = await prisma.tile.updateMany({ where: treeWhere, data: { cropStage: { increment: 1 } } });
    grown += treeResult.count;
  }

  // Fruit drop: per-tree (not a blanket updateMany — which footprint slot
  // is free differs per tree instance), checked against the cropStage each
  // tree's growth pass just advanced above, so a tree drops its first fruit
  // the same tick it reaches matureStage. At most one outstanding fruit per
  // tree at a time — skip the drop entirely if any of its 8 footprint tiles
  // already has a ripe or dead-uncollected fruit on it.
  for (const [treeType, def] of Object.entries(TREES) as [TreeType, (typeof TREES)[TreeType]][]) {
    const matureTrees = await prisma.tile.findMany({
      where: { treeType, cropStage: { gte: def.matureStage } },
      select: { farmId: true, x: true, y: true, cropStage: true },
    });

    for (const tree of matureTrees) {
      if ((tree.cropStage - def.matureStage) % def.fruitIntervalTicks !== 0) continue;

      const footprint = treeFootprint(tree.x, tree.y);
      const footprintTiles = await prisma.tile.findMany({
        where: { farmId: tree.farmId, OR: footprint.map(({ x, y }) => ({ x, y })) },
        select: { id: true, fruitType: true, debris: true },
      });

      const hasOutstandingFruit = footprintTiles.some((tile) => tile.fruitType !== null || tile.debris === "WILTED");
      if (hasOutstandingFruit) continue;

      const emptySlots = footprintTiles.filter((tile) => tile.fruitType === null && tile.debris === "NONE");
      if (emptySlots.length === 0) continue;
      const slot = emptySlots[Math.floor(Math.random() * emptySlots.length)];

      await prisma.tile.update({ where: { id: slot.id }, data: { fruitType: treeType, cropStage: 0 } });
      affectedFarmIds.add(tree.farmId);
      fruited++;
    }
  }

  // Fruit aging: ticks since drop, climbing toward FRUIT_WILT_TICKS — same
  // age-then-wilt shape as crops, just with no growth phase (a dropped
  // fruit is "mature" the instant it appears).
  const fruitAgingWhere = { fruitType: { not: null }, cropStage: { lt: FRUIT_WILT_TICKS } };
  const fruitAgingTiles = await prisma.tile.findMany({ where: fruitAgingWhere, select: { farmId: true }, distinct: ["farmId"] });
  fruitAgingTiles.forEach((tile) => affectedFarmIds.add(tile.farmId));
  await prisma.tile.updateMany({ where: fruitAgingWhere, data: { cropStage: { increment: 1 } } });

  // Fruit wilting: uncollected too long — dies into the same WILTED debris
  // skull as any other expired plant. blockedByTree/treeCenterX/Y are left
  // untouched, so the tile renders blocked ("#") again once tilled, never
  // open ground.
  const fruitWiltWhere = { fruitType: { not: null }, cropStage: { gte: FRUIT_WILT_TICKS } };
  const fruitWiltingTiles = await prisma.tile.findMany({ where: fruitWiltWhere, select: { farmId: true }, distinct: ["farmId"] });
  fruitWiltingTiles.forEach((tile) => affectedFarmIds.add(tile.farmId));
  const fruitWiltResult = await prisma.tile.updateMany({
    where: fruitWiltWhere,
    data: { fruitType: null, cropStage: 0, debris: "WILTED" },
  });
  wilted += fruitWiltResult.count;

  return { grown, wilted, fruited, affectedFarmIds: [...affectedFarmIds] };
}
