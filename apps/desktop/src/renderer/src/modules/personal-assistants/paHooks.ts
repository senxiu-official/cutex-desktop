// 个人助理 page helpers (no components here, so the component files keep Fast Refresh): which hosts have assistants,
// their projects and names, reading the store while the page is open, and the overlap dismissals.
// Assistants are cross-host by nature (owner 2026-11-25): the page lists every connected host that has the capability,
// not only the hosts of the current view.
// r296 hosts announce changes (`cutex/personalAssistant/changed`): one shared subscription feeds the store
// (`usePaChangeEvents`), and only r295 hosts are polled.
import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { useOwnerWindow } from "../../lib/ownerContext";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import { PA_CHANGED_EVENT, type PaAssistant, type PaRequest, type PaSeat, type PaView } from "../../../../shared/personalAssistants";
import { useConnectedHostData } from "../../lib/hostLists";
import type { HostLook } from "../../lib/hostScope";
import { paErrorCode, paFeatures, PERSONAL_ASSISTANTS_FEATURE, type PaHostFeatures } from "../../lib/personalAssistants";
import { bridge, cleanIpcMessage } from "../../bridge";
import { onPaChanged, POLL_MS, refreshHost, usePa, type HostPa } from "../../lib/personalAssistantStore";
import { useHostScope } from "../../lib/useHostScope";

export interface PaHost {
  hostId: string;
  look: HostLook | null;
  label: string;
  online: boolean;
  /** The instance the host reports (its assistant list, else its connection), for pairing projects; null until known. */
  instanceId: string | null;
  supported: boolean;
  /** What its cutex offers beyond r295 (定期任务, owner views, qualified refs, cross-host scope). */
  features: PaHostFeatures;
  /** The host's whole feature list (the phase-1 contract checks its own features, ./phase1Contract). */
  featureSet?: ReadonlySet<string>;
  projects: ProjectSummary[];
  /** cutexSessionId → display name. */
  names: ReadonlyMap<string, string>;
}

/** Every configured host (switcher order) with what this app knows of it. */
export function usePaHosts(): PaHost[] {
  const scope = useHostScope();
  const data = useConnectedHostData();
  const pa = usePa((s) => s.byHost);
  return useMemo(() => {
    const byId = new Map(data.map((d) => [d.hostId, d]));
    return scope.hosts.map((look) => {
      const d = byId.get(look.id);
      const sidebar = d?.sidebar ?? null;
      const names = new Map<string, string>();
      for (const s of sidebar?.active ?? []) names.set(s.cutexSessionId, s.displayName);
      for (const s of sidebar?.retired ?? []) if (!names.has(s.cutexSessionId)) names.set(s.cutexSessionId, s.displayName);
      const daemon = d?.daemon;
      return {
        hostId: look.id,
        look,
        label: look.label,
        online: daemon?.kind === "connected",
        // The assistant list's own `homeInstanceId` pairs projects (backend 2026-11-25); the connection's otherwise.
        instanceId: pa[look.id]?.instanceId ?? (daemon?.kind === "connected" ? daemon.instanceId : undefined) ?? null,
        supported: !!d?.features.has(PERSONAL_ASSISTANTS_FEATURE),
        features: paFeatures(d?.features),
        featureSet: d?.features,
        projects: (sidebar?.projects?.projects ?? []).filter((p) => p.lifecycle !== "archived"),
        names,
      };
    });
  }, [scope.hosts, data, pa]);
}

/**
 * Reads the given hosts now and when the window regains focus; hosts without change events (r295) also every POLL_MS
 * while mounted (r296 hosts announce their changes: `usePaChangeEvents`).
 */
export function usePaRefresh(hosts: readonly Pick<PaHost, "hostId" | "features">[]): void {
  const key = hosts.map((h) => `${h.hostId}=${h.features.ownerViews ? "events" : "poll"}`).join("\n");
  // The page's own window (a page may open in another app window).
  const win = useOwnerWindow();
  useEffect(() => {
    if (!key) return;
    const entries = key.split("\n").map((e) => [e.slice(0, e.lastIndexOf("=")), e.endsWith("=poll")] as const);
    const all = () => entries.forEach(([id]) => void refreshHost(id));
    const polled = entries.filter(([, poll]) => poll).map(([id]) => id);
    all();
    const timer = setInterval(() => {
      if (win.document.visibilityState === "visible") polled.forEach((id) => void refreshHost(id));
    }, POLL_MS);
    win.addEventListener("focus", all);
    return () => {
      clearInterval(timer);
      win.removeEventListener("focus", all);
    };
  }, [key, win]);
}

// ---- change events (one subscription however many surfaces use it) ----

