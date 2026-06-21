import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Agent, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CROP_TYPES, CROPS, isCropType, isMature } from "../game/crops";
import {
  addItem,
  consumeItem,
  getInventory,
  getItemQuantity,
  isSaplingItemType,
  isSeedItemType,
  SAPLING_PREFIX,
  saplingItemType,
  SEED_PREFIX,
  seedItemType,
} from "../game/inventory";
import { GOLD_ITEM_TYPE, SELLABLE_ITEM_TYPES, getSellPrice, getTodaysSeedOffer } from "../game/market";
import { renderFarmAscii } from "../game/render";
import { isTreeMature, isTreeType, treeFootprint, TREE_TYPES, TREES } from "../game/trees";
import { createGithubIssue } from "../github";
import { broadcast, broadcastMarketEvent, HISTORY_LIMIT, MarketAction } from "../web/connections";

// Actions that represent a trade with the general store rather than a tile
// edit — withGameLog uses this to also push successful ones to the global
// /market live feed.
const MARKET_ACTIONS: ReadonlySet<string> = new Set<MarketAction>(["sell", "buy_seeds", "buy_sapling"]);

type Db = PrismaClient | Prisma.TransactionClient;

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function resultText(result: CallToolResult): string {
  const block = result.content[0];
  return block && block.type === "text" ? block.text : "";
}

function describeTile(
  x: number,
  y: number,
  tile: {
    terrain: string;
    debris: string;
    cropType: string | null;
    cropStage: number;
    treeType: string | null;
    fruitType: string | null;
    blockedByTree: boolean;
    treeCenterX: number | null;
    treeCenterY: number | null;
  }
): string {
  const parts = [`(${x}, ${y})`, `terrain=${tile.terrain}`, `debris=${tile.debris}`];

  if (tile.treeType && isTreeType(tile.treeType)) {
    parts.push(`tree=${tile.treeType}`, `stage=${tile.cropStage}`, `mature=${isTreeMature(tile.treeType, tile.cropStage)}`);
  } else if (tile.cropType && isCropType(tile.cropType)) {
    parts.push(`crop=${tile.cropType}`, `stage=${tile.cropStage}`, `mature=${isMature(tile.cropType, tile.cropStage)}`);
  } else if (tile.cropType) {
    parts.push(`crop=${tile.cropType}`, "mature=unknown");
  } else {
    parts.push("crop=none");
  }

  if (tile.fruitType && isTreeType(tile.fruitType)) {
    parts.push(`fruit=${tile.fruitType}`, `fruitAge=${tile.cropStage}`);
  }

  if (tile.blockedByTree) {
    const center = tile.treeCenterX !== null && tile.treeCenterY !== null ? ` (tree at ${tile.treeCenterX}, ${tile.treeCenterY})` : "";
    parts.push(`blocked=true${center}`);
  }

  return parts.join(", ");
}

// Records one tool attempt (success or fail) to the farm's rolling activity
// feed, then prunes anything beyond the most recent HISTORY_LIMIT rows —
// this is a bounded feed for the web viewer, not a permanent audit log.
async function recordAction(
  prisma: PrismaClient,
  farmId: string,
  action: string,
  x: number | null,
  y: number | null,
  message: string,
  success: boolean
): Promise<void> {
  // Insert + prune run in one transaction so concurrent calls for the same
  // farm can't both read a stale pre-insert count and let the row count
  // creep past HISTORY_LIMIT.
  await prisma.$transaction(async (tx) => {
    await tx.actionLog.create({ data: { farmId, action, x, y, message, success } });

    const stale = await tx.actionLog.findMany({
      where: { farmId },
      orderBy: { createdAt: "desc" },
      skip: HISTORY_LIMIT,
      select: { id: true },
    });
    if (stale.length > 0) {
      await tx.actionLog.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    }
  });
}

