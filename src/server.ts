import Fastify from "fastify";
import { prisma } from "./db";
import { registerAgentRoutes } from "./routes/agents";
import { registerMcpRoute } from "./mcp/route";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/", async () => ({ status: "ok", game: "Agent Valley" }));

  registerAgentRoutes(app, prisma);
  registerMcpRoute(app, prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
