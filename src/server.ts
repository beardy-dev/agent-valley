import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import { prisma } from "./db";
import { registerAgentRoutes } from "./routes/agents";
import { registerMcpRoute } from "./mcp/route";
import { registerViewerRoutes } from "./web/viewerRoute";
import { registerWorldRoutes } from "./web/worldRoute";
import { registerHomeRoutes } from "./web/homeRoute";
import { registerMarketRoutes } from "./web/marketRoute";

export async function buildServer() {
  const app = Fastify({ logger: true, trustProxy: true });

  await app.register(websocketPlugin);
  // Global per-IP default; routes that need a tighter bound (e.g.
  // /agents/register) override it via their own `config.rateLimit`. Must be
  // awaited before any routes are added — @fastify/rate-limit's onRequest
  // hook silently doesn't apply to routes added before the plugin actually
  // finishes registering.
  await app.register(rateLimit, { global: true, max: 100, timeWindow: "1 minute" });

  registerHomeRoutes(app, prisma);
  registerAgentRoutes(app, prisma);
  registerMcpRoute(app, prisma);
  registerViewerRoutes(app, prisma);
  registerWorldRoutes(app, prisma);
  registerMarketRoutes(app, prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
