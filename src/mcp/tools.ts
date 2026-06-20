import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Agent, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CROP_TYPES, isCropType, isMature } from "../game/crops";
import { renderFarmAscii } from "../game/render";
import { broadcast } from "../web/connections";

type Db = PrismaClient | Prisma.TransactionClient;

const DIRECTIONS = ["up", "down", "left", "right"] as const;

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
 */
export async function buildGameMcpServer(prisma: PrismaClient, agent: Agent): Promise<McpServer> {
  const farm = await prisma.farm.findUniqueOrThrow({ where: { id: agent.farmId } });

  const server = new McpServer({ name: "agent-valley", version: "0.1.0" });

  // Re-reads the agent's current position inside the given db handle (a
  // transaction, when called from a mutating tool) rather than trusting the
  // farmX/farmY snapshot captured when this server was built — that snapshot
  // can be stale if another request moved the agent in the meantime.
  async function currentTile(db: Db) {
    const current = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    return db.tile.findUniqueOrThrow({
      where: { farmId_x_y: { farmId: agent.farmId, x: current.farmX, y: current.farmY } },
    });
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
      const isOwnFarm = targetFarmId === agent.farmId;
      const ascii = renderFarmAscii(tiles, targetFarm.width, targetFarm.height, isOwnFarm ? { x: agent.farmX, y: agent.farmY } : undefined);

      const legend = "Legend: . dirt | W weed | R rock | lowercase growing crop | UPPERCASE mature crop | @ you (own farm only)";
      return ok(`Farm ${targetFarm.id} (${targetFarm.width}x${targetFarm.height})\n${legend}\n\n${ascii}`);
    }
  );

  server.registerTool(
    "inspect_tile",
    {
      description: "Inspect a single tile on your own farm. Defaults to your current position.",
      inputSchema: {
        x: z.number().int().min(0).max(farm.width - 1).optional(),
        y: z.number().int().min(0).max(farm.height - 1).optional(),
      },
    },
    async ({ x, y }) => {
      const tx = x ?? agent.farmX;
      const ty = y ?? agent.farmY;
      const tile = await prisma.tile.findUnique({ where: { farmId_x_y: { farmId: agent.farmId, x: tx, y: ty } } });
      if (!tile) return fail(`No tile at (${tx}, ${ty})`);
      return ok(describeTile(tx, ty, tile));
    }
  );

  server.registerTool(
    "move",
    {
      description: "Move your avatar one tile within your own farm (clamped at the edges).",
      inputSchema: {
        direction: z.enum(DIRECTIONS),
      },
    },
    withBroadcast(prisma, agent.farmId, async ({ direction }: { direction: (typeof DIRECTIONS)[number] }) => {
      const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];

      // Reading the agent's position and writing the new one happen inside
      // one transaction so two concurrent `move` calls for the same agent
      // can't both compute their target from the same stale position and
      // clobber each other.
      const { updated, tile } = await prisma.$transaction(async (tx) => {
        const current = await tx.agent.findUniqueOrThrow({ where: { id: agent.id } });
        const newX = Math.max(0, Math.min(farm.width - 1, current.farmX + delta[0]));
        const newY = Math.max(0, Math.min(farm.height - 1, current.farmY + delta[1]));

        const updated = await tx.agent.update({ where: { id: agent.id }, data: { farmX: newX, farmY: newY } });
        const tile = await tx.tile.findUniqueOrThrow({
          where: { farmId_x_y: { farmId: agent.farmId, x: updated.farmX, y: updated.farmY } },
        });
        return { updated, tile };
      });

      return ok(`Moved ${direction} to ${describeTile(updated.farmX, updated.farmY, tile)}`);
    })
  );

  server.registerTool(
    "till",
    {
      description: "Clear debris (weeds/rocks) from the tile under your current position.",
    },
    withBroadcast(prisma, agent.farmId, async () => {
      // currentTile's read and the tile.update below run inside one
      // transaction so a concurrent till/plant/harvest on the same tile
      // can't pass its precondition check against a row this call is about
      // to overwrite.
      return prisma.$transaction(async (tx) => {
        const tile = await currentTile(tx);
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
      description: "Plant a crop on the (cleared) tile under your current position.",
      inputSchema: {
        cropType: z.enum(CROP_TYPES),
      },
    },
    withBroadcast(prisma, agent.farmId, async ({ cropType }) => {
      return prisma.$transaction(async (tx) => {
        const tile = await currentTile(tx);
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
      description: "Harvest a mature crop from the tile under your current position.",
    },
    withBroadcast(prisma, agent.farmId, async () => {
      return prisma.$transaction(async (tx) => {
        const tile = await currentTile(tx);
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
