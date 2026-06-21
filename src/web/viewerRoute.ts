import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { broadcast, HISTORY_LIMIT, subscribe } from "./connections";
import { DEBRIS_COLORS, DEBRIS_SYMBOLS } from "../game/render";
import { CROPS } from "../game/crops";
import { GOLD_ITEM_TYPE, getTodaysSeedOffer } from "../game/market";
import { SEED_PREFIX, seedItemType } from "../game/inventory";
import { escapeHtml, swatch } from "./html";

const LEGEND = [
  `${swatch(DEBRIS_COLORS.NONE, DEBRIS_SYMBOLS.NONE)} dirt`,
  `${swatch(DEBRIS_COLORS.WEED, DEBRIS_SYMBOLS.WEED)} weed`,
  `${swatch(DEBRIS_COLORS.ROCK, DEBRIS_SYMBOLS.ROCK)} rock`,
  ...Object.entries(CROPS).map(
    ([name, def]) =>
      `${swatch(def.growingColor, def.growingSymbol)}/${swatch(def.matureColor, def.matureSymbol)} ${name} (growing/mature)`
  ),
].join(" | ");

// Icon + section shown per inventory item type, driving how the viewer's
// inventory panel groups and renders each row. Debris uses its tile
// symbol/color; harvested produce uses the mature symbol/color; seeds (a
// separate "seed_<crop>" key — see src/game/inventory.ts) use the *growing*
// symbol/color, so the same crop's seed and harvested icons are visually
// distinct. Gold isn't a tile/crop and gets its own line in the panel
// (outside the three sections), but still gets a hand-picked icon entry.
type ItemSection = "seed" | "harvested" | "misc";
const ITEM_ICONS: Record<string, { symbol: string; color: string; section: ItemSection; matureStage?: number }> = {
  [GOLD_ITEM_TYPE]: { symbol: "$", color: "#ffd700", section: "misc" },
  weed: { symbol: DEBRIS_SYMBOLS.WEED, color: DEBRIS_COLORS.WEED, section: "misc" },
  rock: { symbol: DEBRIS_SYMBOLS.ROCK, color: DEBRIS_COLORS.ROCK, section: "misc" },
  ...Object.fromEntries(
    Object.entries(CROPS).map(([name, def]) => [name, { symbol: def.matureSymbol, color: def.matureColor, section: "harvested" as const }])
  ),
  // Seed rows additionally carry matureStage (ticks to grow, see
  // src/game/crops.ts) so the inventory panel can show how long a seed
  // takes to mature once planted.
  ...Object.fromEntries(
    Object.entries(CROPS).map(([name, def]) => [
      seedItemType(name as keyof typeof CROPS),
      { symbol: def.growingSymbol, color: def.growingColor, section: "seed" as const, matureStage: def.matureStage },
    ])
  ),
};

export function registerViewerRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // Registered ahead of /farms/:farmId for clarity; Fastify's router already
  // prefers this static route over the parametric one regardless of order.
  app.get("/farms/random", async (_request, reply) => {
    // Fetch every id in one query and pick in-memory rather than count()+skip
    // on an unindexed column — avoids an ever-growing sorted scan as the
    // world fills up, and avoids the TOCTOU race of two separate queries
    // (a farm deleted between count() and the skip could make skip overshoot).
    const farms = await prisma.farm.findMany({ select: { id: true } });
    if (farms.length === 0) {
      reply.code(404).type("text/html");
      return renderNoFarmsPage();
    }

    const farm = farms[Math.floor(Math.random() * farms.length)];
    return reply.redirect(`/farms/${farm.id}`);
  });

  app.get("/farms/:farmId", async (request, reply) => {
    const { farmId } = request.params as { farmId: string };
    const farm = await prisma.farm.findUnique({ where: { id: farmId } });
    if (!farm) {
      reply.code(404);
      return { error: `No farm found with id ${farmId}` };
    }

    reply.type("text/html").send(renderViewerPage(farmId, farm.name));
  });

  // The websocket route must be registered in a nested encapsulation context —
  // @fastify/websocket's onRoute hook only upgrades routes added this way, not
  // ones added directly on the root instance.
  app.register(async (scoped) => {
    scoped.get("/farms/:farmId/ws", { websocket: true }, async (socket, request) => {
      const { farmId } = request.params as { farmId: string };
      const farm = await prisma.farm.findUnique({ where: { id: farmId } });
      if (!farm) {
        socket.send(JSON.stringify({ error: `No farm found with id ${farmId}` }));
        socket.close();
        return;
      }

      if (!subscribe(farmId, socket)) {
        socket.send(JSON.stringify({ error: "Too many viewers connected right now — try again shortly." }));
        socket.close();
        return;
      }
      await broadcast(prisma, farmId);
    });
  });
}

