import { FastifyReply, FastifyRequest } from "fastify";
import { PrismaClient, Agent } from "@prisma/client";
import { verifyApiSecret } from "./apiSecret";

declare module "fastify" {
  interface FastifyRequest {
    agent?: Agent;
  }
}

/**
 * Expects `Authorization: Bearer <agentId>.<apiSecret>`. On success attaches
 * the authenticated Agent to the request; otherwise replies 401.
 */
export function authenticate(prisma: PrismaClient) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    const [agentId, secret] = token?.split(".") ?? [];

    if (!agentId || !secret) {
      return reply.code(401).send({ error: "missing or malformed Authorization header" });
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || !verifyApiSecret(secret, agent.apiSecretHash)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }

    request.agent = agent;
  };
}
