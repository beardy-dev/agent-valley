# CLAUDE.md - Agent Valley: A Cozy Farming Sim for AI Agents

## Idea
Agent Valley is a cozy farming simulator for AI Agents. Agents can grow manage their farm, grow crops, and sell their yield to other agents, as well as buy from other agents.

## Core Rules & Conventions
- The agent interacts with Agent Valley via MCP, getting information about their farm plot, performing actions, and overall playing the game.
- Agent Valley can be viewed by humans, who can see their agent's farm represented by ASCII characters. Humans can also view the plots of other agents, as well as activity taking place on the agent marketplace
- Game state progresses via periodic "ticks"
- Everything is represented via ASCII characters, i.e. `.` for empty dirt, `W` for weeds, etc. You can decide which characters to use for the various crops and terrain.
- All agent plots should be laid out on an ever expanding world grid. Depending on the location of the agent plot, they may have plots managed by other agents on all four sides when viewing from the "world map".

## Tech Stack
- **Backend:** Node.js (TypeScript) + Fastify (or Express)
- **Database:** SQLite (via Prisma) for quick local development
- **Communication:** MCP (JSON-RPC over Server-Sent Events / WebSockets)
- **Visuals:** Monospace ASCII layout

## Game Phases
1. **Phase 1: Grid Engine & DB** - 50x50 multi-layer grid generation. Save/Load via Farm UUID.
2. **Phase 2: Agent Registration & Auth** - Expose registration endpoints returning UUID + API Secret.
3. **Phase 3: MCP Tool Design** - Implement core JSON-RPC tools for farm inspection and farming actions. "God mode" interaction model: agents have no on-farm position/avatar — every tile-level tool takes an explicit (x, y) coordinate instead of moving around.
4. **Phase 4: Web Visualizer** - WebSocket-driven live ASCII dashboard accessible via Farm UUID.
5. **Phase 5: TUI Application** - Terminal-based visualizer replicating the web view.

## Current Objective
- Focus entirely on **Phase 4**. Build the web visualizer: a WebSocket-driven live ASCII dashboard for any farm, addressable by Farm UUID, viewable by humans (no agent auth required — read-only). It should re-render whenever the farm's state changes (server tick advances crop growth, or an agent acts via MCP tools).

## MCP Server (Phase 3)
- Mounted on the same Fastify app as the REST API, at `POST /mcp` (stateless Streamable HTTP transport — one `McpServer` instance per request, no sessions). `GET`/`DELETE /mcp` return 405.
- Auth: same scheme as REST — `Authorization: Bearer <agentId>.<apiSecret>`, verified by the same `authenticate()` preHandler used for `/agents/me`.
- Tools (see `src/mcp/tools.ts`): `inspect_farm`, `inspect_tile`, `till`, `plant`, `harvest`. The tool set will keep growing across phases — always discover via `tools/list` rather than hardcoding assumptions about what exists.
- **No avatar/position.** Agents have "god mode" visibility over their whole farm (`inspect_farm` shows the full grid at once) and act on any tile directly by passing `x`/`y` coordinates to `inspect_tile`/`till`/`plant`/`harvest` — there's no `move` tool and no `@` marker anywhere. Coordinates are bounds-checked against the farm's actual `width`/`height` via zod (`xSchema`/`ySchema` in `buildGameMcpServer`).
- Crops (`src/game/crops.ts`): `carrot`, `potato`, each with a `matureStage`; `harvest` only succeeds once a planted crop's `cropStage` reaches that. Growth happens in `src/game/tick.ts`, run on an interval in `src/index.ts` (`TICK_INTERVAL_MS`, default 20s).
- No inventory/wallet/marketplace yet — `harvest` just clears the tile and reports what was picked. That's a later phase.
- `till`/`plant`/`harvest` each wrap their read-then-write in `prisma.$transaction` so two concurrent calls targeting the same (x, y) can't both pass their precondition check and clobber each other. Broadcasting to web viewers is centralized via the `withBroadcast` wrapper in `src/mcp/tools.ts` rather than each tool remembering to call it.

## World Grid Placement
- `Farm` has `worldX`/`worldY` (`@@unique([worldX, worldY])`) placing it on the shared world grid described in the Core Rules. New farms get the next slot from `spiralPosition()` in `src/farmGen/worldPlacement.ts` — a deterministic expanding square spiral centered on the origin, computed from `prisma.farm.count()` inside the same transaction that creates the farm (so placement and creation commit atomically). There's no "view the world map" or adjacency-lookup endpoint yet — that's still a later phase — but the underlying coordinates now exist so it can be built without a schema migration.

## Web Visualizer (Phase 4)
- `GET /farms/:farmId` serves a small standalone HTML page (no build step, inline `<script>`) that opens a WebSocket and renders the farm's ASCII grid in a `<pre>`. No auth — read-only, public by Farm UUID, same legend as the MCP `inspect_farm` tool. No avatar marker — the grid is purely tiles (god-mode model, see Phase 3 notes).
- `GET /farms/:farmId/ws` is the WebSocket endpoint (`src/web/viewerRoute.ts`, via `@fastify/websocket`). Sends a full re-render (`{ farmId, width, height, ascii, updatedAt }`) on connect and again whenever the farm's state changes — no diffing, the whole grid is cheap enough to resend.
- `src/web/connections.ts` tracks live viewers per `farmId` in memory and exposes `broadcast(prisma, farmId)` (push to one farm's viewers) and `broadcastAll(prisma)` (push to every farm with at least one viewer). Both are no-ops if nobody's watching.
- Two triggers call these: the tick loop in `src/index.ts` calls `broadcastAll` after every `advanceTick`, and each mutating MCP tool (`till`, `plant`, `harvest` in `src/mcp/tools.ts`) calls `broadcast` for its own farm right after the DB write, so the dashboard reacts instantly to agent actions rather than waiting for the next tick.
- Gotcha worth remembering: a `{ websocket: true }` route only gets upgraded correctly if it's registered inside a nested `app.register(async (instance) => { ... })` scope — registering it directly on the root Fastify instance silently falls back to a normal HTTP handler (the client sees "Unexpected server response: 200" instead of a 101 upgrade). `registerViewerRoutes` wraps the `/ws` route this way; keep that pattern for any future websocket routes.
