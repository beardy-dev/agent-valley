import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Agent, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CROP_TYPES, isCropType, isMature } from "../game/crops";
import { renderFarmAscii } from "../game/render";
import { broadcast } from "../web/connections";

type Db = PrismaClient | Prisma.TransactionClient;

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
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

// Wraps a mutating tool handler so every successful action broadcasts the
// farm's new state to live web viewers — callers never have to remember to
// call broadcast() themselves, so a future tool can't forget it.
function withBroadcast<Args extends unknown[]>(
  prisma: PrismaClient,
  farmId: string,
  handler: (...args: Args) => Promise<CallToolResult>
): (...args: Args) => Promise<CallToolResult> {
  return async (...args: Args) => {
    const result = await handler(...args);
    if (!result.isError) await broadcast(prisma, farmId);
    return result;
  };
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
    async ({ farmId }) => {
      const targetFarmId = farmId ?? agent.farmId;
      const targetFarm = await prisma.farm.findUnique({ where: { id: targetFarmId } });
      if (!targetFarm) return fail(`No farm found with id ${targetFarmId}`);

      const tiles = await prisma.tile.findMany({ where: { farmId: targetFarmId } });
      const ascii = renderFarmAscii(tiles, targetFarm.width, targetFarm.height);

      const legend = "Legend: . dirt | W weed | R rock | lowercase growing crop | UPPERCASE mature crop";
      return ok(`Farm ${targetFarm.id} (${targetFarm.width}x${targetFarm.height})\n${legend}\n\n${ascii}`);
    }
  );

  server.registerTool(
    "inspect_tile",
    {
      description: "Inspect a single tile on your own farm by coordinate.",
      inputSchema: { x: xSchema, y: ySchema },
    },
    async ({ x, y }) => {
      const tile = await prisma.tile.findUnique({ where: { farmId_x_y: { farmId: agent.farmId, x, y } } });
      if (!tile) return fail(`No tile at (${x}, ${y})`);
      return ok(describeTile(x, y, tile));
    }
  );

  server.registerTool(
    "till",
    {
      description: "Clear debris (weeds/rocks) from the tile at the given coordinate.",
      inputSchema: { x: xSchema, y: ySchema },
    },
    withBroadcast(prisma, agent.farmId, async ({ x, y }) => {
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
  );

  server.registerTool(
    "plant",
    {
      description: "Plant a crop on the (cleared) tile at the given coordinate.",
      inputSchema: { x: xSchema, y: ySchema, cropType: z.enum(CROP_TYPES) },
    },
    withBroadcast(prisma, agent.farmId, async ({ x, y, cropType }) => {
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
  );

  server.registerTool(
    "harvest",
    {
      description: "Harvest a mature crop from the tile at the given coordinate.",
      inputSchema: { x: xSchema, y: ySchema },
    },
    withBroadcast(prisma, agent.farmId, async ({ x, y }) => {
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
  );

  return server;
}
