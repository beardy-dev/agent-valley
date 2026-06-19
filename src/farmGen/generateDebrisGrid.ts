export type Debris = "NONE" | "WEED" | "ROCK";

const WEED_SEED_CHANCE = 0.06;
const ROCK_SEED_CHANCE = 0.04;
const WEED_CLUSTER_NEIGHBOR_THRESHOLD = 2;
const WEED_CLUSTER_CHANCE = 0.35;

// Deterministic PRNG (mulberry32) so a given seed always produces the same layout.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countNeighborsOf(grid: Debris[][], x: number, y: number, type: Debris): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const ny = y + dy;
      const nx = x + dx;
      if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[0].length) continue;
      if (grid[ny][nx] === type) count++;
    }
  }
  return count;
}

/**
 * Procedurally generates a width x height grid of debris (weeds and rocks)
 * scattered over otherwise empty dirt. Weeds form small organic patches via
 * a single clustering pass; rocks stay sparse and unclustered.
 */
export function generateDebrisGrid(width: number, height: number, seed = Date.now()): Debris[][] {
  const random = mulberry32(seed);

  const grid: Debris[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, (): Debris => "NONE")
  );

  // Pass 1: random scatter.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const roll = random();
      if (roll < WEED_SEED_CHANCE) {
        grid[y][x] = "WEED";
      } else if (roll < WEED_SEED_CHANCE + ROCK_SEED_CHANCE) {
        grid[y][x] = "ROCK";
      }
    }
  }

  // Pass 2: let weeds spread into nearby empty tiles to form patches.
  const grown = grid.map((row) => [...row]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] !== "NONE") continue;
      const weedNeighbors = countNeighborsOf(grid, x, y, "WEED");
      if (weedNeighbors >= WEED_CLUSTER_NEIGHBOR_THRESHOLD && random() < WEED_CLUSTER_CHANCE) {
        grown[y][x] = "WEED";
      }
    }
  }

  return grown;
}
