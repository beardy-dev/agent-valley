import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { broadcast, subscribe } from "./connections";

const LEGEND = "Legend: . dirt | W weed | R rock | lowercase growing crop | UPPERCASE mature crop | @ agent";

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
  #grid { font-size: 16px; line-height: 1.05; white-space: pre; }
</style>
</head>
<body>
  <h2>${title}</h2>
  <div><a href="/world" style="color:#8af;">&larr; World Map</a></div>
  <div id="legend">${LEGEND}</div>
  <div id="meta">connecting...</div>
  <pre id="grid">loading...</pre>
  <script>
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/farms/${farmId}/ws");
    const meta = document.getElementById("meta");
    const grid = document.getElementById("grid");
    ws.onopen = () => { meta.textContent = "connected — live"; };
    ws.onclose = () => { meta.textContent = "disconnected"; };
    ws.onerror = () => { meta.textContent = "connection error"; };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) { meta.textContent = data.error; return; }
      meta.textContent = "updated " + data.updatedAt;
      grid.textContent = data.ascii;
    };
  </script>
</body>
</html>`;
}
