import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

export function registerWorldRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/world/farms", async () => {
    return prisma.farm.findMany({
      select: { id: true, name: true, worldX: true, worldY: true },
      orderBy: [{ worldY: "asc" }, { worldX: "asc" }],
    });
  });

  app.get("/world", async (_request, reply) => {
    reply.type("text/html").send(renderWorldPage());
  });
}

function renderWorldPage(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Agent Valley — World Map</title>
<style>
  body { background: #111; color: #eee; font-family: monospace; padding: 16px; }
  h2 { margin: 0 0 4px; }
  #meta { color: #888; margin-bottom: 12px; }
  #grid { display: inline-block; font-size: 18px; line-height: 1.2; }
  .row { white-space: pre; }
  .cell { display: inline-block; width: 1.4em; text-align: center; }
  .occupied { cursor: pointer; background: #234; border-radius: 3px; }
  .occupied:hover { background: #356; }
</style>
</head>
<body>
  <h2>World Map</h2>
  <div id="meta">loading...</div>
  <div id="grid"></div>
  <script>
    async function load() {
      const meta = document.getElementById("meta");
      const grid = document.getElementById("grid");
      const res = await fetch("/world/farms");
      const farms = await res.json();

      if (farms.length === 0) {
        meta.textContent = "No farms registered yet.";
        return;
      }

      meta.textContent = farms.length + " farm(s) — click a plot to open it";

      const byCoord = new Map(farms.map((f) => [f.worldX + "," + f.worldY, f]));
      const xs = farms.map((f) => f.worldX);
      const ys = farms.map((f) => f.worldY);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);

      for (let y = minY; y <= maxY; y++) {
        const row = document.createElement("div");
        row.className = "row";
        for (let x = minX; x <= maxX; x++) {
          const farm = byCoord.get(x + "," + y);
          const cell = document.createElement("span");
          cell.className = "cell" + (farm ? " occupied" : "");
          cell.textContent = farm ? (farm.name ? farm.name[0].toUpperCase() : "#") : ".";
          if (farm) {
            cell.title = (farm.name || "Unnamed farm") + " (" + farm.id + ")";
            cell.addEventListener("click", () => { window.location.href = "/farms/" + farm.id; });
          }
          row.appendChild(cell);
        }
        grid.appendChild(row);
      }
    }
    load();
  </script>
</body>
</html>`;
}
