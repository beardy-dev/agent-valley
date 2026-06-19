import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { generateApiSecret, hashApiSecret } from "../auth/apiSecret";
import { authenticate } from "../auth/authenticate";
import { createFarmWithTiles } from "../farmGen/createFarm";

interface RegisterBody {
  name?: string;
}

export function registerAgentRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post<{ Body: RegisterBody }>("/agents/register", async (request, reply) => {
    const name = request.body?.name;

    const { farm } = await createFarmWithTiles(prisma, name ? `${name}'s Farm` : "New Farm");
    const apiSecret = generateApiSecret();

    const agent = await prisma.agent.create({
      data: {
        name,
        apiSecretHash: hashApiSecret(apiSecret),
        farmId: farm.id,
      },
    });

    reply.code(201);
    return {
      agentId: agent.id,
      apiSecret,
      farmId: farm.id,
    };
  });

  app.get("/agents/me", { preHandler: authenticate(prisma) }, async (request) => {
    const agent = request.agent!;
    return { agentId: agent.id, name: agent.name, farmId: agent.farmId };
  });
}
