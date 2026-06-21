import { PrismaClient } from "@prisma/client";
import { WebSocket } from "@fastify/websocket";
import { getInventory } from "../game/inventory";
import { renderFarmAscii, renderFarmHtml } from "../game/render";

// farmId -> set of live human viewers currently watching that farm's dashboard.
const viewers = new Map<string, Set<WebSocket>>();

// The viewer endpoint is intentionally public/unauthenticated, so cap both
// how many sockets can pile onto one farm and how many can pile onto the
// server overall — without this, an attacker could open unbounded sockets
// (farm ids are enumerable via /world/farms) and make every broadcast fan
// out to an unbounded number of full-grid re-renders.
const MAX_VIEWERS_PER_FARM = 50;
const MAX_TOTAL_VIEWERS = 1000;
let totalViewers = 0;

export function subscribe(farmId: string, socket: WebSocket): boolean {
  if (totalViewers >= MAX_TOTAL_VIEWERS) return false;

  let sockets = viewers.get(farmId);
  if (!sockets) {
    sockets = new Set();
    viewers.set(farmId, sockets);
  }
  if (sockets.size >= MAX_VIEWERS_PER_FARM) return false;

  sockets.add(socket);
  totalViewers++;

  socket.on("close", () => {
    sockets!.delete(socket);
    if (sockets!.size === 0) viewers.delete(farmId);
    totalViewers--;
  });
  return true;
}

// Single source of truth for "how much action history do we keep/show per
// farm" — used both to cap the query here and to prune storage in
// src/mcp/tools.ts's recordAction, and shown in the viewer page's heading.
export const HISTORY_LIMIT = 50;

// farmId-less set of live viewers on the global /market page — unlike the
// per-farm `viewers` map, market activity isn't scoped to one farm, so
// there's just one shared set of sockets.
const marketViewers = new Set<WebSocket>();

// Public/unauthenticated endpoint, same reasoning as MAX_VIEWERS_PER_FARM —
// cap it so an attacker can't pile up unbounded sockets.
const MAX_MARKET_VIEWERS = 200;

// How many recent sell/buy_seeds transactions a freshly-connected market
// viewer is sent as backlog (see src/web/marketRoute.ts), so the feed isn't
// blank until the next trade happens.
export const MARKET_FEED_LIMIT = 30;

export function subscribeMarket(socket: WebSocket): boolean {
  if (marketViewers.size >= MAX_MARKET_VIEWERS) return false;
  marketViewers.add(socket);
  socket.on("close", () => {
    marketViewers.delete(socket);
  });
  return true;
}

export type MarketAction = "sell" | "buy_seeds";

// Pushes one completed trade to every live /market viewer. No-op if nobody
// is watching, same as broadcast() below — avoids the farm-name lookup
// entirely when there's nothing to send it to.
export async function broadcastMarketEvent(
  prisma: PrismaClient,
  farmId: string,
  action: MarketAction,
  message: string
): Promise<void> {
  if (marketViewers.size === 0) return;

  const farm = await prisma.farm.findUnique({ where: { id: farmId }, select: { name: true } });
  const payload = JSON.stringify({
    type: "transaction",
    farmId,
    farmName: farm?.name ?? null,
    action,
    message,
    createdAt: new Date().toISOString(),
  });

  for (const socket of marketViewers) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

async function renderAndSend(prisma: PrismaClient, farmId: string, sockets: Set<WebSocket>): Promise<void> {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  if (!farm) return;

  const [tiles, actions, inventory] = await Promise.all([
    prisma.tile.findMany({ where: { farmId } }),
    prisma.actionLog.findMany({ where: { farmId }, orderBy: { createdAt: "desc" }, take: HISTORY_LIMIT }),
    getInventory(prisma, farmId),
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
    inventory: inventory.map((item) => ({ itemType: item.itemType, quantity: item.quantity })),
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
