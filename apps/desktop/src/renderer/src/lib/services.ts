// Service helpers (non-component, kept out of components/ for Fast Refresh): opening a service,
// its context menu, and grouping by project.
import type { ProjectSummary } from "@cutex-desktop/protocol";
import type { ServicePatch, ServiceView, SidebarSnapshot } from "../../../shared/ipc";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { SERVICES_REMOTE_ACCESS_FEATURE, SERVICES_EPHEMERAL_TTL_FEATURE, SERVICES_ORGANIZE_FEATURE, SERVICES_PROJECT_SCOPE_FEATURE, SERVICES_IDLE_PRESETS_FEATURE } from "../../../shared/servicesSettings";
import { api, apiFor } from "../bridge";
import { translate, type MessageKey } from "../i18n";
import { services } from "../modules/app";
import { recentAgentOn, useApp } from "../store";
import { windowShowing } from "./windowRoute";
import { currentWindow } from "./windowScope";
import { confirmDialog, promptDialog, type MenuEntry } from "./contextMenu";
import type { ReactNode } from "react";
import { hostData } from "./hostScope";
import { copyText } from "./menus";
import { showShelfToast } from "./shelves";
import { serviceAddressOf, serviceCopyEntries } from "./serviceAddress";
import { sideShowsHost } from "./sideServices";
import { SERVICE_COMPONENT } from "./sideKinds";
import { refActionEntries } from "./refActions";
import { claimProjectChoices, scopePatch, serviceMayManage, serviceScope } from "./projectServices";
import { isSupervised, isWorker, isWorkerOn, showWorker } from "./serviceWorker";
import { createElement } from "react";
import { EntityIcon } from "../components/EntityIcon";
import { projectEntity } from "./entityIcon";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const focusId = () => useApp.getState().hosts?.active ?? LOCAL_HOST_ID;
/** The host a service belongs to (multi-host: a merged list's row; default the focus host). */
const daemonOf = (hostId: string | undefined) => (!hostId || hostId === focusId() ? api : apiFor(hostId));

/**
 * Open a service: in an in-app browser tab (`cutex:service/<slug>/…`, opened by component id — the
 * tab starts an on-demand service and reaches a remote host's service too; openServiceTab), or with
 * `external` (the menu's 「在系统浏览器中打开」) in the system browser.
 */
export async function openService(s: Pick<ServiceView, "slug"> & { runtime?: ServiceView["runtime"]; displayName?: string | null }, hostId = focusId(), path = "/", opts: { external?: boolean } = {}): Promise<void> {
  // A background service has no page: it is shown on the 服务 page (lib/serviceWorker).
  if (isWorker(s as Pick<ServiceView, "runtime">) || isWorkerOn(hostId, s.slug)) return showWorker(s.slug);
  if (opts.external) return void (await openServiceExternal(s, hostId, path));
  await openServiceTab(s, hostId, path);
}

/**
 * Every default open of a service (服务 page, chat links, tray / desktop pins, ⌘K, reveals, service notifications; owner
 * 2026-11-28 「服务的打开方式又变成了默认系统浏览器」): the in-app tab, on its host's Shelf. While the Shelf shows another host
 * (所有主机 with another host's agent open) it switches there first — this machine's services too, not only remote ones
 * (since 8f5a1a03c only remote services did; this machine's went to the system browser silently). The system browser
 * only while the browser module is off, with a toast saying so; a remote host's never (systemBrowserOpens). Resolves
 * how it ended: "opened" (the tab, the 服务 page for a background service, or the owner moved on meanwhile: nothing
 * more to do), "system" (the system browser), "browser-off" (a remote host's with the module off), "failed" (a toast
 * said why).
 */
export type ServiceTabOutcome = "opened" | "system" | "browser-off" | "failed";
export async function openServiceTab(s: Pick<ServiceView, "slug"> & { displayName?: string | null }, hostId = focusId(), path = "/"): Promise<ServiceTabOutcome> {
  if (isWorkerOn(hostId, s.slug)) {
    showWorker(s.slug);
    return "opened";
  }
  const why = sideShowsHost(hostId) ? tabOpen(s.slug, hostId, path) : await openOnItsHost(s.slug, hostId, path);
  if (why === "opened" || why === "moved") return "opened";
  // The browser module is off: this machine's service in the system browser, saying why; a remote host's never.
  if (why === "browser-off" && systemBrowserOpens(hostId)) {
    showShelfToast(translate("services.browserOff", { name: s.displayName || s.slug }));
    return (await openServiceExternal(s, hostId, path)) ? "system" : "failed";
  }
  remoteServiceNotice(s, hostId, why);
  return why === "browser-off" ? "browser-off" : "failed";
}

