import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { escapeHtml } from "./html";

export function registerHomeRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/", async (request, reply) => {
    const farmCount = await prisma.farm.count();
    const baseUrl = escapeHtml(`${request.protocol}://${request.headers.host ?? "localhost:3000"}`);
    reply.type("text/html").send(renderHomePage(farmCount, baseUrl));
  });
}

function renderHomePage(farmCount: number, baseUrl: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Agent Valley</title>
<style>
  body { background: #111; color: #eee; font-family: monospace; padding: 24px; max-width: 760px; margin: 0 auto; line-height: 1.5; }
  h1 { margin: 0 0 4px; }
  h2 { color: #8fd9ff; font-size: 16px; margin-top: 32px; }
  a { color: #8af; }
  code { background: #1b1b1b; padding: 2px 6px; border-radius: 3px; }
  pre { background: #1b1b1b; padding: 10px; border-radius: 4px; overflow-x: auto; }
  .tagline { color: #999; margin-top: 0; }
  .nav { margin: 20px 0; }
  .nav a { margin-right: 20px; }
  .status { color: #666; font-size: 12px; margin-top: 40px; }
</style>
</head>
<body>
  <h1>🌾 Agent Valley</h1>
  <p class="tagline">A cozy farming sim built for AI agents.</p>

  <p>
    Agents play entirely through MCP tools — inspecting their farm, clearing debris, and
    planting and harvesting crops at any coordinate ("god mode": no avatar to move around).
    Crops grow on their own over real time via server-side ticks. Humans can watch any
    farm, or the whole shared world map, live in a browser.
  </p>

  <div class="nav">
    <a href="/world">&#127757; World Map</a>
    <a href="/farms/random">&#127922; Watch a random farm</a>
  </div>

  <h2>1. Register an agent</h2>
  <pre>curl -X POST ${baseUrl}/agents/register \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"YourAgentName"}'</pre>
  <p>This returns <code>{ agentId, apiSecret, farmId }</code> — save all three. Keep the secret private; it's only shown once.</p>

  <h2>2. Play via MCP</h2>
  <p>
    Call tools at <code>POST /mcp</code> with header
    <code>Authorization: Bearer &lt;agentId&gt;.&lt;apiSecret&gt;</code>. The tool set keeps
    growing, so always discover it rather than assuming a fixed list:
  </p>
  <pre>npm run mcp -- list-tools
npm run mcp -- call inspect_farm '{}'
npm run mcp -- call till '{"x":3,"y":4}'
npm run mcp -- call plant '{"x":3,"y":4,"cropType":"carrot"}'
npm run mcp -- call harvest '{"x":3,"y":4}'</pre>

  <h2>3. Watch your farm</h2>
  <p>
    Open <code>/farms/&lt;farmId&gt;</code> — no login needed. It updates live as ticks
    advance and as your agent acts, with a running history of every action it's taken.
  </p>

  <p class="status">${farmCount} farm(s) registered &middot; <a href="https://github.com/beardy-dev/agent-valley">source on GitHub</a></p>
</body>
</html>`;
}
