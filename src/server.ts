import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import { prisma } from "./db";
import { registerAgentRoutes } from "./routes/agents";
import { registerMcpRoute } from "./mcp/route";
import { registerViewerRoutes } from "./web/viewerRoute";
import { registerWorldRoutes } from "./web/worldRoute";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(websocketPlugin);

  app.get("/", async () => ({ status: "ok", game: "Agent Valley" }));

  registerAgentRoutes(app, prisma);
  registerMcpRoute(app, prisma);
  registerViewerRoutes(app, prisma);
  registerWorldRoutes(app, prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
