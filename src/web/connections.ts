import { PrismaClient } from "@prisma/client";
import { WebSocket } from "@fastify/websocket";
import { renderFarmAscii, renderFarmHtml } from "../game/render";

// farmId -> set of live human viewers currently watching that farm's dashboard.
const viewers = new Map<string, Set<WebSocket>>();

export function subscribe(farmId: string, socket: WebSocket): void {
  let sockets = viewers.get(farmId);
  if (!sockets) {
    sockets = new Set();
    viewers.set(farmId, sockets);
  }
  sockets.add(socket);

  socket.on("close", () => {
    sockets!.delete(socket);
    if (sockets!.size === 0) viewers.delete(farmId);
  });
}

// Single source of truth for "how much action history do we keep/show per
// farm" — used both to cap the query here and to prune storage in
// src/mcp/tools.ts's recordAction, and shown in the viewer page's heading.
export const HISTORY_LIMIT = 50;

async function renderAndSend(prisma: PrismaClient, farmId: string, sockets: Set<WebSocket>): Promise<void> {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  if (!farm) return;

  const [tiles, actions] = await Promise.all([
    prisma.tile.findMany({ where: { farmId } }),
    prisma.actionLog.findMany({ where: { farmId }, orderBy: { createdAt: "desc" }, take: HISTORY_LIMIT }),
  ]);

  const payload = JSON.stringify({
    farmId,
    width: farm.width,
    height: farm.height,
    ascii: renderFarmAscii(tiles, farm.width, farm.height),
    html: renderFarmHtml(tiles, farm.width, farm.height),
    actions: actions.map((a) => ({
      action: a.action,
      x: a.x,
      y: a.y,
      message: a.message,
      success: a.success,
      createdAt: a.createdAt.toISOString(),
    })),
    updatedAt: new Date().toISOString(),
  });

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

// Push the current state of one farm to its viewers, if any are connected.
export async function broadcast(prisma: PrismaClient, farmId: string): Promise<void> {
  const sockets = viewers.get(farmId);
  if (!sockets || sockets.size === 0) return;
  await renderAndSend(prisma, farmId, sockets);
}

// Push current state to every farm that has at least one live viewer.
// If `farmIds` is given, only farms in that set are re-rendered/sent — used
// after a tick so farms with no crop growth this tick aren't needlessly
// re-fetched and re-rendered for viewers watching an unrelated farm.
export async function broadcastAll(prisma: PrismaClient, farmIds?: Iterable<string>): Promise<void> {
  const targets = farmIds ? new Set(farmIds) : undefined;
  const entries = [...viewers.entries()].filter(([farmId]) => !targets || targets.has(farmId));
  await Promise.all(entries.map(([farmId, sockets]) => renderAndSend(prisma, farmId, sockets)));
}
