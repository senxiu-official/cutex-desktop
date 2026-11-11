// Service helpers (non-component, kept out of components/ for Fast Refresh): opening a service,
// its context menu, and grouping by project.
import type { ProjectSummary } from "@cutex-desktop/protocol";
import type { ServicePatch, ServiceView, SidebarSnapshot } from "../../../shared/ipc";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { SERVICES_EPHEMERAL_TTL_FEATURE, SERVICES_ORGANIZE_FEATURE, SERVICES_PROJECT_SCOPE_FEATURE, SERVICES_IDLE_PRESETS_FEATURE } from "../../../shared/servicesSettings";
import { api, apiFor } from "../bridge";
import type { MessageKey } from "../i18n";
import { services } from "../modules/app";
import { useApp } from "../store";
import { confirmDialog, promptDialog, type MenuEntry } from "./contextMenu";
import type { ReactNode } from "react";
import { hostData } from "./hostScope";
import { copyText } from "./menus";
import { serviceAddressOf, serviceCopyEntries } from "./serviceAddress";
import { sideShowsHost } from "./sideServices";
import { SERVICE_COMPONENT } from "./sideKinds";
import { refActionEntries } from "./refActions";
import { claimProjectChoices, scopePatch, serviceMayManage, serviceScope } from "./projectServices";
import { isSupervised, isWorker, isWorkerOn, showWorker } from "./serviceWorker";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const focusId = () => useApp.getState().hosts?.active ?? LOCAL_HOST_ID;
/** The host a service belongs to (multi-host: a merged list's row; default the focus host). */
const daemonOf = (hostId: string | undefined) => (!hostId || hostId === focusId() ? api : apiFor(hostId));

/**
 * Open a service: in an in-app browser tab (`cutex:service/<slug>/…`, opened by component id — the
 * tab starts an on-demand service and reaches a remote host's service too), else when that tab
 * cannot open (browser module off) or `external`, in the system browser.
 */
export async function openService(s: Pick<ServiceView, "slug"> & { runtime?: ServiceView["runtime"] }, hostId = focusId(), path = "/", opts: { external?: boolean } = {}): Promise<void> {
  // A background service has no page: it is shown on the 服务 page (lib/serviceWorker).
  if (isWorker(s as Pick<ServiceView, "runtime">) || isWorkerOn(hostId, s.slug)) return showWorker(s.slug);
  if (!opts.external && openInApp(s.slug, hostId, path)) return;
  await openServiceExternal(s, hostId, path);
}

