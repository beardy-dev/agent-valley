import { AgentValleyClient } from "./client";
import { loadCredentials, saveCredentials, AgentCredentials } from "./credentials";

const SERVER_URL = process.env.AGENT_VALLEY_URL ?? "http://localhost:3000";
const AGENT_NAME = process.env.AGENT_NAME ?? "Bot";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 10_000);

const client = new AgentValleyClient(SERVER_URL);

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(): Promise<void> {
  log(`Waiting for Agent Valley server at ${SERVER_URL} ...`);
  while (!(await client.checkHealth())) {
    await sleep(2_000);
  }
  log("Server is up.");
}

async function ensureRegistered(): Promise<AgentCredentials> {
  const existing = loadCredentials();
  if (existing) {
    log(`Loaded saved credentials for agent ${existing.agentId}`);
    return existing;
  }

  log(`No saved credentials found, registering new agent "${AGENT_NAME}"...`);
  const creds = await client.register(AGENT_NAME);
  saveCredentials(creds);
  log(`Registered agent ${creds.agentId} with farm ${creds.farmId}`);
  return creds;
}

let running = true;
process.on("SIGINT", () => {
  log("Shutting down...");
  running = false;
});

async function main(): Promise<void> {
  await waitForServer();
  const creds = await ensureRegistered();

  // Until Phase 3 lands real MCP farming tools, this loop just proves the
  // bot can stay authenticated against the server over time. Add real
  // actions (move/till/plant/sell) here as those endpoints/tools appear.
  while (running) {
    try {
      const status = await client.me(creds);
      log(`heartbeat ok — agent=${status.agentId} farm=${status.farmId}`);
    } catch (err) {
      log(`heartbeat failed: ${(err as Error).message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
