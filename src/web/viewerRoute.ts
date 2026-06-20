import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { broadcast, HISTORY_LIMIT, subscribe } from "./connections";
import { DEBRIS_COLORS, DEBRIS_SYMBOLS } from "../game/render";
import { CROPS } from "../game/crops";

function swatch(color: string, symbol: string): string {
  return `<span style="color:${color};">${symbol}</span>`;
}

const LEGEND = [
  `Legend: ${swatch(DEBRIS_COLORS.NONE, DEBRIS_SYMBOLS.NONE)} dirt`,
  `${swatch(DEBRIS_COLORS.WEED, DEBRIS_SYMBOLS.WEED)} weed`,
  `${swatch(DEBRIS_COLORS.ROCK, DEBRIS_SYMBOLS.ROCK)} rock`,
  ...Object.entries(CROPS).map(
    ([name, def]) =>
      `${swatch(def.growingColor, def.growingSymbol)}/${swatch(def.matureColor, def.matureSymbol)} ${name} (growing/mature)`
  ),
].join(" | ");

export function registerViewerRoutes(app: FastifyInstance, prisma: PrismaClient) {
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

      subscribe(farmId, socket);
      await broadcast(prisma, farmId);
    });
  });
}

function renderViewerPage(farmId: string, name: string | null): string {
  const title = name ? `${name} (${farmId})` : farmId;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Agent Valley — ${title}</title>
<style>
  body { background: #111; color: #eee; font-family: monospace; padding: 16px; }
  h2 { margin: 0 0 4px; }
  #legend, #meta { color: #888; margin-bottom: 8px; }
  #board { display: flex; gap: 24px; align-items: flex-start; }
  #grid { font-size: 16px; line-height: 1.05; white-space: pre; }
  #history-panel { width: 340px; flex-shrink: 0; }
  #history-panel h3 { margin: 0 0 8px; font-size: 13px; color: #999; font-weight: normal; text-transform: uppercase; }
  #history { max-height: 640px; overflow-y: auto; border: 1px solid #333; border-radius: 4px; padding: 6px 8px; font-size: 12px; }
  .history-entry { padding: 5px 0; border-bottom: 1px solid #222; }
  .history-entry:last-child { border-bottom: none; }
  .history-time { color: #666; }
  .history-ok { color: #8fd98f; }
  .history-fail { color: #e08a8a; }
  .history-message { color: #ccc; display: block; }
  .history-empty { color: #666; }
</style>
</head>
<body>
  <h2>${title}</h2>
  <div><a href="/world" style="color:#8af;">&larr; World Map</a></div>
  <div id="legend">${LEGEND}</div>
  <div id="meta">connecting...</div>
  <div id="board">
    <pre id="grid">loading...</pre>
    <div id="history-panel">
      <h3>Action history (last ${HISTORY_LIMIT})</h3>
      <div id="history"><div class="history-empty">No actions yet.</div></div>
    </div>
  </div>
  <script>
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/farms/${farmId}/ws");
    const meta = document.getElementById("meta");
    const grid = document.getElementById("grid");
    const history = document.getElementById("history");

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
        return '<div class="history-entry">' +
          '<span class="history-time">' + time + '</span> ' +
          '<span class="' + cls + '">' + icon + ' ' + escapeHtml(a.action) + ' (' + a.x + ', ' + a.y + ')</span>' +
          '<span class="history-message">' + escapeHtml(a.message) + '</span>' +
          '</div>';
      }).join("");
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
    };
  </script>
</body>
</html>`;
}