/** The in-app browser tab only (false = it cannot open: browser module off, another host's side). */
export function openInApp(slug: string, hostId: string, path: string): boolean {
  return tabOpen(slug, hostId, path) === "opened";
}

/** The in-app browser tab: "opened", "browser-off" (its component is unavailable: the module is off or lacks a
 *  capability), or "no-tab" (another host's side, or the open failed otherwise). */
function tabOpen(slug: string, hostId: string, path: string): "opened" | "browser-off" | "no-tab" {
  // The right side shows the open agent's host only: another host's tab would open out of view.
  if (!sideShowsHost(hostId)) return "no-tab";
  try {
    const url = `cutex:service/${slug}${path.startsWith("/") ? path : `/${path}`}`;
    const r = services.side.open(SERVICE_COMPONENT, { url }, { binding: { kind: "host", hostId }, reveal: true, focus: true });
    if (r.status === "opened") return "opened";
    return r.status === "unavailable" && ["module-off", "capability", "unknown-kind"].includes(r.reason) ? "browser-off" : "no-tab";
  } catch {
    return "no-tab";
  }
}

/**
 * Whether a host's services can open in the system browser: this machine's only (its loopback URL). A remote host's
 * service is reached only through the app's own connection to that host (the in-app tab: view ticket over the SSH /
 * management forward). cutex's `url` names the daemon machine (`http://hosta:<port>`): it works only where that name
 * resolves and the service listens beyond loopback, and depends on the route — never used (owner report 2026-11-23,
 * Hostb → EVA over the relay). A ticket for the system browser through main waits for the owner's decision.
 */
export const systemBrowserOpens = (hostId: string): boolean => hostId === LOCAL_HOST_ID;

/**
 * The system browser (starts an on-demand service first), for this machine's services: the loopback URL. A remote
 * host's service never goes there: it opens in the app on its own host's Shelf (openOnItsHost), or a notice says why
 * not (remoteServiceNotice). Resolves true when it opened.
 */
export async function openServiceExternal(s: Pick<ServiceView, "slug"> & { displayName?: string | null }, hostId = focusId(), path = "/"): Promise<boolean> {
  if (isWorkerOn(hostId, s.slug)) {
    showWorker(s.slug);
    return true;
  }
  if (!systemBrowserOpens(hostId)) {
    const why = sideShowsHost(hostId) ? undefined : await openOnItsHost(s.slug, hostId, path);
    if (why === "opened") return true;
    // The owner went elsewhere meanwhile: nothing more (no toast about what they left).
    if (why !== "moved") remoteServiceNotice(s, hostId, why);
    return false;
  }
  const r = await daemonOf(hostId).openService(s.slug);
  const base = r.localUrl || r.url;
  await api.openExternal(path === "/" ? base : new URL(path.replace(/^\/+/, ""), base.endsWith("/") ? base : `${base}/`).href);
  return true;
}

/**
 * The agents that may bring `hostId`'s Shelf into view: listed now as active, shown (not hidden), not archived. Empty
 * when the host is not connected or lists none.
 */
function shelfCandidates(hostId: string) {
  const active = hostData(useApp.getState(), hostId)?.sidebar?.active ?? [];
  // Not one shown in another window's column: switching to it would mean going to that window (one copy per agent).
  const here = currentWindow();
  const elsewhere = (id: string) => {
    const w = windowShowing(hostId, id);
    return w !== null && w !== here;
  };
  return active.filter((a) => a.visible !== false && !a.retiredAt && (a.archiveKind === undefined || a.archiveKind === "active") && !elsewhere(a.cutexSessionId));
}

/**
 * The agent whose conversation brings `hostId`'s Shelf into view: the one of that host the owner viewed last while it is
 * still a candidate (shelfCandidates; cross-review 2026-11-24: hidden / archived / gone since is skipped), else the
 * most recently active candidate. null = none.
 */
export function shelfAgentFor(hostId: string): string | null {
  const candidates = shelfCandidates(hostId);
  const recent = recentAgentOn(hostId);
  if (recent && candidates.some((a) => a.cutexSessionId === recent)) return recent;
  const at = (a: (typeof candidates)[number]) => Date.parse(a.lastActivityAt ?? "") || 0;
  return [...candidates].sort((x, y) => at(y) - at(x))[0]?.cutexSessionId ?? null;
}

/** How long the Shelf may take to reach the service's host (its agent's selection, not its history). */
export const SHELF_SWITCH_MS = 4000;

/**
 * "opened"; "no-agent" (no candidate to open); "not-switched" (the Shelf did not reach the host in time: the agent
 * opened in another window, or the open failed); "moved" (the owner went elsewhere meanwhile: nothing more is done);
 * "no-tab" (reached, but the tab could not open); "browser-off" (reached, but the browser module is off).
 */
