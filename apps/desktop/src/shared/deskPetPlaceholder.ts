// The picture a bare install shows until any art is there (docs/desktop-modules.md §29): an original little round
// creature behind a desk, drawn here from circles and rounded rectangles, so no image file exists to ship.
import type { DeskPetPose } from "./deskPet";

export const DESK_PET_PLACEHOLDER_SIZE = 256;

type Colour = readonly [number, number, number];
const BODY: Colour = [244, 205, 148];
const LINE: Colour = [86, 62, 48];
const DESK: Colour = [150, 112, 84];
const CHEEK: Colour = [238, 150, 130];

/** Coverage (0..1) of a pixel by a rounded rectangle, from its signed distance. */
function rounded(px: number, py: number, x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  return Math.max(0, Math.min(1, 0.5 - d));
}
const circle = (px: number, py: number, cx: number, cy: number, r: number) => Math.max(0, Math.min(1, 0.5 - (Math.hypot(px - cx, py - cy) - r)));

function over(out: Uint8ClampedArray, at: number, colour: Colour, coverage: number): void {
  if (coverage <= 0) return;
  const below = out[at + 3]! / 255;
  const alpha = coverage + below * (1 - coverage);
  for (let c = 0; c < 3; c++) out[at + c] = (colour[c]! * coverage + out[at + c]! * below * (1 - coverage)) / alpha;
  out[at + 3] = alpha * 255;
}

/** RGBA, 256 × 256, straight alpha. `blink` draws only the closed eyes, transparent elsewhere. */
export function placeholderFrame(frame: DeskPetPose | "blink"): Uint8ClampedArray {
  const S = DESK_PET_PLACEHOLDER_SIZE;
  const out = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const at = (y * S + x) * 4;
      if (frame === "blink") {
        // Closed eyes over the open ones: a patch of the face, then the lid line.
        over(out, at, BODY, Math.max(circle(px, py, 101, 124, 11), circle(px, py, 155, 124, 11)));
        over(out, at, LINE, Math.max(rounded(px, py, 88, 122, 26, 5, 2.5), rounded(px, py, 142, 122, 26, 5, 2.5)));
        continue;
      }
      over(out, at, LINE, circle(px, py, 128, 132, 76));
      over(out, at, BODY, circle(px, py, 128, 132, 71));
      over(out, at, CHEEK, Math.max(circle(px, py, 84, 146, 11), circle(px, py, 172, 146, 11)) * 0.7);
      over(out, at, LINE, Math.max(circle(px, py, 101, 124, 9), circle(px, py, 155, 124, 9)));
      over(out, at, LINE, rounded(px, py, 118, 150, 20, 5, 2.5));
      over(out, at, LINE, rounded(px, py, 20, 196, 216, 48, 12));
      over(out, at, DESK, rounded(px, py, 25, 201, 206, 38, 8));
      // A hand up beside the head, or down on the desk (left / right as seen on screen).
      for (const [side, up] of [[-1, frame !== "right"], [1, frame !== "left"]] as const) {
        const cx = 128 + side * 86;
        const cy = up ? 96 : 188;
        over(out, at, LINE, circle(px, py, cx, cy, 22));
        over(out, at, BODY, circle(px, py, cx, cy, 18));
      }
    }
  }
  return out;
}