// Wraps a mutating tool handler so every attempt — success or fail — is
// recorded to the farm's action history and broadcast to live web viewers.
// Callers never have to remember to call recordAction()/broadcast()
// themselves, so a future tool can't forget either. Arg doesn't have to
// carry x/y — market tools (sell/buy_seeds) act on the farm as a whole, not
// a tile, and just log with null coordinates.
function withGameLog<Arg>(
  prisma: PrismaClient,
  farmId: string,
  action: string,
  handler: (arg: Arg) => Promise<CallToolResult>
): (arg: Arg) => Promise<CallToolResult> {
  return async (arg: Arg) => {
    const result = await handler(arg);
    const coords = arg as { x?: number; y?: number };
    await recordAction(prisma, farmId, action, coords.x ?? null, coords.y ?? null, resultText(result), !result.isError);
    await broadcast(prisma, farmId);
    if (!result.isError && MARKET_ACTIONS.has(action)) {
      await broadcastMarketEvent(prisma, farmId, action as MarketAction, resultText(result));
    }
    return result;
  };
}

// Wraps any tool handler (read-only or mutating) so every call is recorded
// permanently to EventLog for debugging/metrics — distinct from ActionLog,
// which only covers till/plant/harvest and is pruned for the web viewer.
// A logging failure must never break gameplay, so the insert is best-effort:
// errors are swallowed (and reported to stderr) rather than thrown.
function withEventLog<Arg>(
  prisma: PrismaClient,
  agentId: string,
  farmId: string,
  tool: string,
  handler: (arg: Arg) => Promise<CallToolResult>
): (arg: Arg) => Promise<CallToolResult> {
  return async (arg: Arg) => {
    const startedAt = Date.now();
    let result: CallToolResult;
    let success: boolean;
    let message: string;
    try {
      result = await handler(arg);
      success = !result.isError;
      message = resultText(result);
    } catch (err) {
      success = false;
      message = err instanceof Error ? err.message : String(err);
      await logEvent(prisma, agentId, farmId, tool, arg, success, message, Date.now() - startedAt);
      throw err;
    }
    await logEvent(prisma, agentId, farmId, tool, arg, success, message, Date.now() - startedAt);
    return result;
  };
}

async function logEvent(
  prisma: PrismaClient,
  agentId: string,
  farmId: string,
  tool: string,
  input: unknown,
  success: boolean,
  message: string,
  durationMs: number
): Promise<void> {
  try {
    await prisma.eventLog.create({
      data: { agentId, farmId, tool, input: JSON.stringify(input), success, message, durationMs },
    });
  } catch (err) {
    console.error("Failed to write EventLog entry:", err);
  }
}

/**
 * Builds a fresh MCP server (with all game tools registered) for a single
 * authenticated agent. Called once per HTTP request in the stateless
 * Streamable HTTP route — see src/mcp/route.ts.
 *
 * Agents have no on-farm position ("god mode"): every tile-level tool takes
 * an explicit x/y coordinate rather than acting on wherever an avatar
 * happens to be standing.
 */
