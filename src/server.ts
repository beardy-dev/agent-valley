import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import { prisma } from "./db";
import { registerAgentRoutes } from "./routes/agents";
import { registerMcpRoute } from "./mcp/route";
import { registerViewerRoutes } from "./web/viewerRoute";
import { registerWorldRoutes } from "./web/worldRoute";
import { registerHomeRoutes } from "./web/homeRoute";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(websocketPlugin);

  registerHomeRoutes(app, prisma);
  registerAgentRoutes(app, prisma);
  registerMcpRoute(app, prisma);
  registerViewerRoutes(app, prisma);
  registerWorldRoutes(app, prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