export type OpenOnHostOutcome = "opened" | "no-agent" | "not-switched" | "moved" | "no-tab" | "browser-off";

/**
 * A remote host's service while the Shelf shows another host (Director 2026-11-24, auto-switch): the Shelf follows the
 * open agent's host (lib/sideServices sideShowsHost), so that host's agent is opened (shelfAgentFor) — without marking
 * it read (the owner did not read it; `keepUnread`) — and the service opens in the in-app tab there as soon as the
 * Shelf shows that host: not after the agent's history has loaded (cross-review: a stalled history load never opened
 * it), at most SHELF_SWITCH_MS, and never once the owner has gone elsewhere (no late open in another context).
 */
export async function openOnItsHost(slug: string, hostId: string, path: string): Promise<OpenOnHostOutcome> {
  const agent = shelfAgentFor(hostId);
  if (!agent) return "no-agent";
  const start = useApp.getState();
  const was = { id: start.selectedId, host: start.selectedHost };
  // Given up (moved / late): the open is cancelled too, so a selection still on its way (the host's scope coming in,
  // store openAgent → inAllDevices) is never made after it (cross-review 2026-11-24).
  const cancel = new AbortController();
  const reached = await new Promise<"reached" | "moved" | "late">((resolve) => {
    let done = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: "reached" | "moved" | "late") => {
      if (done) return;
      done = true;
      if (r !== "reached") cancel.abort();
      unsubscribe();
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let conversation = false;
    const check = (s: ReturnType<typeof useApp.getState>) => {
      if (s.selectedId === agent && s.selectedHost === hostId && sideShowsHost(hostId)) return finish("reached");
      // Another agent selected than before and than ours, or the conversation left after our open showed it.
      if (s.selectedId !== was.id && s.selectedId !== agent) return finish("moved");
      if (s.view.kind === "conversation") conversation = true;
      else if (conversation) finish("moved");
    };
    unsubscribe = useApp.subscribe(check);
    timer = setTimeout(() => finish("late"), SHELF_SWITCH_MS);
    void useApp.getState().openAgent(agent, hostId, { keepUnread: true, signal: cancel.signal }).catch(() => {});
    check(useApp.getState());
  });
  if (reached === "moved") return "moved";
  if (reached === "late") return "not-switched";
  return tabOpen(slug, hostId, path);
}

/**
 * A remote host's service that the in-app tab could not open: no agent of its host to show its Shelf (not connected,
 * or none), the switch did not happen in this window, or the browser module is off.
 */
export function remoteServiceNotice(s: Pick<ServiceView, "slug"> & { displayName?: string | null }, hostId: string, why?: OpenOnHostOutcome): void {
  const name = s.displayName || s.slug;
  const host = useApp.getState().hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId;
  const key: MessageKey = why === "not-switched" ? "services.remote.notSwitched" : why === "no-tab" || why === "browser-off" || sideShowsHost(hostId) ? "services.remote.needsBrowser" : "services.remote.otherHost";
  // The window-wide toast (components/side/ShelfToast, in every window): the composer notice shows only beside an open
  // conversation, so on the home page / the 服务 page the click would look dead (cross-review 2026-11-23).
  showShelfToast(translate(key, { name, host }));
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
  // 允许 iPad 访问: only where the host offers it (not greyed elsewhere); web services only (a worker has no page).
  const remoteRow = remoteAccessShown(s, hostId ?? focusId()) && manage;
  const scopeRows = manage && !s.archived && (host?.features.has(SERVICES_PROJECT_SCOPE_FEATURE) ?? false) ? serviceScopeEntries(s, t, host?.sidebar, (patch) => run(() => api.patchService(s.slug, patch)), hostId ?? focusId()) : [];
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
    !worker && !s.archived && {
      label: t("services.openExternal"),
      ...(systemBrowserOpens(hostId ?? focusId()) ? {} : { disabled: true, title: t("services.remote.noSystemBrowser") }),
      onSelect: () => run(() => openService(s, hostId, "/", { external: true })),
    },
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
    remoteRow && "separator",
    remoteRow && {
      label: `${s.remoteAccess ? "✓ " : ""}${t("services.remoteAccess")}`,
      info: t("services.remoteAccess.hint"),
      // Opening it to the iPad: medium risk, confirmed in place (armed); closing it: low risk, at once.
      // Not destructive: the armed row in the app's primary colour, not the red of 删除.
      ...(s.remoteAccess ? {} : { armed: t("services.remoteAccess.armed", { name: s.displayName || s.slug }), armedTone: "accent" as const }),
      onSelect: () => run(() => setRemoteAccess(s, hostId ?? focusId(), !s.remoteAccess)),
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
    // Confirm by risk: a stopped, disposable registration arms in place (「移除登记」); a running or persistent one keeps
    // the dialog. The record is read again at the click: one that started or was kept since gets the dialog.
    manage && {
      label: t(serviceDeleteLevel(s) === "armed" ? "services.removeRegistration" : "services.delete"),
      danger: true,
      ...(serviceDeleteLevel(s) === "armed" ? { armed: t("services.removeRegistrationArmed", { name: s.displayName || s.slug }), info: t("services.removeRegistrationHint") } : {}),
      onSelect: () =>
        void (async () => {
          const fresh = currentService(s, hostId);
          const now = fresh ?? s;
          // Not in the host's list (another view's record, or gone): the dialog, never the armed shortcut.
          if (!fresh || serviceDeleteLevel(now) === "dialog" || serviceDeleteLevel(s) === "dialog") {
            if (!(await confirmDialog(t("services.deleteConfirm", { name: now.displayName || now.slug }), true))) return;
          }
          run(() => api.deleteService(now.slug));
        })(),
    },
  ];
}