export async function buildGameMcpServer(prisma: PrismaClient, agent: Agent): Promise<McpServer> {
  const farm = await prisma.farm.findUniqueOrThrow({ where: { id: agent.farmId } });

  const server = new McpServer({ name: "agent-valley", version: "0.1.0" });

  const xSchema = z.number().int().min(0).max(farm.width - 1).describe("Column on the farm grid (0-indexed)");
  const ySchema = z.number().int().min(0).max(farm.height - 1).describe("Row on the farm grid (0-indexed)");

  async function getTile(db: Db, x: number, y: number) {
    return db.tile.findUniqueOrThrow({ where: { farmId_x_y: { farmId: agent.farmId, x, y } } });
  }

  server.registerTool(
    "inspect_farm",
    {
      description: "View the ASCII layout of your own farm, or another agent's farm by id (read-only).",
      inputSchema: {
        farmId: z.string().uuid().optional().describe("Farm UUID to inspect; omit to view your own farm"),
      },
    },
    withEventLog(prisma, agent.id, agent.farmId, "inspect_farm", async ({ farmId }) => {
      const targetFarmId = farmId ?? agent.farmId;
      const targetFarm = await prisma.farm.findUnique({ where: { id: targetFarmId } });
      if (!targetFarm) return fail(`No farm found with id ${targetFarmId}`);

      const tiles = await prisma.tile.findMany({ where: { farmId: targetFarmId } });
      const ascii = renderFarmAscii(tiles, targetFarm.width, targetFarm.height);

      const legend =
        "Legend: . dirt | W weed | R rock | lowercase growing crop | UPPERCASE mature crop | " +
        "trees (sapling/mature): a/A apple, o/O orange, b/B banana | fruit: @ apple, * orange, % banana | " +
        "# blocked by a tree's canopy";
      return ok(`Farm ${targetFarm.id} (${targetFarm.width}x${targetFarm.height})\n${legend}\n\n${ascii}`);
    })
  );

  server.registerTool(
    "inspect_tile",
    {
      description: "Inspect a single tile on your own farm by coordinate.",
      inputSchema: { x: xSchema, y: ySchema },
    },
    withEventLog(prisma, agent.id, agent.farmId, "inspect_tile", async ({ x, y }) => {
      const tile = await prisma.tile.findUnique({ where: { farmId_x_y: { farmId: agent.farmId, x, y } } });
      if (!tile) return fail(`No tile at (${x}, ${y})`);
      return ok(describeTile(x, y, tile));
    })
  );

  server.registerTool(
    "inspect_inventory",
    {
      description: "View your farm's inventory: seeds, harvested crops, and debris cleared from tiles (read-only).",
      inputSchema: {},
    },
    withEventLog(prisma, agent.id, agent.farmId, "inspect_inventory", async () => {
      const items = await getInventory(prisma, agent.farmId);
      if (items.length === 0) return ok("Your inventory is empty.");

      const gold = items.find((item) => item.itemType === GOLD_ITEM_TYPE);
      const seeds = items.filter((item) => isSeedItemType(item.itemType) || isSaplingItemType(item.itemType));
      const harvested = items.filter((item) => isCropType(item.itemType) || isTreeType(item.itemType));
      const misc = items.filter(
        (item) =>
          item !== gold &&
          !isSeedItemType(item.itemType) &&
          !isSaplingItemType(item.itemType) &&
          !isCropType(item.itemType) &&
          !isTreeType(item.itemType)
      );

      const seedLabel = (itemType: string) =>
        isSaplingItemType(itemType) ? `${itemType.slice(SAPLING_PREFIX.length)} sapling` : `${itemType.slice(SEED_PREFIX.length)} seeds`;
      const section = (label: string, rows: typeof items, itemLabel: (itemType: string) => string = (t) => t) =>
        `${label}:\n` + (rows.length === 0 ? "  none" : rows.map((row) => `  ${itemLabel(row.itemType)}: ${row.quantity}`).join("\n"));

      return ok(
        [
          `Gold: ${gold?.quantity ?? 0}`,
          section("Seeds", seeds, seedLabel),
          section("Harvested", harvested),
          section("Misc", misc),
        ].join("\n\n")
      );
    })
  );

  server.registerTool(
    "inspect_market",
    {
      description:
        "View the general store: today's crop seeds for sale (rotates daily), tree saplings (always available), " +
        "sell prices for crops/fruit/debris, and your gold (read-only).",
      inputSchema: {},
    },
    withEventLog(prisma, agent.id, agent.farmId, "inspect_market", async () => {
      const offer = getTodaysSeedOffer();
      const gold = await getItemQuantity(prisma, agent.farmId, GOLD_ITEM_TYPE);

      const seedLines = offer.map((cropType) => `  ${cropType}: ${CROPS[cropType].seedCost} gold/seed`).join("\n");
      const saplingLines = TREE_TYPES.map((treeType) => `  ${treeType}: ${TREES[treeType].saplingCost} gold/sapling`).join("\n");
      const sellLines = SELLABLE_ITEM_TYPES.map((itemType) => `  ${itemType}: ${getSellPrice(itemType)} gold each`).join("\n");

      return ok(
        `Today's seeds for sale (rotates daily):\n${seedLines}\n\n` +
          `Saplings for sale (always available):\n${saplingLines}\n\n` +
          `Sell prices (use the "sell" tool):\n${sellLines}\n\n` +
          `Your gold: ${gold}`
      );
    })
  );

  server.registerTool(
    "till",
    {
      description: "Clear debris (weeds/rocks) from the tile at the given coordinate.",
      inputSchema: { x: xSchema, y: ySchema },
    },
    withEventLog(
      prisma,
      agent.id,
      agent.farmId,
      "till",
      withGameLog(prisma, agent.farmId, "till", async ({ x, y }) => {
        // The read and write run inside one transaction so a concurrent
        // till/plant/harvest on the same tile can't pass its precondition
        // check against a row this call is about to overwrite.
        return prisma.$transaction(async (tx) => {
          const tile = await getTile(tx, x, y);
          if (tile.blockedByTree && tile.debris === "NONE" && !tile.fruitType) {
            return fail("This tile is shaded by a tree's canopy — nothing to till.");
          }
          if (tile.debris === "NONE") return fail("Nothing to till here — this tile is already clear.");
          if (tile.cropType) return fail("Can't till a tile with a crop planted on it.");

          const itemType = tile.debris.toLowerCase();
          await tx.tile.update({ where: { id: tile.id }, data: { debris: "NONE" } });
          const quantity = await addItem(tx, agent.farmId, itemType, 1);
          return ok(`Cleared ${itemType} from (${tile.x}, ${tile.y}). +1 ${itemType} (now have ${quantity}).`);
        });
      })
    )
  );

  server.registerTool(
    "plant",
    {
      description: "Plant a crop on the (cleared) tile at the given coordinate.",
      inputSchema: { x: xSchema, y: ySchema, cropType: z.enum(CROP_TYPES) },
    },
    withEventLog(
      prisma,
      agent.id,
      agent.farmId,
      "plant",
      withGameLog(prisma, agent.farmId, "plant", async ({ x, y, cropType }) => {
        return prisma.$transaction(async (tx) => {
          const tile = await getTile(tx, x, y);
          if (tile.blockedByTree) return fail("This tile is shaded by a tree's canopy and can't be planted.");
          if (tile.treeType) return fail("A tree is already planted here.");
          if (tile.debris !== "NONE") return fail(`This tile still has ${tile.debris.toLowerCase()} on it — till it first.`);
          if (tile.cropType) return fail(`A ${tile.cropType} is already planted here.`);

          const remaining = await consumeItem(tx, agent.farmId, seedItemType(cropType), 1);
          if (remaining === null) return fail(`You don't have any ${cropType} seeds left.`);

          await tx.tile.update({
            where: { id: tile.id },
            data: { cropType, cropStage: 0, plantedAt: new Date() },
          });
          return ok(
            `Planted ${cropType} at (${tile.x}, ${tile.y}). ${remaining} ${cropType} seed(s) left. It will grow as the world ticks forward.`
          );
        });
      })
    )
  );

  server.registerTool(
    "plant_tree",
    {
      description:
        "Plant a tree at the given coordinate (its center). Trees take up a 3x3 area — the 8 surrounding " +
        "tiles become permanently blocked. Once mature, the tree periodically drops a single fruit onto one " +
        "of those tiles, which must be harvested before it wilts.",
      inputSchema: { x: xSchema, y: ySchema, treeType: z.enum(TREE_TYPES) },
    },
    withEventLog(
      prisma,
      agent.id,
      agent.farmId,
      "plant_tree",
      withGameLog(prisma, agent.farmId, "plant_tree", async ({ x, y, treeType }) => {
        if (x - 1 < 0 || x + 1 >= farm.width || y - 1 < 0 || y + 1 >= farm.height) {
          return fail("Trees need 3x3 clear space — can't plant within 1 tile of the farm edge.");
        }

        // Read center + all 8 neighbors in one query, then claim all 9 in
        // the same transaction — SQLite's single-writer model means this is
        // safe against a concurrent plant_tree/till/plant on any of these
        // tiles without any extra locking.
        return prisma.$transaction(async (tx) => {
          const footprint = treeFootprint(x, y);
          const coords = [{ x, y }, ...footprint];
          const tiles = await tx.tile.findMany({ where: { farmId: agent.farmId, OR: coords } });
          const at = (tx_: number, ty: number) => tiles.find((t) => t.x === tx_ && t.y === ty);

          const center = at(x, y);
          if (!center) return fail(`No tile at (${x}, ${y})`);
          if (center.blockedByTree) return fail(`(${x}, ${y}) is shaded by another tree's canopy.`);
          if (center.treeType) return fail(`A tree is already planted at (${x}, ${y}).`);
          if (center.debris !== "NONE") return fail(`(${x}, ${y}) still has ${center.debris.toLowerCase()} on it — till it first.`);
          if (center.cropType) return fail(`A ${center.cropType} is already planted at (${x}, ${y}).`);

          for (const { x: nx, y: ny } of footprint) {
            const neighbor = at(nx, ny);
            if (!neighbor) return fail(`No tile at (${nx}, ${ny})`);
            if (neighbor.blockedByTree) return fail(`(${nx}, ${ny}) is already shaded by another tree's canopy.`);
            if (neighbor.treeType) return fail(`(${nx}, ${ny}) is another tree's center.`);
            if (neighbor.debris !== "NONE") return fail(`(${nx}, ${ny}) still has ${neighbor.debris.toLowerCase()} on it — till it first.`);
            if (neighbor.cropType) return fail(`(${nx}, ${ny}) already has a ${neighbor.cropType} planted.`);
          }

          const remaining = await consumeItem(tx, agent.farmId, saplingItemType(treeType), 1);
          if (remaining === null) return fail(`You don't have any ${treeType} saplings left.`);

          await tx.tile.update({
            where: { id: center.id },
            data: { treeType, cropStage: 0, treeCenterX: x, treeCenterY: y },
          });
          for (const { x: nx, y: ny } of footprint) {
            const neighbor = at(nx, ny)!;
            await tx.tile.update({
              where: { id: neighbor.id },
              data: { blockedByTree: true, treeCenterX: x, treeCenterY: y },
            });
          }

          return ok(
            `Planted ${treeType} tree at (${x}, ${y}). ${remaining} ${treeType} sapling(s) left. ` +
              "The 8 surrounding tiles are now blocked — it will grow as the world ticks forward."
          );
        });
      })
    )
  );

  server.registerTool(
    "harvest",
    {
      description: "Harvest a mature crop from the tile at the given coordinate.",
      inputSchema: { x: xSchema, y: ySchema },
    },
    withEventLog(
      prisma,
      agent.id,
      agent.farmId,
      "harvest",
      withGameLog(prisma, agent.farmId, "harvest", async ({ x, y }) => {
        return prisma.$transaction(async (tx) => {
          const tile = await getTile(tx, x, y);

          if (tile.fruitType && isTreeType(tile.fruitType)) {
            if (tile.debris === "WILTED") {
              return fail(`The fruit here wilted and died before it could be harvested — till (${x}, ${y}) to clear it.`);
            }
            const fruitType = tile.fruitType;
            await tx.tile.update({ where: { id: tile.id }, data: { fruitType: null, cropStage: 0 } });
            const quantity = await addItem(tx, agent.farmId, fruitType, 1);
            return ok(`Harvested 1 ${fruitType} from (${tile.x}, ${tile.y}). You now have ${quantity} ${fruitType} in your inventory.`);
          }

          if (tile.treeType) return fail("Trees can't be harvested directly — wait for them to drop fruit.");

          if (!tile.cropType) {
            if (tile.debris === "WILTED") {
              return fail(`The crop here wilted and died before it could be harvested — till (${x}, ${y}) to clear it.`);
            }
            return fail("Nothing to harvest here.");
          }
          if (!isCropType(tile.cropType) || !isMature(tile.cropType, tile.cropStage)) {
            return fail(`${tile.cropType} is still growing (stage ${tile.cropStage}) — check back after more ticks.`);
          }

          const cropType = tile.cropType;
          await tx.tile.update({
            where: { id: tile.id },
            data: { cropType: null, cropStage: 0, plantedAt: null },
          });
          const quantity = await addItem(tx, agent.farmId, cropType, 1);
          return ok(`Harvested 1 ${cropType} from (${tile.x}, ${tile.y}). You now have ${quantity} ${cropType} in your inventory.`);
        });
      })
    )
  );

  server.registerTool(
    "sell",
    {
      description: "Sell crops or debris from your inventory to the general store for gold.",
      inputSchema: {
        itemType: z.enum(SELLABLE_ITEM_TYPES).describe("A crop type, or debris: weed/rock"),
        quantity: z.number().int().min(1).max(1000).default(1),
      },
    },
    withEventLog(
      prisma,
      agent.id,
      agent.farmId,
      "sell",
      withGameLog(prisma, agent.farmId, "sell", async ({ itemType, quantity }) => {
        const price = getSellPrice(itemType);
        if (price === undefined) return fail(`${itemType} can't be sold.`);

        return prisma.$transaction(async (tx) => {
          const remaining = await consumeItem(tx, agent.farmId, itemType, quantity);
          if (remaining === null) return fail(`You don't have ${quantity} ${itemType} to sell.`);

          const earned = price * quantity;
          const gold = await addItem(tx, agent.farmId, GOLD_ITEM_TYPE, earned);
          return ok(`Sold ${quantity} ${itemType} for ${earned} gold. ${remaining} ${itemType} left, ${gold} gold total.`);
        });
      })
    )
  );

  server.registerTool(
    "buy_seeds",
    {
      description: "Buy seeds of a crop type from today's market rotation (see inspect_market), spending gold.",
      inputSchema: {
        cropType: z.enum(CROP_TYPES),
        quantity: z.number().int().min(1).max(1000).default(1),
      },
    },
    withEventLog(
      prisma,
      agent.id,
      agent.farmId,
      "buy_seeds",
      withGameLog(prisma, agent.farmId, "buy_seeds", async ({ cropType, quantity }) => {
        const todaysOffer = getTodaysSeedOffer();
        if (!todaysOffer.includes(cropType)) {
          return fail(`${cropType} isn't in today's market rotation (today: ${todaysOffer.join(", ")}). Check back tomorrow.`);
        }

        const cost = CROPS[cropType].seedCost * quantity;
        return prisma.$transaction(async (tx) => {
          const remainingGold = await consumeItem(tx, agent.farmId, GOLD_ITEM_TYPE, cost);
          if (remainingGold === null) {
            return fail(`You need ${cost} gold to buy ${quantity} ${cropType} seed(s) but don't have enough.`);
          }

          const seeds = await addItem(tx, agent.farmId, seedItemType(cropType), quantity);
          return ok(`Bought ${quantity} ${cropType} seed(s) for ${cost} gold. ${remainingGold} gold left, ${seeds} ${cropType} seed(s) total.`);
        });
      })
    )
  );

  server.registerTool(
    "buy_sapling",
    {
      description: "Buy tree saplings, spending gold. Unlike seeds, saplings are always available — not gated by the daily rotation.",
      inputSchema: {
        treeType: z.enum(TREE_TYPES),
        quantity: z.number().int().min(1).max(1000).default(1),
      },
    },
    withEventLog(
      prisma,
      agent.id,
      agent.farmId,
      "buy_sapling",
      withGameLog(prisma, agent.farmId, "buy_sapling", async ({ treeType, quantity }) => {
        const cost = TREES[treeType].saplingCost * quantity;
        return prisma.$transaction(async (tx) => {
          const remainingGold = await consumeItem(tx, agent.farmId, GOLD_ITEM_TYPE, cost);
          if (remainingGold === null) {
            return fail(`You need ${cost} gold to buy ${quantity} ${treeType} sapling(s) but don't have enough.`);
          }

          const saplings = await addItem(tx, agent.farmId, saplingItemType(treeType), quantity);
          return ok(
            `Bought ${quantity} ${treeType} sapling(s) for ${cost} gold. ${remainingGold} gold left, ${saplings} ${treeType} sapling(s) total.`
          );
        });
      })
    )
  );

  server.registerTool(
    "report_bug",
    {
      description:
        "Report a bug or unexpected behavior you encountered while playing. Files a GitHub issue for the developers to review.",
      inputSchema: {
        message: z
          .string()
          .min(1)
          .max(2000)
          .describe("What happened, what you expected instead, and any relevant coordinates or tool calls."),
      },
    },
    withEventLog(prisma, agent.id, agent.farmId, "report_bug", async ({ message }) => {
      const title = message.length > 80 ? `${message.slice(0, 77)}...` : message;
      const body = `${message}\n\n---\nReported by agent \`${agent.id}\` (farm \`${agent.farmId}\`) via the report_bug MCP tool.`;
      const issue = await createGithubIssue(title, body);

      await prisma.bugReport.create({
        data: {
          agentId: agent.id,
          farmId: agent.farmId,
          message,
          githubIssueUrl: issue?.url ?? null,
          githubIssueNumber: issue?.number ?? null,
        },
      });

      return issue
        ? ok(`Thanks — filed as GitHub issue #${issue.number}: ${issue.url}`)
        : ok("Thanks — your report was recorded. We couldn't file a GitHub issue automatically just now, but the team will still see it.");
    })
  );

  return server;
}
