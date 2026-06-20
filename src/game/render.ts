import { Tile } from "@prisma/client";
import { cropColor, cropSymbol, isCropType } from "./crops";

export const DEBRIS_SYMBOLS: Record<string, string> = {
  NONE: ".",
  WEED: "W",
  ROCK: "R",
};

export const DEBRIS_COLORS: Record<string, string> = {
  NONE: "#4a3a28",
  WEED: "#5cb85c",
  ROCK: "#9e9e9e",
};

function tileSymbol(tile: Pick<Tile, "debris" | "cropType" | "cropStage">): string {
  if (tile.cropType && isCropType(tile.cropType)) return cropSymbol(tile.cropType, tile.cropStage);
  return DEBRIS_SYMBOLS[tile.debris] ?? ".";
}

function tileColor(tile: Pick<Tile, "debris" | "cropType" | "cropStage">): string {
  if (tile.cropType && isCropType(tile.cropType)) return cropColor(tile.cropType, tile.cropStage);
  return DEBRIS_COLORS[tile.debris] ?? DEBRIS_COLORS.NONE;
}

// "God mode" view of a farm: no avatar/position to render, just the tile
// grid as it stands. Plain text — used by the MCP inspect_farm tool and as
// the basis for any future plain-text consumer (e.g. a terminal visualizer).
export function renderFarmAscii(tiles: Tile[], width: number, height: number): string {
  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => "."));

  for (const tile of tiles) {
    grid[tile.y][tile.x] = tileSymbol(tile);
  }

  return grid.map((row) => row.join("")).join("\n");
}

// Same grid as renderFarmAscii, but each cell wrapped in a colored <span> —
// used by the web visualizer only (src/web/connections.ts).
export function renderFarmHtml(tiles: Tile[], width: number, height: number): string {
  const grid: { symbol: string; color: string }[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ symbol: ".", color: DEBRIS_COLORS.NONE }))
  );

  for (const tile of tiles) {
    grid[tile.y][tile.x] = { symbol: tileSymbol(tile), color: tileColor(tile) };
  }

  return grid
    .map((row) => row.map((cell) => `<span style="color:${cell.color}">${cell.symbol}</span>`).join(""))
    .join("\n");
}
