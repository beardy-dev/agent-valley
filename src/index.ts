import { buildServer } from "./server";
import { prisma } from "./db";
import { advanceTick } from "./game/tick";
import { broadcastAll } from "./web/connections";

const port = Number(process.env.PORT ?? 3000);
const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS ?? 20_000);

const app = buildServer();

const tickHandle = setInterval(() => {
  advanceTick(prisma)
    .then(({ grown }) => {
      if (grown > 0) app.log.info(`tick: ${grown} crop(s) advanced`);
      return broadcastAll(prisma);
    })
    .catch((err) => app.log.error(err, "tick failed"));
}, tickIntervalMs);

app
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

async function shutdown() {
  clearInterval(tickHandle);
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
