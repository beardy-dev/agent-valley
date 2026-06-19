import { Tile } from "@prisma/client";
import { cropSymbol, isCropType } from "./crops";

export interface Avatar {
  x: number;
  y: number;
}

const DEBRIS_SYMBOLS: Record<string, string> = {
  NONE: ".",
  WEED: "W",
  ROCK: "R",
};

export function renderFarmAscii(tiles: Tile[], width: number, height: number, avatar?: Avatar): string {
  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => "."));

  for (const tile of tiles) {
    let symbol = DEBRIS_SYMBOLS[tile.debris] ?? ".";
    if (tile.cropType && isCropType(tile.cropType)) {
      symbol = cropSymbol(tile.cropType, tile.cropStage);
    }
    grid[tile.y][tile.x] = symbol;
  }

  if (avatar) {
    grid[avatar.y][avatar.x] = "@";
  }

  return grid.map((row) => row.join("")).join("\n");
}
