import { buildServer } from "./server";
import { prisma } from "./db";
import { advanceTick } from "./game/tick";
import { migrateLegacySeedInventory } from "./game/legacyInventoryMigration";
import { broadcastAll } from "./web/connections";

const port = Number(process.env.PORT ?? 3000);
const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS ?? 900_000);

async function main() {
  await migrateLegacySeedInventory(prisma);
  const app = await buildServer();

  // Guards against overlapping ticks: if advanceTick + broadcastAll ever
  // takes longer than tickIntervalMs, the next scheduled tick is skipped
  // rather than running concurrently and double-incrementing crop stages.
  let tickInProgress = false;

  const tickHandle = setInterval(() => {
    if (tickInProgress) return;
    tickInProgress = true;

    advanceTick(prisma)
      .then(({ grown, wilted, fruited, affectedFarmIds }) => {
        if (grown > 0) app.log.info(`tick: ${grown} crop(s) advanced`);
        if (wilted > 0) app.log.info(`tick: ${wilted} crop(s) wilted`);
        if (fruited > 0) app.log.info(`tick: ${fruited} fruit(s) dropped`);
        return broadcastAll(prisma, affectedFarmIds);
      })
      .catch((err) => app.log.error(err, "tick failed"))
      .finally(() => {
        tickInProgress = false;
      });
  }, tickIntervalMs);

  async function shutdown() {
    clearInterval(tickHandle);
    await app.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
