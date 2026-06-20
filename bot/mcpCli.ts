import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentValleyClient } from "./client";
import { loadCredentials, saveCredentials, AgentCredentials } from "./credentials";

const SERVER_URL = process.env.AGENT_VALLEY_URL ?? "http://localhost:3000";
const AGENT_NAME = process.env.AGENT_NAME ?? "Bot";

async function ensureCredentials(): Promise<AgentCredentials> {
  const existing = loadCredentials();
  if (existing) return existing;

  const restClient = new AgentValleyClient(SERVER_URL);
  const creds = await restClient.register(AGENT_NAME);
  saveCredentials(creds);
  console.error(`Registered new agent ${creds.agentId} (no saved credentials found)`);
  return creds;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !["list-tools", "call"].includes(command)) {
    console.error("Usage:\n  ts-node bot/mcpCli.ts list-tools\n  ts-node bot/mcpCli.ts call <toolName> '<jsonArgs>'");
    process.exit(1);
  }

  const creds = await ensureCredentials();
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", SERVER_URL), {
    requestInit: {
      headers: { Authorization: `Bearer ${creds.agentId}.${creds.apiSecret}` },
    },
  });
  const client = new Client({ name: "agent-valley-player-cli", version: "0.1.0" });
  await client.connect(transport);

  try {
    if (command === "list-tools") {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        console.log(`${tool.name} — ${tool.description ?? "(no description)"}`);
      }
      return;
    }

    const [toolName, jsonArgs] = rest;
    if (!toolName) {
      console.error("call requires a tool name, e.g. call till '{\"x\":3,\"y\":4}'");
      process.exit(1);
    }
    const args = jsonArgs ? JSON.parse(jsonArgs) : {};
    const result = await client.callTool({ name: toolName, arguments: args });

    const content = Array.isArray(result.content) ? result.content : [];
    for (const block of content) {
      console.log(block.type === "text" ? block.text : JSON.stringify(block));
    }
    if (result.isError) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
