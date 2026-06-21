// Single fixed repo — this app isn't multi-tenant, so there's no need for a
// configurable target.
const GITHUB_REPO = "beardy-dev/agent-valley";

// Best-effort: agent bug reports are always persisted to the BugReport table
// regardless of whether this succeeds (see report_bug in src/mcp/tools.ts).
// A missing GITHUB_TOKEN or a flaky GitHub API must never block an agent's
// report from being recorded, or break the report_bug tool call — failures
// are swallowed (logged to stderr) rather than thrown, same convention as
// EventLog's logEvent.
export async function createGithubIssue(title: string, body: string): Promise<{ url: string; number: number } | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN not set — skipping GitHub issue creation for bug report.");
    return null;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        // GitHub's REST API rejects requests with no User-Agent.
        "User-Agent": "agent-valley-bug-reporter",
      },
      body: JSON.stringify({ title, body, labels: ["agent-report"] }),
    });

    if (!response.ok) {
      console.error(`GitHub issue creation failed: ${response.status} ${await response.text()}`);
      return null;
    }

    const issue = (await response.json()) as { html_url: string; number: number };
    return { url: issue.html_url, number: issue.number };
  } catch (err) {
    console.error("GitHub issue creation failed:", err);
    return null;
  }
}
