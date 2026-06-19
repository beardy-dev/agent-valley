import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { registerAgentRoutes } from "./routes/agents";

export function buildServer() {
  const app = Fastify({ logger: true });
  const prisma = new PrismaClient();

  app.get("/", async () => ({ status: "ok", game: "Agent Valley" }));

  registerAgentRoutes(app, prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
