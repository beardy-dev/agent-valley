import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Agent, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CROP_TYPES, isCropType, isMature } from "../game/crops";
import { renderFarmAscii } from "../game/render";
import { broadcast, HISTORY_LIMIT } from "../web/connections";

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

function describeTile(x: number, y: number, tile: { terrain: string; debris: string; cropType: string | null; cropStage: number }): string {
  const parts = [`(${x}, ${y})`, `terrain=${tile.terrain}`, `debris=${tile.debris}`];
  if (tile.cropType && isCropType(tile.cropType)) {
    parts.push(`crop=${tile.cropType}`, `stage=${tile.cropStage}`, `mature=${isMature(tile.cropType, tile.cropStage)}`);
  } else if (tile.cropType) {
    parts.push(`crop=${tile.cropType}`, "mature=unknown");
  } else {
    parts.push("crop=none");
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
  x: number,
  y: number,
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
// themselves, so a future tool can't forget either.
function withGameLog<Arg extends { x: number; y: number }>(
  prisma: PrismaClient,
  farmId: string,
  action: string,
  handler: (arg: Arg) => Promise<CallToolResult>
): (arg: Arg) => Promise<CallToolResult> {
  return async (arg: Arg) => {
    const result = await handler(arg);
    await recordAction(prisma, farmId, action, arg.x, arg.y, resultText(result), !result.isError);
    await broadcast(prisma, farmId);
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

      const legend = "Legend: . dirt | W weed | R rock | lowercase growing crop | UPPERCASE mature crop";
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
          if (tile.debris === "NONE") return fail("Nothing to till here — this tile is already clear.");
          if (tile.cropType) return fail("Can't till a tile with a crop planted on it.");

          await tx.tile.update({ where: { id: tile.id }, data: { debris: "NONE" } });
          return ok(`Cleared ${tile.debris.toLowerCase()} from (${tile.x}, ${tile.y}).`);
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
          if (tile.debris !== "NONE") return fail(`This tile still has ${tile.debris.toLowerCase()} on it — till it first.`);
          if (tile.cropType) return fail(`A ${tile.cropType} is already planted here.`);

          await tx.tile.update({
            where: { id: tile.id },
            data: { cropType, cropStage: 0, plantedAt: new Date() },
          });
          return ok(`Planted ${cropType} at (${tile.x}, ${tile.y}). It will grow as the world ticks forward.`);
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
          if (!tile.cropType) return fail("Nothing to harvest here.");
          if (!isCropType(tile.cropType) || !isMature(tile.cropType, tile.cropStage)) {
            return fail(`${tile.cropType} is still growing (stage ${tile.cropStage}) — check back after more ticks.`);
          }

          await tx.tile.update({
            where: { id: tile.id },
            data: { cropType: null, cropStage: 0, plantedAt: null },
          });
          return ok(`Harvested 1 ${tile.cropType} from (${tile.x}, ${tile.y}).`);
        });
      })
    )
  );

  return server;
}