function renderNoFarmsPage(): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Agent Valley</title>
<style>body { background: #111; color: #eee; font-family: monospace; padding: 24px; } a { color: #8af; }</style>
</head>
<body>
  <p>No farms registered yet.</p>
  <p><a href="/">&larr; Home</a></p>
</body>
</html>`;
}

// Today's seed rotation, rendered as inventory-style rows. Computed fresh
// per page request (not hoisted to module scope like LEGEND) since, unlike
// the legend, this actually changes once a day — see getTodaysSeedOffer.
function renderMarketOfferRows(): string {
  const offer = getTodaysSeedOffer();
  if (offer.length === 0) return '<div class="history-empty">Nothing in rotation today.</div>';
  return offer
    .map((cropType) => {
      const def = CROPS[cropType];
      return (
        '<div class="inventory-entry"><span>' +
        swatch(def.growingColor, def.growingSymbol) +
        ` ${cropType} seeds <span class="hint">(matures in ${def.matureStage} ticks)</span></span>` +
        `<span class="inventory-qty">${def.seedCost} gold</span></div>`
      );
    })
    .join("");
}

function renderViewerPage(farmId: string, name: string | null): string {
  const title = name ? `${escapeHtml(name)} (${farmId})` : farmId;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Agent Valley — ${title}</title>
<style>
  body { background: #111; color: #eee; font-family: monospace; padding: 16px; }
  h2 { margin: 0 0 4px; }
  #legend, #meta { color: #888; margin-bottom: 8px; }
  #legend-panel summary { cursor: pointer; color: #888; margin-bottom: 4px; }
  #legend-panel summary:hover { color: #ccc; }
  #legend-panel #legend { margin-top: 4px; }
  #board { display: flex; gap: 24px; align-items: flex-start; }
  #grid { font-size: 16px; line-height: 1.05; white-space: pre; }
  #sidebar { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; gap: 20px; }
  #sidebar h3 { margin: 0 0 8px; font-size: 13px; color: #999; font-weight: normal; text-transform: uppercase; }
  #history { max-height: 480px; overflow-y: auto; border: 1px solid #333; border-radius: 4px; padding: 6px 8px; font-size: 12px; }
  .history-entry { padding: 5px 0; border-bottom: 1px solid #222; }
  .history-entry:last-child { border-bottom: none; }
  .history-time { color: #666; }
  .history-ok { color: #8fd98f; }
  .history-fail { color: #e08a8a; }
  .history-message { color: #ccc; display: block; }
  .history-empty { color: #666; }
  #inventory { border: 1px solid #333; border-radius: 4px; padding: 6px 8px; font-size: 13px; }
  .inventory-gold { display: flex; justify-content: space-between; padding: 3px 0; font-weight: bold; color: #ffd700; border-bottom: 1px solid #333; margin-bottom: 6px; }
  .inventory-section { margin-bottom: 10px; }
  .inventory-section:last-child { margin-bottom: 0; }
  .inventory-section h4 { margin: 0 0 4px; font-size: 11px; color: #888; font-weight: normal; text-transform: uppercase; }
  .inventory-entry { display: flex; justify-content: space-between; padding: 3px 0; }
  .inventory-qty { color: #ddd; font-weight: bold; }
  .hint { color: #777; font-size: 0.85em; }
  #market { border: 1px solid #333; border-radius: 4px; padding: 6px 8px; font-size: 13px; }
  #market-panel h3 a { color: #8af; font-weight: normal; }
</style>
</head>
<body>
  <h2>${title}</h2>
  <div><a href="/world" style="color:#8af;">&larr; World Map</a> &middot; <a href="/market" style="color:#8af;">&#127978; Market</a></div>
  <details id="legend-panel" open>
    <summary>Legend</summary>
    <div id="legend">${LEGEND}</div>
  </details>
  <div id="meta">connecting...</div>
  <div id="board">
    <pre id="grid">loading...</pre>
    <div id="sidebar">
      <div id="history-panel">
        <h3>Action history (last ${HISTORY_LIMIT})</h3>
        <div id="history"><div class="history-empty">No actions yet.</div></div>
      </div>
      <div id="inventory-panel">
        <h3>Inventory</h3>
        <div id="inventory"><div class="history-empty">Empty.</div></div>
      </div>
      <div id="market-panel">
        <h3>Today's seeds (<a href="/market" style="text-transform:none;">live feed &rarr;</a>)</h3>
        <div id="market">${renderMarketOfferRows()}</div>
      </div>
    </div>
  </div>
  <script>
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/farms/${farmId}/ws");
    const meta = document.getElementById("meta");
    const grid = document.getElementById("grid");
    const history = document.getElementById("history");
    const inventory = document.getElementById("inventory");
    const ITEM_ICONS = ${JSON.stringify(ITEM_ICONS)};
    const GOLD_ITEM_TYPE = ${JSON.stringify(GOLD_ITEM_TYPE)};
    const SEED_PREFIX = ${JSON.stringify(SEED_PREFIX)};

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function renderHistory(actions) {
      if (!actions || actions.length === 0) {
        history.innerHTML = '<div class="history-empty">No actions yet.</div>';
        return;
      }
      history.innerHTML = actions.map((a) => {
        const time = new Date(a.createdAt).toLocaleTimeString();
        const cls = a.success ? "history-ok" : "history-fail";
        const icon = a.success ? "\\u2713" : "\\u2717";
        const coords = (a.x !== null && a.y !== null) ? ' (' + a.x + ', ' + a.y + ')' : '';
        return '<div class="history-entry">' +
          '<span class="history-time">' + time + '</span> ' +
          '<span class="' + cls + '">' + icon + ' ' + escapeHtml(a.action) + coords + '</span>' +
          '<span class="history-message">' + escapeHtml(a.message) + '</span>' +
          '</div>';
      }).join("");
    }

    function itemLabel(itemType) {
      return itemType.startsWith(SEED_PREFIX) ? itemType.slice(SEED_PREFIX.length) + " seeds" : itemType;
    }

    function renderInventoryRow(item) {
      const icon = ITEM_ICONS[item.itemType] || { symbol: "?", color: "#888" };
      const hint = icon.matureStage !== undefined ? ' <span class="hint">(matures in ' + icon.matureStage + ' ticks)</span>' : '';
      return '<div class="inventory-entry">' +
        '<span><span style="color:' + icon.color + ';">' + icon.symbol + '</span> ' + escapeHtml(itemLabel(item.itemType)) + hint + '</span>' +
        '<span class="inventory-qty">' + item.quantity + '</span>' +
        '</div>';
    }

    function renderSection(label, rows) {
      return '<div class="inventory-section"><h4>' + label + '</h4>' +
        (rows.length > 0 ? rows.map(renderInventoryRow).join("") : '<div class="history-empty">None</div>') +
        '</div>';
    }

    function renderInventory(items) {
      if (!items || items.length === 0) {
        inventory.innerHTML = '<div class="history-empty">Empty.</div>';
        return;
      }
      const gold = items.find((item) => item.itemType === GOLD_ITEM_TYPE);
      const sections = { seed: [], harvested: [], misc: [] };
      for (const item of items) {
        if (item.itemType === GOLD_ITEM_TYPE) continue;
        const section = (ITEM_ICONS[item.itemType] || {}).section || "misc";
        sections[section].push(item);
      }
      inventory.innerHTML =
        '<div class="inventory-gold"><span>$ Gold</span><span>' + (gold ? gold.quantity : 0) + '</span></div>' +
        renderSection("Seeds", sections.seed) +
        renderSection("Harvested", sections.harvested) +
        renderSection("Misc", sections.misc);
    }

    ws.onopen = () => { meta.textContent = "connected — live"; };
    ws.onclose = () => { meta.textContent = "disconnected"; };
    ws.onerror = () => { meta.textContent = "connection error"; };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) { meta.textContent = data.error; return; }
      meta.textContent = "updated " + data.updatedAt;
      grid.innerHTML = data.html;
      renderHistory(data.actions);
      renderInventory(data.inventory);
    };
  </script>
</body>
</html>`;
}
