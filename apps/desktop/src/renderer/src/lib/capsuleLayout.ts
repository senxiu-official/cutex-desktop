// Where the status capsule sits: a corner, against the window edge or the text column's edge. Collapsed
// and open share the corner — the panel grows away from it (down from a top corner, up from a bottom
// one), so expanding never moves the capsule.

export type CapsuleCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
export type CapsuleEdge = "window" | "content";

export const CAPSULE_CORNERS: readonly CapsuleCorner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
export const DEFAULT_CAPSULE_CORNER: CapsuleCorner = "topRight";
export const DEFAULT_CAPSULE_EDGE: CapsuleEdge = "window";

export const isTop = (c: CapsuleCorner) => c === "topLeft" || c === "topRight";
export const isLeft = (c: CapsuleCorner) => c === "topLeft" || c === "bottomLeft";


/** The old single `capsuleAnchor` pref → corner + edge. "windowBottom" was the old default, which every
 *  saved prefs object carried whether chosen or not, so it maps to the new default. */
export function migrateCapsuleAnchor(anchor: unknown): { corner: CapsuleCorner; edge: CapsuleEdge } | null {
  switch (anchor) {
    case "windowBottom":
    case "windowMiddle":
    case "window":
      return { corner: "topRight", edge: "window" };
    case "composer":
      return { corner: "bottomRight", edge: "content" };
    case "content":
      return { corner: "topRight", edge: "content" };
    default:
      return null;
  }
}
