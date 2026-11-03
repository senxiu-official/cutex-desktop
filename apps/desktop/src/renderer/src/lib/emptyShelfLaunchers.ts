import type { LauncherGroup } from "./sideLaunchers";

export type ShelfLauncherSection = "content" | "tool" | "status" | "page";

/** Use module metadata, keeping registry order within each section and omitting empty sections. */
export function shelfLauncherSections<T extends { group?: LauncherGroup; category?: "content" | "tool" }>(items: readonly T[]) {
  return (["content", "tool", "status", "page"] as const).flatMap((section) => {
    const entries = items.filter((item) => (item.group === "status" || item.group === "page" ? item.group : item.category ?? "tool") === section);
    return entries.length ? [{ section, entries }] : [];
  });
}