/** The 允许 iPad 访问 switch is shown: the host offers services-remote-access-v1, a web service, not archived. */
export function remoteAccessShown(s: Pick<ServiceView, "runtime" | "archived">, hostId: string): boolean {
  return hostData(useApp.getState(), hostId)?.features.has(SERVICES_REMOTE_ACCESS_FEATURE) === true && !isWorker(s as Pick<ServiceView, "runtime">) && !s.archived;
}

/**
 * 允许 iPad 访问 on / off (cutex services-remote-access-v1, owner only): decided on the registration shown
 * (`ifRegistration`). A registration that changed since (another registrant, deleted and registered again) is a 409
 * service_registration_changed: the list is read again and the owner decides again — never retried here.
 */
export async function setRemoteAccess(s: Pick<ServiceView, "slug" | "createdAt" | "ownerCutexSessionId">, hostId: string, on: boolean): Promise<ServiceView> {
  try {
    return await daemonOf(hostId).patchService(s.slug, { remoteAccess: on, ifRegistration: { createdAt: s.createdAt, ownerCutexSessionId: s.ownerCutexSessionId } });
  } catch (e) {
    if (/service_registration_changed/.test(e instanceof Error ? e.message : String(e))) {
      void useApp.getState().refreshServices(hostId).catch(() => {});
      throw new Error(translate("services.remoteAccess.changed"));
    }
    throw e;
  }
}

/** Not running under cutex now: stopped (by the owner or idle), crash-looped, or an unsupervised entry that answers nothing. */
function serviceStopped(s: ServiceView): boolean {
  if (s.health === "stopped" || s.health === "stoppedIdle" || s.health === "crashLooped") return true;
  return !isSupervised(s) && s.health === "unreachable";
}

/**
 * How 删除 confirms: "armed" for a stopped, ephemeral (disposable, not pinned / kept) registration — removing it loses
 * only the registration; "dialog" for a running one (it is stopped) or a persistent / pinned one (its configuration).
 */
export function serviceDeleteLevel(s: ServiceView): "armed" | "dialog" {
  return s.lifetime === "ephemeral" && !s.pinned && serviceStopped(s) ? "armed" : "dialog";
}

/** The host's current record of `s` (null: not in the host's service list now). */
function currentService(s: ServiceView, hostId: string | undefined): ServiceView | null {
  return hostData(useApp.getState(), hostId ?? focusId())?.services?.find((x) => x.slug === s.slug) ?? null;
}

/**
 * 转为项目服务 / 转为个人服务 (cutex `services-project-scope`, owner): medium risk, so the row confirms in place
 * (armed). A record without a projectId picks the project in a submenu, the registrant's project first.
 */
export function serviceScopeEntries(s: ServiceView, t: T, sidebar: SidebarSnapshot | null | undefined, send: (patch: ServicePatch) => void, hostId = focusId()): MenuEntry[] {
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
      icon: createElement(EntityIcon, { entity: projectEntity(hostId, project) }),
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

/**
 * The hover of a service's 运行中 (state surfaces W11, owner-approved wording): it only says the process is alive
 * (a background program, `worker`) or the port answers (a web service), never that the service works. Null for the
 * other health states (their word says enough).
 */
export function serviceHealthHint(s: Pick<ServiceView, "runtime" | "health">): MessageKey | null {
  if (s.health !== "reachable") return null;
  return s.runtime === "worker" ? "services.health.reachable.workerTip" : "services.health.reachable.webTip";
}

/** A health word's hover: the word, then the W11 caveat where there is one. */
export function serviceHealthTitle(word: string, s: Pick<ServiceView, "runtime" | "health">, t: (key: MessageKey) => string): string {
  const hint = serviceHealthHint(s);
  return hint ? `${word}\n${t(hint)}` : word;
}
