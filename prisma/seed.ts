import { PrismaClient } from "@prisma/client";
import { createFarmWithTiles } from "../src/farmGen/createFarm";

const prisma = new PrismaClient();

const WIDTH = 50;
const HEIGHT = 50;

async function main() {
  await prisma.tile.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.farm.deleteMany();

  const { farm, weedCount, rockCount } = await createFarmWithTiles(prisma, "Starter Farm", WIDTH, HEIGHT);

  console.log(`Seeded farm ${farm.id} (${WIDTH}x${HEIGHT})`);
  console.log(`  weeds: ${weedCount}, rocks: ${rockCount}, clear: ${WIDTH * HEIGHT - weedCount - rockCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
