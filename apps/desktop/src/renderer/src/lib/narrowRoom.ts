// 「太窄？收起 X」 (docs/design/002 做法 3, owner 2026-10-21): a preview — a page, an artifact, a web page, a file
// preview, a diff — open in a Shelf of one of two workspaces, narrower than it reads comfortably, offers to fold
// the other workspace to its strip and take its width (lib/workspaceEffects makeRoomEffect; never by itself:
// the layout changes only when the owner acts). components/side/NarrowChip draws it. Pure; tested in
// test/convStrips.test.ts.
import { DIFF_COMPONENT, PREVIEW_COMPONENT, SERVICE_COMPONENT } from "./sideKinds";
import { PAGE_KIND_PREFIX } from "./paneLayout";

/** Below this width (px of the pane) a preview is 「太窄」 (or its kind's declared minimum, when wider). */
export const COMFORT_WIDTH = 560;

/** The panes that are previews (documents to read): a page, and these well-known kinds. */
const PREVIEW_KINDS: readonly string[] = ["artifacts.view", "browser.tab", SERVICE_COMPONENT, PREVIEW_COMPONENT, DIFF_COMPONENT];

/** The width a pane of `kind` reads comfortably at (null: not a preview — no chip). `minW`: its declared minimum. */
export function comfortWidth(kind: string, minW?: number | null): number | null {
  if (!kind.startsWith(PAGE_KIND_PREFIX) && !PREVIEW_KINDS.includes(kind)) return null;
  return Math.max(COMFORT_WIDTH, minW ?? 0);
}

/** Whether the chip shows: a preview, measured, narrower than its comfortable width, with a workspace to fold. */
export function narrowChipShown(i: { width: number | null; comfort: number | null; canFold: boolean }): boolean {
  return i.canFold && i.comfort !== null && i.width !== null && i.width > 0 && i.width < i.comfort;
}
