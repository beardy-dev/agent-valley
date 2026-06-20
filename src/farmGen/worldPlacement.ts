export interface WorldPosition {
  x: number;
  y: number;
}

// Places successive farms on an expanding square spiral centered on the
// origin, so each new agent's plot lands adjacent to existing ones on the
// shared world map instead of drifting off in a single direction forever.
export function spiralPosition(index: number): WorldPosition {
  let x = 0;
  let y = 0;
  let dx = 1;
  let dy = 0;
  let legLength = 1;
  let stepsInLeg = 0;
  let legsCompleted = 0;

  for (let i = 0; i < index; i++) {
    x += dx;
    y += dy;
    stepsInLeg++;
    if (stepsInLeg === legLength) {
      stepsInLeg = 0;
      [dx, dy] = [-dy, dx];
      legsCompleted++;
      if (legsCompleted % 2 === 0) legLength++;
    }
  }

  return { x, y };
}
