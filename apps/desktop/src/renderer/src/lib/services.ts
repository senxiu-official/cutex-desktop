// Service helpers (non-component, kept out of components/ for Fast Refresh): opening a service,
// its context menu, and grouping by project.
import type { ProjectSummary } from "@cutex-desktop/protocol";
import type { ServiceView } from "../../../shared/ipc";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { api, apiFor } from "../bridge";
import type { MessageKey } from "../i18n";
import { services } from "../modules/app";
import { useApp } from "../store";
import { confirmDialog, openMenuAt, type MenuEntry } from "./contextMenu";
import { hostData } from "./hostScope";
import { copyText } from "./menus";
import { sideShowsHost } from "./sideServices";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const focusId = () => useApp.getState().hosts?.active ?? LOCAL_HOST_ID;
/** The host a service belongs to (multi-host: a merged list's row; default the focus host). */
const daemonOf = (hostId: string | undefined) => (!hostId || hostId === focusId() ? api : apiFor(hostId));

/**
 * Open a service: in an in-app browser tab (`cutex:service/<slug>/…`, opened by component id — the
 * tab starts an on-demand service and reaches a remote host's service too), else when that tab
 * cannot open (browser module off) or `external`, in the system browser.
 */
export async function openService(s: Pick<ServiceView, "slug">, hostId = focusId(), path = "/", opts: { external?: boolean } = {}): Promise<void> {
  if (!opts.external && openInApp(s.slug, hostId, path)) return;
  await openServiceExternal(s, hostId, path);
}

function openInApp(slug: string, hostId: string, path: string): boolean {
  // The right side shows the open agent's host only: another host's tab would open out of view.
  if (!sideShowsHost(hostId)) return false;
  try {
    const url = `cutex:service/${slug}${path.startsWith("/") ? path : `/${path}`}`;
    return services.side.open("browser.tab", { url }, { binding: { kind: "host", hostId }, reveal: true, focus: true }).status === "opened";
  } catch {
    return false;
  }
}

/**
 * The system browser (starts an on-demand service first). Same host → loopback URL; a remote host's
 * loopback is not this machine's, so its host URL is used (reachable on the LAN / tailnet only —
 * forwarding service ports over the SSH tunnel is phase 2).
 */
export async function openServiceExternal(s: Pick<ServiceView, "slug">, hostId = focusId(), path = "/"): Promise<void> {
  const r = await daemonOf(hostId).openService(s.slug);
  const base = hostId !== LOCAL_HOST_ID ? r.url || r.localUrl : r.localUrl || r.url;
  await api.openExternal(path === "/" ? base : new URL(path.replace(/^\/+/, ""), base.endsWith("/") ? base : `${base}/`).href);
}

// Where the last pointer press was, so a follow-up menu (owner picker) opens at the same spot.
let lastPointer = { x: 200, y: 200 };
if (typeof window !== "undefined") window.addEventListener("pointerdown", (e) => (lastPointer = { x: e.clientX, y: e.clientY }), true);

function ownerPicker(s: ServiceView, t: T, run: (fn: () => Promise<unknown>) => void, hostId: string | undefined): MenuEntry[] {
  // Owners are agents of the service's own host.
  const agents = hostData(useApp.getState(), hostId ?? focusId())?.sidebar?.active ?? [];
  const api = daemonOf(hostId);
  return [
    ...agents.map((a) => ({ label: `${a.cutexSessionId === s.ownerCutexSessionId ? "✓ " : ""}${a.displayName}`, onSelect: () => run(() => api.patchService(s.slug, { ownerCutexSessionId: a.cutexSessionId })) })),
    s.ownerCutexSessionId && "separator",
    s.ownerCutexSessionId && { label: t("services.clearOwner"), onSelect: () => run(() => api.patchService(s.slug, { ownerCutexSessionId: null })) },
  ];
}

export function serviceMenu(s: ServiceView, t: T, onError: (e: string) => void, toggleLogs?: () => void, hostId?: string): MenuEntry[] {
  const api = daemonOf(hostId);
  const run = (fn: () => Promise<unknown>) => void fn().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  const supervised = s.runtime !== "external";
  const running = s.health === "reachable" || s.health === "starting";
  return [
    { label: t("services.open"), onSelect: () => run(() => openService(s, hostId)) },
    { label: t("services.openExternal"), onSelect: () => run(() => openService(s, hostId, "/", { external: true })) },
    { label: t("services.copyUrl"), onSelect: () => copyText(s.url) },
    { label: t("services.changeOwner"), onSelect: () => setTimeout(() => openMenuAt(lastPointer.x, lastPointer.y, ownerPicker(s, t, run, hostId)), 0) },
    supervised && "separator",
    supervised && running && { label: t("services.stop"), onSelect: () => run(() => api.serviceAction(s.slug, "stop")) },
    supervised && !running && { label: t("services.start"), onSelect: () => run(() => api.serviceAction(s.slug, "start")) },
    supervised && running && { label: t("services.restart"), onSelect: () => run(() => api.serviceAction(s.slug, "restart")) },
    supervised && toggleLogs && { label: t("services.logs"), onSelect: toggleLogs },
    "separator",
    {
      label: t("services.delete"),
      danger: true,
      onSelect: () =>
        void (async () => {
          if (await confirmDialog(t("services.deleteConfirm", { name: s.displayName || s.slug }), true)) run(() => api.deleteService(s.slug));
        })(),
    },
  ];
}

export interface ServiceGroup {
  project: ProjectSummary | null;
  services: ServiceView[];
}

/** Group by project in sidebar order; services without a project last. Name order inside. */
export function groupServices(services: readonly ServiceView[], projects: readonly ProjectSummary[]): ServiceGroup[] {
  const byName = (a: ServiceView, b: ServiceView) => (a.displayName || a.slug).localeCompare(b.displayName || b.slug);
  const groups: ServiceGroup[] = projects.map((p) => ({ project: p, services: services.filter((s) => s.projectId === p.project_id).sort(byName) }));
  const known = new Set(projects.map((p) => p.project_id));
  groups.push({ project: null, services: services.filter((s) => !s.projectId || !known.has(s.projectId)).sort(byName) });
  return groups.filter((g) => g.services.length > 0);
}
