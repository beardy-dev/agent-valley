import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Agent, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CROP_TYPES, isMature } from "../game/crops";
import { renderFarmAscii } from "../game/render";
import { broadcast } from "../web/connections";

const DIRECTIONS = ["up", "down", "left", "right"] as const;

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function describeTile(x: number, y: number, tile: { terrain: string; debris: string; cropType: string | null; cropStage: number }): string {
  const parts = [`(${x}, ${y})`, `terrain=${tile.terrain}`, `debris=${tile.debris}`];
  if (tile.cropType) {
    const mature = isMature(tile.cropType as any, tile.cropStage);
    parts.push(`crop=${tile.cropType}`, `stage=${tile.cropStage}`, `mature=${mature}`);
  } else {
    parts.push("crop=none");
  }
  return parts.join(", ");
}

/**
 * Builds a fresh MCP server (with all game tools registered) for a single
 * authenticated agent. Called once per HTTP request in the stateless
 * Streamable HTTP route — see src/mcp/route.ts.
 */
export async function buildGameMcpServer(prisma: PrismaClient, agent: Agent): Promise<McpServer> {
  const farm = await prisma.farm.findUniqueOrThrow({ where: { id: agent.farmId } });

  const server = new McpServer({ name: "agent-valley", version: "0.1.0" });

  async function currentTile() {
    return prisma.tile.findUniqueOrThrow({
      where: { farmId_x_y: { farmId: agent.farmId, x: agent.farmX, y: agent.farmY } },
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
    async ({ direction }) => {
      const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
      const newX = Math.max(0, Math.min(farm.width - 1, agent.farmX + delta[0]));
      const newY = Math.max(0, Math.min(farm.height - 1, agent.farmY + delta[1]));

      const updated = await prisma.agent.update({ where: { id: agent.id }, data: { farmX: newX, farmY: newY } });
      const tile = await prisma.tile.findUniqueOrThrow({
        where: { farmId_x_y: { farmId: agent.farmId, x: updated.farmX, y: updated.farmY } },
      });
      await broadcast(prisma, agent.farmId);
      return ok(`Moved ${direction} to ${describeTile(updated.farmX, updated.farmY, tile)}`);
    }
  );

  server.registerTool(
    "till",
    {
      description: "Clear debris (weeds/rocks) from the tile under your current position.",
    },
    async () => {
      const tile = await currentTile();
      if (tile.debris === "NONE") return fail("Nothing to till here — this tile is already clear.");
      if (tile.cropType) return fail("Can't till a tile with a crop planted on it.");

      await prisma.tile.update({ where: { id: tile.id }, data: { debris: "NONE" } });
      await broadcast(prisma, agent.farmId);
      return ok(`Cleared ${tile.debris.toLowerCase()} from (${tile.x}, ${tile.y}).`);
    }
  );

  server.registerTool(
    "plant",
    {
      description: "Plant a crop on the (cleared) tile under your current position.",
      inputSchema: {
        cropType: z.enum(CROP_TYPES),
      },
    },
    async ({ cropType }) => {
      const tile = await currentTile();
      if (tile.debris !== "NONE") return fail(`This tile still has ${tile.debris.toLowerCase()} on it — till it first.`);
      if (tile.cropType) return fail(`A ${tile.cropType} is already planted here.`);

      await prisma.tile.update({
        where: { id: tile.id },
        data: { cropType, cropStage: 0, plantedAt: new Date() },
      });
      await broadcast(prisma, agent.farmId);
      return ok(`Planted ${cropType} at (${tile.x}, ${tile.y}). It will grow as the world ticks forward.`);
    }
  );

  server.registerTool(
    "harvest",
    {
      description: "Harvest a mature crop from the tile under your current position.",
    },
    async () => {
      const tile = await currentTile();
      if (!tile.cropType) return fail("Nothing to harvest here.");
      if (!isMature(tile.cropType as any, tile.cropStage)) {
        return fail(`${tile.cropType} is still growing (stage ${tile.cropStage}) — check back after more ticks.`);
      }

      await prisma.tile.update({
        where: { id: tile.id },
        data: { cropType: null, cropStage: 0, plantedAt: null },
      });
      await broadcast(prisma, agent.farmId);
      return ok(`Harvested 1 ${tile.cropType} from (${tile.x}, ${tile.y}).`);
    }
  );

  return server;
}
