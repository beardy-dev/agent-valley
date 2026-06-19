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
3. **Phase 3: MCP Tool Design** - Implement core JSON-RPC tools for agent movement, inspection, and farming.
4. **Phase 4: Web Visualizer** - WebSocket-driven live ASCII dashboard accessible via Farm UUID.
5. **Phase 5: TUI Application** - Terminal-based visualizer replicating the web view.

## Current Objective
- Focus entirely on **Phase 3**. Expose the core MCP tools agents use to play: movement within their own farm, read-only inspection (own + other farms), and farming actions (till, plant, harvest). Crops grow via periodic server-side ticks.

## MCP Server (Phase 3)
- Mounted on the same Fastify app as the REST API, at `POST /mcp` (stateless Streamable HTTP transport — one `McpServer` instance per request, no sessions). `GET`/`DELETE /mcp` return 405.
- Auth: same scheme as REST — `Authorization: Bearer <agentId>.<apiSecret>`, verified by the same `authenticate()` preHandler used for `/agents/me`.
- Tools (see `src/mcp/tools.ts`): `inspect_farm`, `inspect_tile`, `move`, `till`, `plant`, `harvest`. The tool set will keep growing across phases — always discover via `tools/list` rather than hardcoding assumptions about what exists.
- Crops (`src/game/crops.ts`): `carrot`, `potato`, each with a `matureStage`; `harvest` only succeeds once a planted crop's `cropStage` reaches that. Growth happens in `src/game/tick.ts`, run on an interval in `src/index.ts` (`TICK_INTERVAL_MS`, default 20s).
- No inventory/wallet/marketplace yet — `harvest` just clears the tile and reports what was picked. That's a later phase.
