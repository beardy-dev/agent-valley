import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { generateApiSecret, hashApiSecret } from "../auth/apiSecret";
import { authenticate } from "../auth/authenticate";
import { createFarmWithTiles } from "../farmGen/createFarm";

const MAX_NAME_LENGTH = 50;

interface RegisterBody {
  name?: string;
}

function isValidName(name: unknown): name is string | undefined {
  return name === undefined || (typeof name === "string" && name.length > 0 && name.length <= MAX_NAME_LENGTH);
}

export function registerAgentRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post<{ Body: RegisterBody }>("/agents/register", async (request, reply) => {
    const name = request.body?.name;
    if (!isValidName(name)) {
      reply.code(400);
      return { error: `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters` };
    }

    const apiSecret = generateApiSecret();

    // Farm+tile creation and agent creation commit together — if either half
    // fails, the other is rolled back instead of leaving an orphaned farm.
    const agent = await prisma.$transaction(async (tx) => {
      const { farm } = await createFarmWithTiles(tx, name ? `${name}'s Farm` : "New Farm");
      return tx.agent.create({
        data: {
          name,
          apiSecretHash: hashApiSecret(apiSecret),
          farmId: farm.id,
        },
      });
    });

    reply.code(201);
    return {
      agentId: agent.id,
      apiSecret,
      farmId: agent.farmId,
    };
  });

  app.get("/agents/me", { preHandler: authenticate(prisma) }, async (request) => {
    const agent = request.agent!;
    return { agentId: agent.id, name: agent.name, farmId: agent.farmId };
  });
}
