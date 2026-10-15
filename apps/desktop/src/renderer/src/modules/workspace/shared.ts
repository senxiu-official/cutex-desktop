// Helpers shared by the workspace cards (kept out of the .tsx files so Fast Refresh works).
import type { WorkspaceScope } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { contextMenu, type MenuEntry } from "../../lib/contextMenu";
import { fileMenu } from "../../lib/menus";
import { useSide } from "../../lib/sideLayoutStore";
import { rootFor } from "../../lib/workspace";
import { selectedSidebar, useApp } from "../../store";
import type { ItemId } from "../types";

export const FILES: ItemId = "workspace.files";
export const CHANGES: ItemId = "workspace.changes";
export const PREVIEW: ItemId = "workspace.preview";

export function useFileMenu(scope: WorkspaceScope | null) {
  const { t } = useI18n();
  const root = useApp((s) => (scope ? rootFor(selectedSidebar(s), scope) : null));
  return (path: string, opts?: { changed?: boolean; isDir?: boolean }) => contextMenu((): MenuEntry[] => fileMenu(path, root, t, opts));
}

export function fence(lang: string, text: string): string {
  const ticks = text.includes("```") ? "````" : "```";
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

/**
 * A string field of the selected agent's most recently used instance of `kind` (the file tree marks
 * the previewed file, the 改动 list the diffed one).
 */
export function useCurrentField(kind: ItemId, field: string): string | null {
  const selected = useApp((s) => s.selectedId);
  return useSide((s) => {
    let best: { at: number; value: string } | null = null;
    for (const inst of Object.values(s.layout.instances)) {
      if (inst.kind !== kind || inst.binding.kind !== "agent" || inst.binding.sessionId !== selected) continue;
      const value = inst.state && typeof inst.state === "object" && !Array.isArray(inst.state) ? inst.state[field] : undefined;
      if (typeof value === "string" && (!best || inst.lastActiveAt > best.at)) best = { at: inst.lastActiveAt, value };
    }
    return best?.value ?? null;
  });
}
