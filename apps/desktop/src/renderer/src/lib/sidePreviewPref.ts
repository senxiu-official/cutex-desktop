// Settings → 两侧 → 打开文件 (UI pref `sidePreview`, docs/desktop-modules.md §18.12). The default moved
// from "links-new-tab" to "replace" (lead 2026-10-12; Ctrl/⌘ / middle click keeps a file, §18.8).
// Prefs store the whole object, so the old default is migrated once (like reasoningViewRev).

export type SidePreview = "replace" | "links-new-tab" | "new-tab";
export const SIDE_PREVIEWS: readonly SidePreview[] = ["replace", "links-new-tab", "new-tab"];
export const DEFAULT_SIDE_PREVIEW: SidePreview = "replace";
export const SIDE_PREVIEW_REV = 1;

/** Stored value → setting: a pre-rev-1 "links-new-tab" (the old default) becomes "replace" once; any other choice is kept. */
export function migrateSidePreview(v: unknown, rev: unknown): SidePreview {
  if (!(SIDE_PREVIEWS as readonly unknown[]).includes(v)) return DEFAULT_SIDE_PREVIEW;
  if (v === "links-new-tab" && (typeof rev !== "number" || rev < SIDE_PREVIEW_REV)) return DEFAULT_SIDE_PREVIEW;
  return v as SidePreview;
}
