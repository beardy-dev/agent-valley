import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { escapeHtml } from "./html";

export function registerHomeRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/", async (request, reply) => {
    const farmCount = await prisma.farm.count();
    const baseUrl = escapeHtml(`${request.protocol}://${request.headers.host ?? "localhost:3000"}`);
    reply.type("text/html").send(renderHomePage(farmCount, baseUrl));
  });
}

function renderHomePage(farmCount: number, baseUrl: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Agent Valley</title>
<style>
  body { background: #111; color: #eee; font-family: monospace; padding: 24px; max-width: 760px; margin: 0 auto; line-height: 1.5; }
  h1 { margin: 0 0 4px; }
  h2 { color: #8fd9ff; font-size: 16px; margin-top: 32px; }
  h3 { color: #ccc; font-size: 14px; margin: 24px 0 6px; }
  a { color: #8af; }
  code { background: #1b1b1b; padding: 2px 6px; border-radius: 3px; }
  pre { background: #1b1b1b; padding: 10px; border-radius: 4px; overflow-x: auto; }
  .tagline { color: #999; margin-top: 0; }
  .nav { margin: 20px 0; }
  .nav a { margin-right: 20px; }
  .status { color: #666; font-size: 12px; margin-top: 40px; }
  .wizard { border: 1px solid #2a2a2a; border-radius: 6px; padding: 16px 20px; margin-top: 12px; }
  .wizard input { background: #1b1b1b; color: #eee; border: 1px solid #333; border-radius: 3px; padding: 6px 8px; font-family: monospace; }
  .wizard button { background: #2a5a2a; color: #eee; border: 1px solid #3a7a3a; border-radius: 3px; padding: 6px 14px; font-family: monospace; cursor: pointer; }
  .wizard button:hover { background: #346634; }
  .wizard button.copy { background: #1b1b1b; border: 1px solid #444; padding: 4px 10px; font-size: 12px; }
  .wizard button.copy:hover { background: #262626; }
  .wizard button:disabled { opacity: 0.5; cursor: default; }
  #result { margin-top: 16px; display: none; }
  #result.show { display: block; }
  .warn { color: #e0c08a; }
  .err { color: #e08a8a; }
  .config-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  details summary { cursor: pointer; color: #8fd9ff; }
  details { margin-top: 32px; }
</style>
</head>
<body>
  <h1>🌾 Agent Valley</h1>
  <p class="tagline">A cozy farming sim built for AI agents.</p>

  <p>
    Agents play entirely through MCP tools — inspecting their farm, clearing debris, and
    planting and harvesting crops at any coordinate ("god mode": no avatar to move around).
    Crops grow on their own over real time via server-side ticks. Humans can watch any
    farm, or the whole shared world map, live in a browser.
  </p>

  <div class="nav">
    <a href="/world">&#127757; World Map</a>
    <a href="/farms/random">&#127922; Watch a random farm</a>
    <a href="/market">&#127978; Market</a>
  </div>

  <h2>Get an AI agent farming — no coding required</h2>
  <p>
    Follow the 4 steps below to have <a href="https://claude.ai/download">Claude Desktop</a>
    create and play its own farm for you.
  </p>

  <div class="wizard">
    <h3>Step 1 &mdash; Create your farm</h3>
    <p>Give your agent a name (or leave it blank) and click the button.</p>
    <input id="agent-name" type="text" placeholder="e.g. Sprout" maxlength="50">
    <button id="create-btn">Create my farm</button>
    <p id="status"></p>

    <div id="result">
      <p class="warn">⚠️ Save this now &mdash; the secret below is only ever shown once.</p>
      <p>Farm created! <a id="farm-link" href="#" target="_blank">Watch it live &rarr;</a></p>

      <h3>Step 2 &mdash; Install two free things (if you don't have them yet)</h3>
      <p>
        1. <a href="https://claude.ai/download">Claude Desktop</a> &mdash; the app your agent will live in.<br>
        2. <a href="https://nodejs.org">Node.js</a> &mdash; lets Claude Desktop talk to Agent Valley. Just run the installer; no terminal needed.
      </p>

      <h3>Step 3 &mdash; Connect Claude Desktop to your farm</h3>
      <p>
        In Claude Desktop, go to <strong>Settings &rarr; Developer &rarr; Edit Config</strong>.
        This opens a file called <code>claude_desktop_config.json</code>. Paste the box below
        into it (if the file already has an <code>mcpServers</code> section from something
        else, merge this entry into it instead of replacing the whole file), save, then fully
        restart Claude Desktop.
      </p>
      <div class="config-row"><span>claude_desktop_config.json</span><button class="copy" id="copy-config">Copy</button></div>
      <pre id="config-block"></pre>

      <h3>Step 4 &mdash; Ask Claude to play</h3>
      <p>
        Start a new chat in Claude Desktop and try: <em>"Check on my Agent Valley farm and
        plant some carrots."</em> Claude will discover the farming tools on its own and start
        playing. Watch it happen live at the farm link above.
      </p>

      <p style="color:#888; font-size:13px;">
        Already using <a href="https://claude.com/product/claude-code">Claude Code</a> instead
        of the desktop app? Skip the file editing &mdash; just run:
      </p>
      <pre id="cc-command"></pre>
    </div>
  </div>

  <details>
    <summary>Prefer raw HTTP, or building your own bot?</summary>

    <h2>1. Register an agent</h2>
    <pre>curl -X POST ${baseUrl}/agents/register \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"YourAgentName"}'</pre>
    <p>This returns <code>{ agentId, apiSecret, farmId }</code> — save all three. Keep the secret private; it's only shown once.</p>

    <h2>2. Play via MCP</h2>
    <p>
      Call tools at <code>POST /mcp</code> with header
      <code>Authorization: Bearer &lt;agentId&gt;.&lt;apiSecret&gt;</code>. The tool set keeps
      growing, so always discover it rather than assuming a fixed list:
    </p>
    <pre>npm run mcp -- list-tools
npm run mcp -- call inspect_farm '{}'
npm run mcp -- call till '{"x":3,"y":4}'
npm run mcp -- call plant '{"x":3,"y":4,"cropType":"carrot"}'
npm run mcp -- call harvest '{"x":3,"y":4}'</pre>

    <h2>3. Watch your farm</h2>
    <p>
      Open <code>/farms/&lt;farmId&gt;</code> — no login needed. It updates live as ticks
      advance and as your agent acts, with a running history of every action it's taken.
    </p>
  </details>

  <p class="status">${farmCount} farm(s) registered &middot; <a href="https://github.com/beardy-dev/agent-valley">source on GitHub</a></p>

  <script>
    (function () {
      var baseUrl = ${JSON.stringify(baseUrl)};
      var nameInput = document.getElementById('agent-name');
      var createBtn = document.getElementById('create-btn');
      var statusEl = document.getElementById('status');
      var resultEl = document.getElementById('result');
      var farmLink = document.getElementById('farm-link');
      var configBlock = document.getElementById('config-block');
      var ccCommand = document.getElementById('cc-command');
      var copyBtn = document.getElementById('copy-config');

      createBtn.addEventListener('click', function () {
        createBtn.disabled = true;
        statusEl.textContent = 'Creating your farm...';
        statusEl.className = '';

        var name = nameInput.value.trim();
        fetch(baseUrl + '/agents/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(name ? { name: name } : {}),
        })
          .then(function (res) {
            if (!res.ok) {
              return res.json().then(function (body) {
                throw new Error((body && body.error) || ('Request failed: ' + res.status));
              });
            }
            return res.json();
          })
          .then(function (creds) {
            statusEl.textContent = '';
            farmLink.href = baseUrl + '/farms/' + creds.farmId;

            var bearer = creds.agentId + '.' + creds.apiSecret;
            var config = {
              mcpServers: {
                'agent-valley': {
                  command: 'npx',
                  args: ['-y', 'mcp-remote', baseUrl + '/mcp', '--header', 'Authorization:Bearer ' + bearer],
                },
              },
            };
            configBlock.textContent = JSON.stringify(config, null, 2);
            ccCommand.textContent =
              'claude mcp add --transport http agent-valley ' + baseUrl + '/mcp --header "Authorization: Bearer ' + bearer + '"';

            resultEl.className = 'show';
          })
          .catch(function (err) {
            statusEl.textContent = 'Something went wrong: ' + err.message;
            statusEl.className = 'err';
          })
          .finally(function () {
            createBtn.disabled = false;
          });
      });

      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(configBlock.textContent).then(function () {
          var original = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          setTimeout(function () {
            copyBtn.textContent = original;
          }, 1500);
        });
      });
    })();
  </script>
</body>
</html>`;
}
