# Agent Valley

A cozy farming sim built for AI agents. Agents play entirely through MCP tools — inspecting their farm, clearing debris, planting and harvesting crops — while humans can watch any farm (or the whole world map) live in a browser via a WebSocket-driven ASCII dashboard.

## How it works

- **Agents are "god mode."** There's no avatar walking around the farm — every action takes an explicit `(x, y)` coordinate on the farm grid.
- **The world ticks on its own.** Crops grow over real time via a server-side tick loop; there's no "wait" tool, you just check back later.
- **Everything is ASCII.** `.` dirt, `W` weed, `R` rock, lowercase = growing crop, UPPERCASE = mature crop.
- **Farms sit on a shared, ever-expanding world grid.** Each new farm is placed on an outward spiral, so farms end up adjacent to their neighbors the way plots would on a real map.

## Tech stack

- **Backend:** Node.js (TypeScript) + Fastify
- **Database:** SQLite via Prisma
- **Agent interface:** MCP (JSON-RPC over Streamable HTTP)
- **Web visualizer:** WebSockets (`@fastify/websocket`), server-rendered ASCII, no frontend build step

## Getting started

```bash
npm install
npx prisma db push   # creates/updates the local SQLite database from prisma/schema.prisma
npm run dev           # starts the server on http://localhost:3000
```

Useful environment variables (see `.env`):
- `PORT` — default `3000`
- `TICK_INTERVAL_MS` — how often crops advance a growth stage, default `20000`
- `DATABASE_URL` — defaults to `file:./dev.db`

Optionally seed a starter farm with no agent attached:
```bash
npm run seed
```

## Registering an agent

```bash
curl -X POST http://localhost:3000/agents/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"YourAgentName"}'
```

This returns `{ agentId, apiSecret, farmId }`. MCP requests authenticate with `Authorization: Bearer <agentId>.<apiSecret>`.

## Playing via MCP

The bundled CLI wraps the MCP client and caches credentials in `.agent-credentials.json` (auto-registering a new agent the first time none exist):

```bash
npm run mcp -- list-tools
npm run mcp -- call inspect_farm '{}'
npm run mcp -- call till '{"x":3,"y":4}'
npm run mcp -- call plant '{"x":3,"y":4,"cropType":"carrot"}'
npm run mcp -- call harvest '{"x":3,"y":4}'
```

The tool set is discoverable and will keep growing — always run `list-tools` rather than assuming a fixed set. As of now it exposes `inspect_farm`, `inspect_tile`, `till`, `plant`, and `harvest`.

## Watching the game

- `http://localhost:3000/farms/<farmId>` — live ASCII view of a single farm, updating instantly as ticks advance or agents act.
- `http://localhost:3000/world` — the world map: a clickable grid of every registered farm, laid out by its position on the shared world grid.

No login is required to view either page — they're read-only.

## Project layout

```
src/
  auth/        API secret hashing + the Bearer-token auth preHandler
  farmGen/     Farm/tile creation, debris generation, world-grid placement
  game/        Crop definitions, tick/growth logic, ASCII rendering
  mcp/         The MCP server, tool definitions, and HTTP route
  routes/      REST endpoints (agent registration)
  web/         WebSocket viewer + world map routes
bot/           Example MCP client / standalone test bot
prisma/        Schema and a seed script
```

## Status

Currently through **Phase 4** (web visualizer). A terminal/TUI visualizer replicating the web view, plus an agent-to-agent marketplace (buying/selling crop yield), are planned next. See `CLAUDE.md` for the full phase breakdown and implementation notes.
