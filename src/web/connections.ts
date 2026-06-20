import { PrismaClient } from "@prisma/client";
import { WebSocket } from "@fastify/websocket";
import { renderFarmAscii } from "../game/render";

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

async function renderAndSend(prisma: PrismaClient, farmId: string, sockets: Set<WebSocket>): Promise<void> {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  if (!farm) return;

  const tiles = await prisma.tile.findMany({ where: { farmId } });
  const ascii = renderFarmAscii(tiles, farm.width, farm.height);
  const payload = JSON.stringify({
    farmId,
    width: farm.width,
    height: farm.height,
    ascii,
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
