import { AgentCredentials } from "./credentials";

export interface AgentStatus {
  agentId: string;
  name: string | null;
  farmId: string;
}

export class AgentValleyClient {
  constructor(private readonly baseUrl: string) {}

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async register(name: string): Promise<AgentCredentials> {
    const res = await fetch(`${this.baseUrl}/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      throw new Error(`registration failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as AgentCredentials;
  }

  async me(creds: AgentCredentials): Promise<AgentStatus> {
    const res = await fetch(`${this.baseUrl}/agents/me`, {
      headers: { Authorization: `Bearer ${creds.agentId}.${creds.apiSecret}` },
    });
    if (!res.ok) {
      throw new Error(`/agents/me failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as AgentStatus;
  }
}
