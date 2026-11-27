// 「今日」 helpers (no components here, so the component files keep Fast Refresh): the pane kind's id / state / title,
// which assistant a 今日 shows and the narrow-window test of the top band. Opening is ./todayOpen (loaded on use);
// the view itself is ./TodayView.
import { useMemo, useSyncExternalStore } from "react";
import { useI18n } from "../../i18n";
import { requestGroup } from "../../lib/personalAssistants";
import { usePa, type HostPa } from "../../lib/personalAssistantStore";
import type { PaAssistant } from "../../../../shared/personalAssistants";
import type { Json } from "../types";
import type { PaneTitle, SideTabProps } from "../slots";
import { defaultRow, useDefaultAssistantRef, type DefaultAssistantRef } from "./defaultAssistant";

export const TODAY_KIND = "personal-assistants.today";
export type TodayState = Record<string, never>;
export const todayState = (): TodayState => ({});
export const parseTodayParams = (raw: Json): TodayState | null => (raw === null || typeof raw === "object" ? {} : null);

export interface TodayTarget {
  hostId: string;
  assistant: PaAssistant;
  /** The pane follows an assistant's conversation (else it shows the default assistant). */
  own: boolean;
}

/** Every assistant read, host order (the store's) then name — the title-bar menu's order. */
export function allAssistants(byHost: Record<string, HostPa>): { hostId: string; assistant: PaAssistant }[] {
  const out: { hostId: string; assistant: PaAssistant }[] = [];
  for (const [hostId, h] of Object.entries(byHost)) {
    for (const a of [...h.assistants].sort((x, y) => x.config.name.localeCompare(y.config.name) || x.id.localeCompare(y.id))) out.push({ hostId, assistant: a });
  }
  return out;
}

/** What a 今日 shows: the selected agent's assistant, else the default one, else none. */
export function todayTarget(byHost: Record<string, HostPa>, hostId: string | null, sessionId: string | null, stored: DefaultAssistantRef | null): TodayTarget | null {
  const own = hostId && sessionId ? byHost[hostId]?.assistants.find((a) => a.sessionId === sessionId) : undefined;
  if (own && hostId) return { hostId, assistant: own, own: true };
  const d = defaultRow(allAssistants(byHost), stored);
  return d ? { ...d, own: false } : null;
}

export function useTodayTarget(hostId: string | null, sessionId: string | null): TodayTarget | null {
  const byHost = usePa((s) => s.byHost);
  const stored = useDefaultAssistantRef();
  return useMemo(() => todayTarget(byHost, hostId, sessionId, stored), [byHost, hostId, sessionId, stored]);
}

/** What waits for the owner from one assistant (the tab's attention count). */
export function decideCount(byHost: Record<string, HostPa>, hostId: string, assistantId: string): number {
  return (byHost[hostId]?.requests[assistantId] ?? []).filter((r) => requestGroup(r.state) === "decide").length;
}

export function useTodayTitle({ hostId, sessionId }: SideTabProps<TodayState>): PaneTitle {
  const { t } = useI18n();
  const target = useTodayTarget(hostId, sessionId);
  const n = usePa((s) => (target ? decideCount(s.byHost, target.hostId, target.assistant.id) : 0));
  return {
    title: t("personal-assistants.todayView.title"),
    tooltip: target ? `${t("personal-assistants.todayView.title")} · ${target.assistant.config.name}` : undefined,
    attention: n > 0 ? n : undefined,
  };
}

// ---- the top band in portrait / narrow windows ----

/** Below this window width (or in a portrait window) 今日 is a band over the conversation rather than a right view. */
export const BAND_MAX_WIDTH = 1100;
export const BAND_QUERY = `(orientation: portrait), (max-width: ${BAND_MAX_WIDTH - 1}px)`;

export function useBandWindow(win: Window): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = win.matchMedia?.(BAND_QUERY);
      m?.addEventListener("change", l);
      return () => m?.removeEventListener("change", l);
    },
    () => !!win.matchMedia?.(BAND_QUERY).matches,
    () => false,
  );
}

const BAND_KEY = "cutex-desktop.personal-assistants.today-band-open";
const bandListeners = new Set<() => void>();
const readBand = () => {
  try {
    return localStorage.getItem(BAND_KEY) === "1";
  } catch {
    return false;
  }
};
export function setBandOpen(open: boolean): void {
  try {
    localStorage.setItem(BAND_KEY, open ? "1" : "0");
  } catch {
    // this device only
  }
  for (const l of bandListeners) l();
}
export function useBandOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      bandListeners.add(l);
      return () => bandListeners.delete(l);
    },
    readBand,
    () => false,
  );
}

/** 今日 panes on screen now (a band is not needed while one shows: a narrow window that kept its right view). */
const shownPanes = new Set<string>();
const paneListeners = new Set<() => void>();
export function setTodayPaneShown(id: string, shown: boolean): void {
  if (shown === shownPanes.has(id)) return;
  if (shown) shownPanes.add(id);
  else shownPanes.delete(id);
  for (const l of paneListeners) l();
}
export function useTodayPaneShown(): boolean {
  return useSyncExternalStore(
    (l) => {
      paneListeners.add(l);
      return () => paneListeners.delete(l);
    },
    () => shownPanes.size > 0,
    () => false,
  );
}
