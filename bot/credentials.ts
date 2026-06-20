import fs from "node:fs";
import path from "node:path";

export interface AgentCredentials {
  agentId: string;
  apiSecret: string;
  farmId: string;
}

const DEFAULT_PATH = path.join(process.cwd(), ".agent-credentials.json");

export function loadCredentials(filePath = DEFAULT_PATH): AgentCredentials | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function saveCredentials(creds: AgentCredentials, filePath = DEFAULT_PATH): void {
  // mode only applies on file creation, so chmod explicitly afterward too —
  // this file holds a plaintext bearer credential and must not be
  // group/world-readable on a shared host.
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}
