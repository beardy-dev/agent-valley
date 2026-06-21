import { Tile } from "@prisma/client";
import { cropColor, cropSymbol, isCropType } from "./crops";
import { isTreeType, treeColor, treeSymbol, TREES } from "./trees";

export const DEBRIS_SYMBOLS: Record<string, string> = {
  NONE: ".",
  WEED: "W",
  ROCK: "R",
  // A mature crop (or dropped fruit, see trees.ts) left unharvested too
  // long dies and leaves this behind, same as any other debris — must be
  // tilled before the tile can be replanted (or, for a tree's footprint,
  // before it goes back to rendering BLOCKED_SYMBOL).
  WILTED: "x",
};

export const DEBRIS_COLORS: Record<string, string> = {
  NONE: "#4a3a28",
  WEED: "#5cb85c",
  ROCK: "#9e9e9e",
  WILTED: "#8b3a3a",
};

// One of a tree's 8 permanently-reserved footprint tiles, currently empty
// (no fruit ripening/dead on it) — see blockedByTree in schema.prisma.
export const BLOCKED_SYMBOL = "#";
export const BLOCKED_COLOR = "#4a4a4a";

type TileLike = Pick<Tile, "debris" | "cropType" | "cropStage" | "treeType" | "fruitType" | "blockedByTree">;

// Priority order matters: a tree's own tile always shows the tree; a
// footprint tile shows its fruit (ripe or, once WILTED, the same dead
// marker every other expired plant gets) ahead of the "just blocked,
// nothing here" fallback.
function tileSymbol(tile: TileLike): string {
  if (tile.treeType && isTreeType(tile.treeType)) return treeSymbol(tile.treeType, tile.cropStage);
  if (tile.fruitType && isTreeType(tile.fruitType) && tile.debris !== "WILTED") return TREES[tile.fruitType].fruitSymbol;
  if (tile.debris === "WILTED") return DEBRIS_SYMBOLS.WILTED;
  if (tile.cropType && isCropType(tile.cropType)) return cropSymbol(tile.cropType, tile.cropStage);
  if (tile.blockedByTree) return BLOCKED_SYMBOL;
  return DEBRIS_SYMBOLS[tile.debris] ?? ".";
}

function tileColor(tile: TileLike): string {
  if (tile.treeType && isTreeType(tile.treeType)) return treeColor(tile.treeType, tile.cropStage);
  if (tile.fruitType && isTreeType(tile.fruitType) && tile.debris !== "WILTED") return TREES[tile.fruitType].fruitColor;
  if (tile.debris === "WILTED") return DEBRIS_COLORS.WILTED;
  if (tile.cropType && isCropType(tile.cropType)) return cropColor(tile.cropType, tile.cropStage);
  if (tile.blockedByTree) return BLOCKED_COLOR;
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