/** The in-app browser tab only (false = it cannot open: browser module off, another host's side). */
export function openInApp(slug: string, hostId: string, path: string): boolean {
  // The right side shows the open agent's host only: another host's tab would open out of view.
  if (!sideShowsHost(hostId)) return false;
  try {
    const url = `cutex:service/${slug}${path.startsWith("/") ? path : `/${path}`}`;
    return services.side.open(SERVICE_COMPONENT, { url }, { binding: { kind: "host", hostId }, reveal: true, focus: true }).status === "opened";
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
  if (isWorkerOn(hostId, s.slug)) return showWorker(s.slug);
  const r = await daemonOf(hostId).openService(s.slug);
  const base = hostId !== LOCAL_HOST_ID ? r.url || r.localUrl : r.localUrl || r.url;
  await api.openExternal(path === "/" ? base : new URL(path.replace(/^\/+/, ""), base.endsWith("/") ? base : `${base}/`).href);
}

export function serviceMenu(s: ServiceView, t: T, onError: (e: string) => void, toggleLogs?: () => void, hostId?: string, toggleOrganize?: () => void, organization: MenuEntry[] = [], ownerFlyout?: ReactNode): MenuEntry[] {
  const api = daemonOf(hostId);
  const run = (fn: () => Promise<unknown>) => void fn().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  // Only `managed` services and `worker`s run under cutex; `external` and `static` (files cutex serves) have nothing to start or stop — cutex answers 409 not_supervised.
  const supervised = isSupervised(s);
  // A background program (no port, no page): no 打开 / copy rows; its controls come first.
  const worker = isWorker(s);
  // A worker waiting to restart (`unreachable`: no probe, it crashed and cutex retries with backoff — forever when
  // persistent) is still wanted running: it offers 停止后台 / 重启, not 启动后台.
  const running = s.health === "reachable" || s.health === "starting" || (worker && s.health === "unreachable" && !s.stopped);
  const supportsTtl = hostData(useApp.getState(), hostId ?? focusId())?.features.has(SERVICES_EPHEMERAL_TTL_FEATURE) ?? false;
  const supportsOrganize = hostData(useApp.getState(), hostId ?? focusId())?.features.has(SERVICES_ORGANIZE_FEATURE) ?? false;
  const host = hostData(useApp.getState(), hostId ?? focusId());
  const supportsIdle = host?.features.has(SERVICES_IDLE_PRESETS_FEATURE) === true;
  // An agent view says whether it may manage the service (`youMayManage`); the owner's list leaves it out (manages all).
  const manage = serviceMayManage(s);
  const scopeRows = manage && !s.archived && (host?.features.has(SERVICES_PROJECT_SCOPE_FEATURE) ?? false) ? serviceScopeEntries(s, t, host?.sidebar, (patch) => run(() => api.patchService(s.slug, patch))) : [];
  const currentTtl = s.effectiveIdleTtlMinutes ?? Number.POSITIVE_INFINITY;
  const ttlChoices = [30, 120, 480, 1440].filter((minutes) => minutes > currentTtl && minutes <= (s.maxIdleTtlMinutes ?? 1440));
  const controls: MenuEntry[] = supervised && !s.archived ? [
    manage && running && { label: t(worker ? "services.worker.stop" : "services.stop"), info: worker ? t("services.worker.stop.hint") : undefined, onSelect: () => run(() => api.serviceAction(s.slug, "stop")) },
    manage && !running && { label: t(supportsIdle && s.health === "stoppedIdle" ? "services.wake" : worker ? "services.worker.start" : "services.start"), onSelect: () => run(() => api.serviceAction(s.slug, "start")) },
    manage && running && { label: t("services.restart"), onSelect: () => run(() => api.serviceAction(s.slug, "restart")) },
    !!toggleLogs && { label: t("services.logs"), onSelect: toggleLogs },
  ] : [];
  return [
    ...(worker ? controls : []),
    worker && controls.some(Boolean) && "separator",
    !worker && !s.archived && { label: t("services.open"), onSelect: () => run(() => openService(s, hostId)) },
    !worker && !s.archived && { label: t("services.openExternal"), onSelect: () => run(() => openService(s, hostId, "/", { external: true })) },
    // The loopback address, not cutex's `url` (the daemon machine's name); another host's is labelled as its own (lib/serviceAddress).
    ...(!s.archived ? serviceCopyEntries(serviceAddressOf(s, hostId ?? focusId(), useApp.getState().hosts?.hosts.find((h) => h.id === (hostId ?? focusId()))), t, copyText) : []),
    // The owner picker is the flyout (components/ServiceOwnerFlyout): the service's own host, searchable,
    // bounded, project members first — not a flat menu of the host's every session (owner bug 2026-10-28).
    manage && ownerFlyout !== undefined && { label: t("services.changeOwner"), flyout: ownerFlyout, onSelect: () => {} },
    ...scopeRows,
    !worker && supervised && manage && !s.archived && "separator",
    ...(worker ? [] : controls),
    supportsIdle && supervised && manage && !s.archived && s.lifetime === "persistent" && {
      label: t("services.idleStop"), onSelect: () => {},
      submenu: (["1h", "24h", "7d", "forever"] as const).map(preset => ({
        label: `${(s.idleStopPreset ?? "forever") === preset ? "✓ " : ""}${t(`services.idleStop.${preset}`)}`,
        info: t(worker ? "services.worker.idleStop.hint" : "services.idleStop.hint"),
        onSelect: () => run(() => api.patchService(s.slug, { idleStopPreset: preset })),
      })),
    },
    supportsTtl && manage && s.lifetime === "ephemeral" && "separator",
    supportsTtl &&
      manage &&
      s.lifetime === "ephemeral" && {
        label: s.pinned ? t("services.keepPinned.on") : t("services.keepPinned.off"),
        info: t("services.keepPinned.hint"),
        onSelect: () => run(() => api.patchService(s.slug, { pinned: !s.pinned })),
      },
    supportsOrganize && "separator",
    supportsOrganize && {
      label: t("services.note.edit"),
      onSelect: () => void promptDialog(t("services.note.edit"), s.note ?? "", { placeholder: t("services.note.placeholder"), multiline: true, maxLength: 1000 }).then((note) => note !== null && run(() => api.patchService(s.slug, { note: note.trim() || null }))),
    },
    ...organization,
    supportsOrganize && toggleOrganize && { label: t("services.organize"), onSelect: toggleOrganize },
    supportsOrganize &&
      s.lifetime === "ephemeral" && {
        label: t("services.keep"),
        submenu: (["foreground", "background"] as const).map((purpose) => ({
          label: t(`services.purpose.${purpose}`),
          onSelect: () => run(() => api.patchService(s.slug, { lifetime: "persistent", purpose })),
        })),
        onSelect: () => {},
      },
    supportsOrganize &&
      s.lifetime === "persistent" && {
        label: t("services.purpose"),
        submenu: (["foreground", "background", "unknown"] as const).map((purpose) => ({
          label: `${s.purpose === purpose || (!s.purpose && purpose === "unknown") ? "✓ " : ""}${t(`services.purpose.${purpose}`)}`,
          onSelect: () => run(() => api.patchService(s.slug, { purpose: purpose === "unknown" ? null : purpose })),
        })),
        onSelect: () => {},
      },
    supportsOrganize && {
      label: s.starred ? t("services.unstar") : t("services.star"),
      onSelect: () => run(() => api.patchService(s.slug, { starred: !s.starred })),
    },
    supportsOrganize && !s.archived && {
      label: s.hidden ? t("services.show") : t("services.hide"),
      onSelect: () => run(() => api.patchService(s.slug, { hidden: !s.hidden })),
    },
    supportsOrganize && !s.archived && {
      label: t("services.archive"),
      onSelect: () => run(() => api.serviceAction(s.slug, "archive")),
    },
    supportsOrganize && s.archived && {
      label: t("services.restore"),
      onSelect: () => run(() => api.serviceAction(s.slug, "restore")),
    },
    supportsTtl &&
      s.lifetime === "ephemeral" &&
      !s.pinned &&
      ttlChoices.length > 0 && {
        label: t("services.extend"),
        submenu: ttlChoices.map((minutes) => ({
          label: t(`services.idleTtl.${minutes}` as "services.idleTtl.30"),
          onSelect: () => run(() => api.patchService(s.slug, { idleTtlMinutes: minutes })),
        })),
        onSelect: () => {},
      },
    // The modules' `ref.action` items for the service (§19.8; e.g. 固定到主页 / 取消固定).
    ...refActionEntries({ hostId: hostId ?? focusId(), kind: "service", key: s.slug, title: (s.displayName || s.slug).slice(0, 200), params: {} }, true),
    manage && "separator",
    manage && {
      label: t("services.delete"),
      danger: true,
      onSelect: () =>
        void (async () => {
          if (await confirmDialog(t("services.deleteConfirm", { name: s.displayName || s.slug }), true)) run(() => api.deleteService(s.slug));
        })(),
    },
  ];
}

/**
 * 转为项目服务 / 转为个人服务 (cutex `services-project-scope`, owner): medium risk, so the row confirms in place
 * (armed). A record without a projectId picks the project in a submenu, the registrant's project first.
 */
export function serviceScopeEntries(s: ServiceView, t: T, sidebar: SidebarSnapshot | null | undefined, send: (patch: ServicePatch) => void): MenuEntry[] {
  const nameOf = (id: string | null | undefined) => (id && sidebar?.projects?.projects.find((p) => p.project_id === id)?.presentation.display_name) || id || "";
  if (serviceScope(s) === "project") {
    const patch = scopePatch(s, "session")!;
    return [{ label: t("services.ownerScope.toSession"), info: t("services.ownerScope.toSession.hint"), armed: t("services.ownerScope.toSession.armed"), onSelect: () => send(patch) }];
  }
  if (s.projectId) {
    const patch = scopePatch(s, "project")!;
    return [{ label: t("services.ownerScope.toProject"), info: t("services.ownerScope.toProject.hint"), armed: t("services.ownerScope.toProject.armed", { project: nameOf(s.projectId) }), onSelect: () => send(patch) }];
  }
  const choices = claimProjectChoices(s, sidebar);
  if (!choices.length) return [{ label: t("services.ownerScope.toProject"), disabled: true, title: t("services.ownerScope.noProjects"), onSelect: () => {} }];
  return [{
    label: t("services.ownerScope.toProjectPick"),
    info: t("services.ownerScope.toProject.hint"),
    submenu: choices.map(({ project, registrants }) => ({
      label: project.presentation.display_name || project.project_id,
      hint: registrants ? t("services.ownerScope.registrantsProject") : undefined,
      // The row names the project already; a short text keeps the narrow submenu from wrapping.
      armed: t("services.claim.armed"),
      onSelect: () => send(scopePatch(s, "project", project.project_id)!),
    })),
    onSelect: () => {},
  }];
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
