import { Tile } from "@prisma/client";
import { cropSymbol, isCropType } from "./crops";

const DEBRIS_SYMBOLS: Record<string, string> = {
  NONE: ".",
  WEED: "W",
  ROCK: "R",
};

// "God mode" view of a farm: no avatar/position to render, just the tile
// grid as it stands.
export function renderFarmAscii(tiles: Tile[], width: number, height: number): string {
  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => "."));

  for (const tile of tiles) {
    let symbol = DEBRIS_SYMBOLS[tile.debris] ?? ".";
    if (tile.cropType && isCropType(tile.cropType)) {
      symbol = cropSymbol(tile.cropType, tile.cropStage);
    }
    grid[tile.y][tile.x] = symbol;
  }

  return grid.map((row) => row.join("")).join("\n");
}
