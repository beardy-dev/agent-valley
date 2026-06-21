import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { MARKET_FEED_LIMIT, subscribeMarket } from "./connections";
import { CROPS, isCropType } from "../game/crops";
import { DEBRIS_COLORS, DEBRIS_SYMBOLS } from "../game/render";
import { SELLABLE_ITEM_TYPES, getSellPrice, getTodaysSeedOffer } from "../game/market";
import { swatch } from "./html";

function sellIcon(itemType: string): { symbol: string; color: string } {
  if (isCropType(itemType)) {
    const def = CROPS[itemType];
    return { symbol: def.matureSymbol, color: def.matureColor };
  }
  if (itemType === "weed") return { symbol: DEBRIS_SYMBOLS.WEED, color: DEBRIS_COLORS.WEED };
  if (itemType === "rock") return { symbol: DEBRIS_SYMBOLS.ROCK, color: DEBRIS_COLORS.ROCK };
  return { symbol: "?", color: "#888" };
}

export function registerMarketRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/market", async (_request, reply) => {
    reply.type("text/html").send(renderMarketPage());
  });

  // Nested registration so @fastify/websocket's onRoute hook actually
  // upgrades this route — see the websocket gotcha noted in CLAUDE.md and
  // followed by registerViewerRoutes.
  app.register(async (scoped) => {
    scoped.get("/market/ws", { websocket: true }, async (socket) => {
      if (!subscribeMarket(socket)) {
        socket.send(JSON.stringify({ error: "Too many viewers connected right now — try again shortly." }));
        socket.close();
        return;
      }

      // Recent trades across every farm, so a freshly-opened feed isn't
      // blank until the next transaction happens. ActionLog is pruned per
      // farm to its most recent 50 actions of any kind, so a very active
      // farm's older trades may have already aged out — acceptable for a
      // "recent activity" backlog rather than a complete audit trail.
      const recent = await prisma.actionLog.findMany({
        where: { action: { in: ["sell", "buy_seeds"] }, success: true },
        include: { farm: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: MARKET_FEED_LIMIT,
      });

      socket.send(
        JSON.stringify({
          type: "backlog",
          transactions: recent.map((row) => ({
            farmId: row.farmId,
            farmName: row.farm.name,
            action: row.action,
            message: row.message,
            createdAt: row.createdAt.toISOString(),
          })),
        })
      );
    });
  });
}

function renderMarketPage(): string {
  const offer = getTodaysSeedOffer();
  const offerRows =
    offer.length === 0
      ? '<div class="empty">Nothing in rotation today.</div>'
      : offer
          .map((cropType) => {
            const def = CROPS[cropType];
            return (
              '<div class="market-row"><span>' +
              swatch(def.growingColor, def.growingSymbol) +
              ` ${cropType} seeds <span class="hint">(matures in ${def.matureStage} ticks)</span></span>` +
              `<span class="market-price">${def.seedCost} gold</span></div>`
            );
          })
          .join("");

  const sellRows = SELLABLE_ITEM_TYPES.map((itemType) => {
    const icon = sellIcon(itemType);
    return (
      '<div class="market-row"><span>' +
      swatch(icon.color, icon.symbol) +
      ` ${itemType}</span><span class="market-price">${getSellPrice(itemType)} gold</span></div>`
    );
  }).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Agent Valley — Market</title>
<style>
  body { background: #111; color: #eee; font-family: monospace; padding: 16px; max-width: 720px; margin: 0 auto; }
  h2 { margin: 0 0 4px; }
  h3 { color: #999; font-size: 13px; font-weight: normal; text-transform: uppercase; margin: 24px 0 8px; }
  a { color: #8af; }
  #meta { color: #888; margin-bottom: 8px; }
  .panel { border: 1px solid #333; border-radius: 4px; padding: 6px 8px; font-size: 13px; }
  .market-row { display: flex; justify-content: space-between; padding: 3px 0; }
  .market-price { color: #ddd; font-weight: bold; }
  .hint { color: #777; font-size: 0.85em; }
  .empty { color: #666; }
  #feed { max-height: 420px; overflow-y: auto; }
  .feed-entry { padding: 5px 0; border-bottom: 1px solid #222; }
  .feed-entry:last-child { border-bottom: none; }
  .feed-time { color: #666; }
  .feed-verb { color: #8fd98f; }
  .feed-message { color: #ccc; display: block; }
  .feed-farm { color: #8af; }
</style>
</head>
<body>
  <h2>&#127978; Market</h2>
  <div><a href="/">&larr; Home</a></div>
  <div id="meta">connecting...</div>

  <h3>Today's seeds for sale (rotates daily)</h3>
  <div class="panel">${offerRows}</div>

  <h3>Sell prices</h3>
  <div class="panel">${sellRows}</div>

  <h3>Live transactions</h3>
  <div class="panel" id="feed"><div class="empty">No transactions yet.</div></div>

  <script>
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/market/ws");
    const meta = document.getElementById("meta");
    const feed = document.getElementById("feed");
    const FEED_LIMIT = ${MARKET_FEED_LIMIT};
    let entries = [];

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function renderFeed() {
      if (entries.length === 0) {
        feed.innerHTML = '<div class="empty">No transactions yet.</div>';
        return;
      }
      feed.innerHTML = entries.map((t) => {
        const time = new Date(t.createdAt).toLocaleTimeString();
        const verb = t.action === "buy_seeds" ? "bought" : "sold";
        const farmLabel = escapeHtml(t.farmName || t.farmId.slice(0, 8));
        return '<div class="feed-entry">' +
          '<span class="feed-time">' + time + '</span> ' +
          '<a class="feed-farm" href="/farms/' + t.farmId + '">' + farmLabel + '</a> ' +
          '<span class="feed-verb">' + verb + '</span>' +
          '<span class="feed-message">' + escapeHtml(t.message) + '</span>' +
          '</div>';
      }).join("");
    }

    ws.onopen = () => { meta.textContent = "connected — live"; };
    ws.onclose = () => { meta.textContent = "disconnected"; };
    ws.onerror = () => { meta.textContent = "connection error"; };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) { meta.textContent = data.error; return; }
      if (data.type === "backlog") {
        entries = data.transactions;
      } else if (data.type === "transaction") {
        entries.unshift(data);
        if (entries.length > FEED_LIMIT) entries.length = FEED_LIMIT;
      }
      renderFeed();
    };
  </script>
</body>
</html>`;
}
