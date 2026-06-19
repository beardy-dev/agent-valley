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
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2));
}
