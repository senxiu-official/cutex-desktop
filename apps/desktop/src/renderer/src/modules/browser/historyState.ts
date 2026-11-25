// 浏览历史 (design browser-profiles v3 §11): a tab on 「我的浏览器」 showing one identity's history on its host. State
// is only which identity; main keeps and searches the history (the renderer never stores entries).
import { useI18n } from "../../i18n";
import type { Json } from "../types";
import type { SideTabInfo, SideTabProps } from "../slots";
import { DEFAULT_BROWSER_IDENTITY_ID, isBrowserIdentityId, type BrowserHistoryEntry } from "../../../../shared/browserIdentity";
import { identityColor, useIdentity } from "./identities";

export const BROWSER_HISTORY = "browser.history";
export type BrowserHistoryState = { identityId: string };

export function parseHistoryParams(raw: Json): BrowserHistoryState | null {
  if (raw === null || raw === undefined) return { identityId: DEFAULT_BROWSER_IDENTITY_ID };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = (raw as Record<string, Json>).identityId;
  if (id === undefined) return { identityId: DEFAULT_BROWSER_IDENTITY_ID };
  return isBrowserIdentityId(id) ? { identityId: id } : null;
}

export const initHistory = (params: BrowserHistoryState): BrowserHistoryState => ({ identityId: params.identityId });

export function restoreHistory(raw: Json, version: number): BrowserHistoryState | null {
  return version === 1 ? parseHistoryParams(raw) : null;
}

export function useHistoryTab({ instance }: SideTabProps<BrowserHistoryState>): SideTabInfo {
  const { t } = useI18n();
  const identity = useIdentity(instance.state.identityId);
  const named = identity && !identity.isDefault ? identity : undefined;
  const tint = named ? identityColor(named) : undefined;
  return { title: t("browser.history.title"), ...(named ? { tooltip: t("browser.identity.tabTooltip", { name: named.name }) } : {}), ...(tint ? { tint } : {}) };
}

/** Local midnight of a visit (the day group). */
export const dayOf = (ms: number): number => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Entries grouped by local day, newest first (main returns them newest first). */
export function groupByDay(entries: readonly BrowserHistoryEntry[]): { day: number; entries: BrowserHistoryEntry[] }[] {
  const out: { day: number; entries: BrowserHistoryEntry[] }[] = [];
  for (const e of entries) {
    const day = dayOf(e.visitedAt);
    const last = out.at(-1);
    if (last?.day === day) last.entries.push(e); else out.push({ day, entries: [e] });
  }
  return out;
}

/** The origin of an entry (for 删除这个网站的全部历史), or null. */
export function historyOrigin(url: string): string | null {
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null; } catch { return null; }
}
