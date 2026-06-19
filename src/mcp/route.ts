import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticate } from "../auth/authenticate";
import { buildGameMcpServer } from "./tools";

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0" as const,
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

export function registerMcpRoute(app: FastifyInstance, prisma: PrismaClient) {
  const auth = authenticate(prisma);

  app.post("/mcp", { preHandler: auth }, async (request, reply) => {
    const agent = request.agent!;
    reply.hijack();

    const server = await buildGameMcpServer(prisma, agent);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      request.log.error(err);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "Content-Type": "application/json" });
        reply.raw.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
      }
    } finally {
      reply.raw.on("close", () => {
        transport.close();
        server.close();
      });
    }
  });

  app.get("/mcp", { preHandler: auth }, async (_request, reply) => {
    reply.code(405).send(METHOD_NOT_ALLOWED);
  });

  app.delete("/mcp", { preHandler: auth }, async (_request, reply) => {
    reply.code(405).send(METHOD_NOT_ALLOWED);
  });
}