let subscribers = 0;
let unsubscribe: (() => void) | null = null;
/** Feeds r296 `cutex/personalAssistant/changed` events to the store while mounted (the nav badge keeps it on). */
export function usePaChangeEvents(): void {
  useEffect(() => {
    subscribers += 1;
    if (!unsubscribe) {
      unsubscribe = bridge.on("hostEvent", ({ hostId, envelope }) => {
        if (envelope.cutex?.method === PA_CHANGED_EVENT) onPaChanged(hostId, envelope.cutex.params);
      });
    }
    return () => {
      subscribers -= 1;
      if (subscribers === 0 && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  }, []);
}

/** A project's Director seat on its host as this app sees it now; undefined when the project is not known here. */
export function projectSeat(host: PaHost | undefined, projectId: string): PaSeat | undefined {
  const p = host?.projects.find((x) => x.project_id === projectId);
  return p ? { sessionId: p.director_cutex_session_id ?? null, epoch: p.authority_epoch } : undefined;
}

/** Moves when the store's ticks of these areas of this assistant move (open cards read again). */
export function usePaTick(hostId: string, assistantId: string, ...areas: readonly string[]): number {
  return usePa((s) => {
    const t = s.byHost[hostId]?.ticks[assistantId] as Record<string, number | undefined> | undefined;
    return t ? areas.reduce((n, a) => n + (t[a] ?? 0), 0) : 0;
  });
}

/** Runs `fn` every `ms` while the window is visible and `on` holds (cards whose data has no change event). */
export function useVisiblePoll(fn: () => void, ms: number, on: boolean): void {
  const win = useOwnerWindow();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => win.document.visibilityState === "visible" && ref.current(), ms);
    return () => clearInterval(timer);
  }, [ms, on, win]);
}

export interface PaRow {
  hostId: string;
  assistant: PaAssistant;
  view: PaView | null;
  requests: PaRequest[];
}

/** All assistants read so far, host order then name. */
export function paRows(hosts: readonly PaHost[], byHost: Record<string, HostPa>, locale: string): PaRow[] {
  const out: PaRow[] = [];
  for (const h of hosts) {
    const data = byHost[h.hostId];
    if (!data) continue;
    const rows = [...data.assistants].sort((a, b) => a.config.name.localeCompare(b.config.name, locale) || a.id.localeCompare(b.id));
    for (const a of rows) out.push({ hostId: h.hostId, assistant: a, view: data.views[a.id] ?? null, requests: data.requests[a.id] ?? [] });
  }
  return out;
}

/** The assistant whose conversation `sessionId` on `hostId` is (as last read). */
export function assistantOfSession(byHost: Record<string, HostPa>, hostId: string | null | undefined, sessionId: string | null | undefined): PaAssistant | null {
  if (!hostId || !sessionId) return null;
  return byHost[hostId]?.assistants.find((a) => a.sessionId === sessionId) ?? null;
}

export const rowKey = (hostId: string, id: string) => `${hostId}\n${id}`;

/** A project's display name on a host (its id when unknown). */
export function projectName(host: PaHost | undefined, projectId: string): string {
  return host?.projects.find((p) => p.project_id === projectId)?.presentation.display_name ?? projectId;
}

/** A session's name on a host (a short id when unknown). */
export function sessionName(host: PaHost | undefined, sessionId: string | null): string | null {
  if (!sessionId) return null;
  return host?.names.get(sessionId) ?? (sessionId.length > 14 ? `${sessionId.slice(0, 10)}…` : sessionId);
}

// ---- overlap warnings the owner dismissed (this device; per assistant and exact set of overlaps) ----

const DISMISS_KEY = "cutex-desktop.personal-assistants.overlapDismissed";
const readDismissed = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-200) : [];
  } catch {
    return [];
  }
};
export const useOverlapDismissals = create<{ keys: string[] }>(() => ({ keys: typeof localStorage === "undefined" ? [] : readDismissed() }));
export function dismissOverlap(key: string): void {
  const keys = [...useOverlapDismissals.getState().keys.filter((k) => k !== key), key].slice(-200);
  useOverlapDismissals.setState({ keys });
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(keys));
  } catch {
    // Storage full / unavailable: dismissed for this run only.
  }
}

// ---- refusals as shown ----

type T = (key: import("../../i18n").MessageKey, vars?: Record<string, string | number>) => string;
const FORBIDDEN = new Set(["assistant_required", "director_required", "owner_required", "forbidden", "insufficient_scope"]);
/** Refusals with their own plain sentence. */
const PLAIN: Readonly<Record<string, import("../../i18n").MessageKey>> = {
  open_request_limit: "personal-assistants.error.limit",
  full_owner_native_confirmation_required: "personal-assistants.error.fullOwnerNative",
  destination_scope_required: "personal-assistants.error.destinationScope",
  body_too_large: "personal-assistants.error.bodyTooLarge",
  calendar_changed: "personal-assistants.error.calendarChanged",
  template_not_found: "personal-assistants.error.templateNotFound",
  director_missing: "personal-assistants.error.directorMissing",
  director_changed: "personal-assistants.error.directorChanged",
  confirmation_stale: "personal-assistants.error.confirmationStale",
  provisioning_in_progress: "personal-assistants.error.provisioning",
};
/** A refusal code in plain words (a run's refusal too), or null when the app has none for it. */
export function paCodeText(code: string | null, t: T): string | null {
  if (!code) return null;
  const key = PLAIN[code];
  if (key) return t(key);
  if (FORBIDDEN.has(code)) return t("personal-assistants.error.forbidden");
  return null;
}
/** A refusal in plain words where the app knows it; cutex's own text otherwise. */
export function paErrorText(error: unknown, t: T): string {
  const plain = paCodeText(paErrorCode(error), t);
  if (plain) return plain;
  return cleanIpcMessage(error instanceof Error ? error.message : String(error));
}
