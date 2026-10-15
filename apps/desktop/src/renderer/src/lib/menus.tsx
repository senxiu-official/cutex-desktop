// Menu item builders (DESIGN §4.12). Each surface — sidebar row, project header, message, tool
// row, file link / tree / changes entry, side-pane tab — gets one builder shared by its
// right-click menu and its hover "⋯" button.
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  BatteryWarning,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCopy,
  Copy,
  FileDiff,
  FileText,
  FolderKanban,
  FolderOpen,
  GitFork,
  Hash,
  History,
  Hourglass,
  MailCheck,
  MessageSquareQuote,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Power,
  RotateCw,
  StickyNote,
  Wrench,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import type { SessionResource } from "@cutex-desktop/protocol";
import { translate, type MessageKey } from "../i18n";
import { agentHost, featuresOf, hostApi, pinnedOn, sidebarOf, useApp, viewHostOf } from "../store";
import type { FileRef } from "./workspace";
import { apiFor } from "../bridge";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { agentInfoDialog, confirmDialog, noticeDialog, promptDialog, type MenuAction, type MenuEntry } from "./contextMenu";
import { refActionEntries } from "./refActions";
import { agentRef } from "./refs";
import { AVATAR_COLOR_FEATURE, agentInfoPatch } from "./avatar";
import { realAgentName } from "./agentAlias";
import { fieldsUnchanged, isRevisionConflict } from "./metadataRetry";
import { refusalText } from "./profileCreate";
import { lacks } from "./agentFeatures";
import { agentFeaturesFor } from "./agentFeaturesView";
import { structuralBlockFor, structuralBlockText, structuralErrorText } from "./structuralGateView";
import { markSeenOn, turnMarksOn } from "./turnUnread";
import { parseUnsupported } from "../../../shared/unsupported";
import { unsupportedNotice } from "../store";
import { captureHostAction } from "./hostSwitch";
import { archivedProjectOf } from "./archivedAgent";
// Cycle by design (projectArchive reuses retireAgent / restoreArchived); both only call each other at run time.
import { restoreWithDirector } from "./projectArchive";
import { openFile, openGitDiff, openSide } from "./sideOpen";
import { FILES_COMPONENT } from "./sideKinds";
import { OWNER_ROTATION_FEATURE } from "../../../shared/directorRotation";
import type { MutationResult } from "../../../shared/ipc";
import { asksPauseKind } from "./stopHold";
import { loadQuotaContinue, quotaContinueNow, setQuotaContinue } from "./quotaContinue";
import { isOwnerFeatures } from "../../../shared/users";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
const ICON = 14;

export function copyText(text: string): void {
  void navigator.clipboard.writeText(text);
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // "Not available for this agent" is a notice, not a failure dialog.
  const feature = parseUnsupported(message);
  if (feature !== null) return useApp.getState().notify(unsupportedNotice(feature));
  // So is a busy Claude agent's refusal of fork / revert (it got busy after the menu opened).
  const structural = structuralErrorText(error);
  if (structural.refused) return useApp.getState().notify(structural.text);
  // Surface failures without a toast system yet.
  window.alert(message);
}

const guarded = (fn: () => Promise<unknown>) => () => void fn().catch(reportError);

/** cutex capabilities behind the session lifecycle items. */
export const SESSION_FEATURES = { fork: "session-fork", delete: "session-delete", deleteEmpty: "session-delete-empty-on-archive", revert: "session-history-revert" } as const;

const focusHost = () => useApp.getState().hosts?.active ?? "local";

/**
 * The fence of an action on `host`'s agent: the focus host's switch epoch, or that host's own epoch
 * (another host of the scope: its menus act on it in place, multi-host P1).
 */
const fenceOf = (host: string) => captureHostAction(host === focusHost() ? undefined : host);

/** The default host of a session helper: the host of its open view, else the focus host. */
const hostOfSession = (session: Pick<SessionResource, "cutexSessionId">) => viewHostOf(session.cutexSessionId);

/** Retire without asking (the caller confirmed: the agent menu, `/archive`, 归档项目 + 主管); with `archiveDeleteEmpty` cutex may delete an empty session instead (`{deleted:true}`). */
export async function retireAgent(session: SessionResource, t: T, host: string): Promise<void> {
  const current = fenceOf(host);
  const app = useApp.getState();
  const r = (await app.sessionAction(session.cutexSessionId, "cutex/session/retire", { reason: "desktop", expectedRevision: session.revision, expectedRuntimeGeneration: session.runtime.runtimeGeneration }, host)) as { deleted?: boolean } | null;
  if (!current()) return;
  if (r?.deleted) {
    const s = useApp.getState();
    if (s.selectedId === session.cutexSessionId && agentHost(s) === host) useApp.setState({ selectedId: null });
    app.notify(t("menu.archivedDeletedEmpty", { name: session.displayName }));
  }
}

/** Permanent delete after a confirmation; cutex's refusal reasons are shown in readable form. */
export async function deleteAgent(session: SessionResource, t: T, host = hostOfSession(session)): Promise<boolean> {
  const current = fenceOf(host);
  const expectedRevision = session.revision;
  const busy = !!session.runtime.activeTurnId;
  if (!(await confirmDialog(t(busy ? "menu.deleteConfirmBusy" : "menu.deleteConfirm", { name: session.displayName }), true))) return false;
  if (!current()) return false;
  return deleteAgentNow(session, t, expectedRevision, host);
}

/** Permanent delete without asking (the caller confirmed, e.g. a click-twice button). */
export async function deleteAgentNow(session: SessionResource, t: T, expectedRevision = session.revision, host = hostOfSession(session)): Promise<boolean> {
  const result = await deleteAgentResult(session, t, expectedRevision, host);
  if (!result) return false;
  if (!result.ok) {
    await noticeDialog(refusalText(result.error, t));
    return false;
  }
  return true;
}

/**
 * deleteAgentNow for a caller that shows the refusal itself (null: the host changed meanwhile).
 * No `expectedRevision`: cutex deletes the current revision (agents the desktop doesn't list).
 */
export async function deleteAgentResult(session: Pick<SessionResource, "cutexSessionId" | "displayName">, t: T, expectedRevision?: number, host = hostOfSession(session)): Promise<MutationResult | null> {
  const current = fenceOf(host);
  const app = useApp.getState();
  const result = await app.deleteSession(session.cutexSessionId, expectedRevision, host);
  if (!current()) return null;
  if (result.ok) app.notify(t("menu.deleted", { name: session.displayName }));
  return result;
}

const projectRestores = new Map<string, Promise<unknown>>();

/**
 * Restore an archived agent. Its project is restored first when that is archived too (see
 * lib/archivedAgent.ts); `withProject: false` restores only the agent. `host`: the agent's host.
 */
export async function restoreArchived(session: SessionResource, withProject = true, host = hostOfSession(session)): Promise<void> {
  const current = fenceOf(host);
  const app = useApp.getState();
  const project = withProject ? archivedProjectOf(session, sidebarOf(app, host)?.projects) : null;
  if (project) {
    // Bulk restores (全部 agent dialog) run in parallel: one project restore per project revision.
    const key = `${host}|${project.id}@${project.expected.authorityEpoch}.${project.expected.projectRevision}`;
    let pending = projectRestores.get(key);
    if (!pending) {
      pending = hostApi(host).projectMutation(project.id, project.expected, { kind: "restore" });
      projectRestores.set(key, pending);
      pending.catch(() => projectRestores.delete(key));
    }
    await pending;
  }
  if (!current()) return;
  await app.sessionAction(session.cutexSessionId, "cutex/session/restore", undefined, host);
}

/** Archiving an agent that owns services: name them so the owner can reassign later. */
export function ownedServicesNote(id: string, t: T, host: string): string {
  const app = useApp.getState();
  const services = host === focusHost() ? app.services : app.byHost[host]?.services;
  const owned = (services ?? []).filter((s) => s.ownerCutexSessionId === id);
  if (owned.length === 0) return "";
  return t("menu.archiveOwnsServices", { n: owned.length, names: owned.map((s) => s.displayName || s.slug).join("、") });
}

/** Rename (menu + `/rename`): `name` given → set it directly, else ask. Empty = back to the default. */
export async function renameAgent(session: SessionResource, t: T, name?: string | null, host = hostOfSession(session)): Promise<void> {
  const current = fenceOf(host);
  const next = name ?? (await promptDialog(t("menu.rename"), session.displayNameOverride ?? session.displayName, { placeholder: session.formalAgentName ?? undefined }));
  if (next === null || !current()) return;
  await updateMetadata(session, host, { displayName: next.trim() || null }, { displayNameOverride: session.displayNameOverride ?? null });
}

/**
 * One metadata update fenced by the revision the dialog started from. A revision conflict caused by
 * something else (a turn, a status change) is retried once against the fresh session when the
 * fields being changed (`before`, resource field names) still hold what the dialog showed.
 */
async function updateMetadata(session: SessionResource, host: string, patch: Record<string, unknown>, before: Record<string, unknown>): Promise<void> {
  const app = useApp.getState();
  const id = session.cutexSessionId;
  try {
    await app.sessionAction(id, "cutex/session/metadata/update", { ...patch, expectedRevision: session.revision }, host);
  } catch (error) {
    if (!isRevisionConflict(error)) throw error;
    await app.refreshHostSidebar(host);
    const sidebar = sidebarOf(useApp.getState(), host);
    const fresh = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === id);
    if (!fresh || !fieldsUnchanged(before, fresh as unknown as Record<string, unknown>)) throw new Error(translate("menu.metadataConflict"));
    await app.sessionAction(id, "cutex/session/metadata/update", { ...patch, expectedRevision: fresh.revision }, host);
  }
}

/** 编辑信息: 显示名 + avatar + note in one dialog, one metadata update with only what changed. */
async function editAgentInfo(session: SessionResource, host: string): Promise<void> {
  const current = fenceOf(host);
  const app = useApp.getState();
  const features = featuresOf(app, host);
  const style = sidebarOf(app, host)?.hostRows[session.cutexSessionId]?.profileStyle as { color?: unknown } | null | undefined;
  const editName = features.has("session-metadata");
  const before = { avatar: session.avatar ?? null, note: session.note ?? null, ...(editName ? { displayName: session.displayNameOverride ?? null } : {}) };
  const options = { realName: realAgentName(session), combineColor: features.has(AVATAR_COLOR_FEATURE), editName };
  const after = await agentInfoDialog(session.displayName, typeof style?.color === "string" ? style.color : null, session.cutexSessionId, before, options);
  if (!after || !current()) return;
  const patch = agentInfoPatch(before, after);
  if (Object.keys(patch).length) await updateMetadata(session, host, patch, { avatar: before.avatar, note: before.note, displayNameOverride: session.displayNameOverride ?? null });
}

/** Archive with the same confirmation as the menu item (`/archive`); false when cancelled. */
export async function archiveAgent(session: SessionResource, t: T, host = hostOfSession(session)): Promise<boolean> {
  const current = fenceOf(host);
  const id = session.cutexSessionId;
  const busy = !!session.runtime.activeTurnId;
  const message = [t(busy ? "menu.archiveConfirmBusy" : "menu.archiveConfirm", { name: session.displayName }), ownedServicesNote(id, t, host)].filter(Boolean).join("\n\n");
  if (!(await confirmDialog(message, true))) return false;
  if (!current()) return false;
  await retireAgent(session, t, host);
  return current();
}

type ClaudeTool = "claudeAllowWrite" | "claudeAllowExec";

/** A Claude session's own tool switch (claude-tools-settings); null for other sessions / older cutex. */
function claudeTool(session: SessionResource, key: ClaudeTool): boolean | null {
  const value = session.runtimeDefaults?.[key];
  return typeof value === "boolean" ? value : null;
}

/** Flip one Claude tool; it applies at the next start, so an online session offers a restart. */
async function toggleClaudeTool(session: SessionResource, key: ClaudeTool, t: T, host: string): Promise<void> {
  const current = fenceOf(host);
  const app = useApp.getState();
  const id = session.cutexSessionId;
  await app.sessionAction(id, "cutex/session/defaults/update", { patch: { [key]: !claudeTool(session, key) } }, host);
  if (!current() || session.runtime.status !== "online") return;
  const busy = !!session.runtime.activeTurnId;
  if (!(await confirmDialog(t(busy ? "menu.claudeToolsRestartBusy" : "menu.claudeToolsRestart", { name: session.displayName }), busy))) return;
  if (!current()) return;
  await app.sessionAction(id, "cutex/runtime/offline", undefined, host);
  if (!current()) return;
  await app.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false }, host);
}

function claudeToolsItem(session: SessionResource, t: T, host: string): MenuEntry {
  const write = claudeTool(session, "claudeAllowWrite");
  const exec = claudeTool(session, "claudeAllowExec");
  if (write === null || exec === null) return null;
  const state = (on: boolean) => (on ? t("menu.on") : t("menu.off"));
  return {
    label: t("menu.claudeTools"),
    icon: <Wrench size={ICON} />,
    onSelect: () => {},
    submenu: [
      { label: t("menu.claudeWrite"), hint: state(write), onSelect: guarded(() => toggleClaudeTool(session, "claudeAllowWrite", t, host)) },
      { label: t("menu.claudeExec"), hint: state(exec), onSelect: guarded(() => toggleClaudeTool(session, "claudeAllowExec", t, host)) },
    ],
  };
}

/**
 * 额度用完后自动继续 开 / 关 (cutex claude-quota-auto-continue, lib/quotaContinue) for a Claude agent on a
 * host that has it. The menu shows the cached switch (default on) and loads the agent's state for the
 * next open; a flip reads the current state first.
 */
function quotaContinueItem(session: SessionResource, t: T, host: string): MenuEntry {
  const view = quotaContinueNow(host, session);
  if (!view) return null;
  const id = session.cutexSessionId;
  void loadQuotaContinue(host, id);
  return {
    label: t("quotaContinue.menu"),
    icon: <BatteryWarning size={ICON} />,
    hint: view.enabled ? t("menu.on") : t("menu.off"),
    title: t("quotaContinue.menuHint"),
    onSelect: guarded(async () => {
      await loadQuotaContinue(host, id);
      const current = quotaContinueNow(host, session) ?? view;
      await setQuotaContinue(host, id, !current.enabled);
    }),
  };
}

/**
 * 启动运行时 / 停止运行时 for an active agent (null while starting or archived). Shared by the
 * agent menu and the title bar's runtime button; run it with runAction so the confirmation applies.
 */
export function runtimeItem(session: SessionResource, t: T, host = hostOfSession(session)): MenuAction | null {
  const app = useApp.getState();
  // users: starting / stopping a runtime is the host owner's (also hides the title bar's ⏻).
  if (!isOwnerFeatures(featuresOf(app, host))) return null;
  const id = session.cutexSessionId;
  const status = session.runtime.status;
  if (session.lifecycle === "retired" || status === "starting") return null;
  if (status !== "online") {
    // The desktop is the front end: no "attach from a terminal" step.
    return { label: t("menu.start"), icon: <Power size={ICON} />, onSelect: guarded(() => app.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false }, host)) };
  }
  const busy = !!session.runtime.activeTurnId;
  return {
    label: t("menu.stop"),
    icon: <Power size={ICON} />,
    armed: t(busy ? "menu.stopArmedBusy" : "menu.stopArmed"),
    danger: busy,
    onSelect: guarded(() => app.sessionAction(id, "cutex/runtime/offline", { expectedRuntimeGeneration: session.runtime.runtimeGeneration }, host)),
  };
}

/** 重启运行时 for an online agent (stop, then start; click twice, the armed text warns when busy). */
function restartItem(session: SessionResource, t: T, host: string): MenuAction | null {
  if (session.lifecycle === "retired" || session.runtime.status !== "online") return null;
  const id = session.cutexSessionId;
  const busy = !!session.runtime.activeTurnId;
  return {
    label: t("menu.restart"),
    icon: <RotateCw size={ICON} />,
    armed: t(busy ? "menu.restartArmedBusy" : "menu.restartArmed"),
    danger: busy,
    onSelect: guarded(async () => {
      const current = fenceOf(host);
      const app = useApp.getState();
      await app.sessionAction(id, "cutex/runtime/offline", { expectedRuntimeGeneration: session.runtime.runtimeGeneration }, host);
      if (!current()) return;
      await app.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false }, host);
    }),
  };
}

/**
 * The agent menu (sidebar row, title bar, 全部 agent dialog). `hostId`: the agent's host (default: the
 * host of its open view, else the focus host). Another host's agent gets the same actions, sent to
 * that host's daemon (multi-host P1).
 */
export function agentMenu(session: SessionResource, t: T, hostId?: string): MenuEntry[] {
  const app = useApp.getState();
  const id = session.cutexSessionId;
  const host = hostId ?? viewHostOf(id);
  const focus = host === focusHost();
  const features = featuresOf(app, host);
  const retired = session.lifecycle === "retired";
  const busy = !!session.runtime.activeTurnId;
  const pinned = (focus ? app.pinned : pinnedOn(host)).has(id);
  const canDelete = features.has(SESSION_FEATURES.delete);
  // 暂停委托 / 继续委托 (asks-pause-v2): the explicit owner pause of new delegations to this agent. It
  // reads / patches the store's agent view, so only for the agent the view belongs to (or a focus agent).
  const ownView = viewHostOf(id) === host;
  const asksPaused = ownView && !!app.sessions[id]?.asksPaused;
  // 已随停止暂停 (stop-holds-ridealongs, lib/stopHold): 继续发送 (queue resume releases the stop hold).
  const stopOnly = ownView && asksPauseKind(app.sessions[id]?.asksPaused) === "stop";
  // A closed runtime gate (runtime-gate-pause): 恢复输入 = asks resume (reopens the gate).
  const gate = ownView && asksPauseKind(app.sessions[id]?.asksPaused) === "gate";
  const asksPauseItem: MenuAction | false = !retired && ownView && features.has("asks-pause-v2") && {
    label: t(stopOnly ? "paused.resume" : gate ? "asksPause.gateResumeMenu" : asksPaused ? "asksPause.resume" : "asksPause.pause"),
    icon: <Hourglass size={ICON} />,
    onSelect: guarded(() => (stopOnly ? app.resumePaused(id) : asksPaused ? app.resumeAsks(id) : app.pauseAsks(id))),
  };
  // 轮换主管… (owner-rotation): the Director of an active project; the dialog lives on the project page,
  // whose rotation store follows the focus host only.
  const directs = !retired && focus && features.has(OWNER_ROTATION_FEATURE) ? sidebarOf(app, host)?.projects?.projects.find((p) => p.director_cutex_session_id === id) : undefined;
  const rotateItem: MenuAction | false = !!directs && {
    label: t("projects.rotation.menu"),
    icon: <ArrowRightLeft size={ICON} />,
    onSelect: () => app.openPage("projects.page", { project: directs.project_id, tab: "agents", rotate: "1" }),
  };
  const archiveItem: MenuAction = {
    label: t("menu.archive"),
    icon: <Archive size={ICON} />,
    danger: true,
    confirm: [t(busy ? "menu.archiveConfirmBusy" : "menu.archiveConfirm", { name: session.displayName }), ownedServicesNote(id, t, host)].filter(Boolean).join("\n\n"),
    onSelect: guarded(() => retireAgent(session, t, host)),
  };
  // Confirms itself (deleteAgent), so the refusal can follow in the same flow.
  const deleteItem: MenuAction = { label: t("menu.delete"), icon: <Trash2 size={ICON} />, danger: true, onSelect: guarded(() => deleteAgent(session, t, host)) };
  // 标为已读: a done / failed turn mark on this host (lib/turnUnread; the same clear as opening it).
  const unread = id in turnMarksOn(host);
  // 分叉为新 agent (from the latest turn): store.forkSession routes by the open view's host, so only
  // for an agent whose view belongs to `host`; a busy Claude agent refuses (lib/structuralGate).
  const canFork = !retired && ownView && features.has(SESSION_FEATURES.fork) && !lacks(agentFeaturesFor(id), "fork");
  const block = canFork ? structuralBlockFor(id) : null;
  const projectId = sidebarOf(app, host)?.hostRows[id]?.projectId ?? null;
  // users: on a host where this device is not the owner, only this device's own view actions remain
  // (pin, read mark, open project, copy, module ref actions); everything that changes the agent is the owner's.
  if (!isOwnerFeatures(features)) {
    return [
      !retired && { label: pinned ? t("menu.unpin") : t("menu.pin"), icon: pinned ? <PinOff size={ICON} /> : <Pin size={ICON} />, onSelect: () => app.togglePin(id, host) },
      unread && { label: t("menu.markRead"), icon: <MailCheck size={ICON} />, onSelect: () => markSeenOn(host, id) },
      projectId && { label: t("menu.openProject"), icon: <FolderKanban size={ICON} />, onSelect: () => app.openPage("projects.page", { project: projectId, ...(focus ? {} : { host }) }) },
      {
        label: t("menu.copy"),
        icon: <Copy size={ICON} />,
        onSelect: () => {},
        submenu: [
          { label: t("menu.copyName"), icon: <Type size={ICON} />, onSelect: () => copyText(realAgentName(session)) },
          { label: t("menu.copyId"), icon: <Hash size={ICON} />, onSelect: () => copyText(id) },
        ],
      },
      ...refActionEntries(agentRef(host, id, session.displayName), true),
    ];
  }
  return [
    !retired && { label: pinned ? t("menu.unpin") : t("menu.pin"), icon: pinned ? <PinOff size={ICON} /> : <Pin size={ICON} />, onSelect: () => app.togglePin(id, host) },
    {
      label: t("menu.rename"),
      icon: <Pencil size={ICON} />,
      onSelect: guarded(() => renameAgent(session, t, undefined, host)),
    },
    { label: t("menu.editInfo"), icon: <StickyNote size={ICON} />, onSelect: guarded(() => editAgentInfo(session, host)) },
    unread && { label: t("menu.markRead"), icon: <MailCheck size={ICON} />, onSelect: () => markSeenOn(host, id) },
    "separator",
    !retired && {
      label: t("menu.openFiles"),
      icon: <FolderOpen size={ICON} />,
      onSelect: async () => {
        await app.openAgent(id, host);
        openSide(FILES_COMPONENT, {}, { focus: true });
      },
    },
    projectId && { label: t("menu.openProject"), icon: <FolderKanban size={ICON} />, onSelect: () => app.openPage("projects.page", { project: projectId, ...(focus ? {} : { host }) }) },
    canFork && {
      label: t("menu.forkAgent"),
      icon: <GitFork size={ICON} />,
      ...(block ? { disabled: true, hint: t("structural.busyHint"), title: structuralBlockText(block) } : {}),
      onSelect: guarded(() => app.forkSession(id, null)),
    },
    {
      label: t("menu.copy"),
      icon: <Copy size={ICON} />,
      onSelect: () => {},
      submenu: [
        { label: t("menu.copyName"), icon: <Type size={ICON} />, onSelect: () => copyText(realAgentName(session)) },
        session.cwd && { label: t("menu.copyCwd"), icon: <ClipboardCopy size={ICON} />, onSelect: () => copyText(session.cwd!) },
        { label: t("menu.copyId"), icon: <Hash size={ICON} />, onSelect: () => copyText(id) },
      ],
    },
    !retired && claudeToolsItem(session, t, host),
    !retired && quotaContinueItem(session, t, host),
    asksPauseItem,
    rotateItem,
    // The modules' `ref.action` items for the agent (§19.8).
    ...refActionEntries(agentRef(host, id, session.displayName), true),
    "separator",
    runtimeItem(session, t, host),
    restartItem(session, t, host),
    retired && { label: t("menu.restore"), icon: <ArchiveRestore size={ICON} />, onSelect: guarded(() => restoreWithDirector(session, t, host)) },
    retired && canDelete && deleteItem,
    // 归档 stays a plain, clickable row; 删除… sits one level down under 更多 › (a row with "›" reads
    // as a pure submenu, so it never doubles as an action).
    !retired && archiveItem,
    !retired && canDelete && { label: t("menu.more"), icon: <MoreHorizontal size={ICON} />, onSelect: () => {}, submenu: [deleteItem] },
  ];
}

export interface MessageMenuInput {
  sessionId: string;
  kind: "user" | "agent" | "received" | "sent";
  text: string;
  turnId: string | null;
  /** Agent replies: the turn after this one ("回退到这里" reverts from it) and how many turns that drops. */
  nextTurnId?: string | null;
  laterTurns?: number;
  /** Long-message folding: the current state and its toggle (null = nothing to fold). */
  fold?: { folded: boolean; toggle(): void } | null;
}

/** `text` as a Markdown quote for the composer. */
export function quoteText(text: string): string {
  return `${text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}\n\n`;
}

export function messageMenu(m: MessageMenuInput, t: T, canRevert: boolean): MenuEntry[] {
  const app = useApp.getState();
  const canFork = app.features.has(SESSION_FEATURES.fork) && !lacks(agentFeaturesFor(m.sessionId), "fork");
  // A busy Claude agent refuses fork / revert (lib/structuralGate): offered disabled, with the reason.
  const block = structuralBlockFor(m.sessionId);
  const blocked = block ? { disabled: true, hint: t("structural.busyHint"), title: structuralBlockText(block) } : {};
  return [
    { label: t("menu.copy"), icon: <Copy size={ICON} />, onSelect: () => copyText(m.text) },
    { label: t("menu.quote"), icon: <MessageSquareQuote size={ICON} />, onSelect: () => app.insertIntoComposer(m.sessionId, quoteText(m.text), "append") },
    m.fold && { label: t(m.fold.folded ? "fold.unfold" : "fold.fold"), icon: m.fold.folded ? <ChevronsUpDown size={ICON} /> : <ChevronsDownUp size={ICON} />, onSelect: m.fold.toggle },
    m.kind === "user" && "separator",
    m.kind === "user" && {
      label: t("menu.editResend"),
      icon: <Undo2 size={ICON} />,
      hint: canRevert ? undefined : "·",
      disabled: !canRevert || !m.turnId,
      confirm: t("menu.editResendConfirm"),
      onSelect: guarded(() => app.editAndResend(m.sessionId, m.turnId!, m.text)),
      ...(canRevert ? blocked : {}),
    },
    m.kind === "agent" && "separator",
    // Fork is non-destructive (a new agent): no confirmation. Revert rewrites this agent's history.
    m.kind === "agent" && {
      label: t("menu.fork"),
      icon: <GitFork size={ICON} />,
      hint: canFork ? undefined : "·",
      disabled: !canFork || !m.turnId,
      onSelect: guarded(() => app.forkSession(m.sessionId, m.turnId)),
      ...(canFork ? blocked : {}),
    },
    m.kind === "agent" &&
      canRevert &&
      m.nextTurnId && {
        label: t("reply.revert"),
        icon: <History size={ICON} />,
        danger: true,
        confirm: t("menu.revertConfirm", { n: m.laterTurns ?? 0 }),
        onSelect: guarded(() => app.revertTo(m.sessionId, m.nextTurnId!)),
        ...blocked,
      },
  ];
}

export function toolMenu(item: { type: string; command?: unknown; aggregatedOutput?: unknown }, files: { path: string }[], t: T): MenuEntry[] {
  const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : null;
  return [
    item.type === "commandExecution" && { label: t("menu.copyCommand"), icon: <Copy size={ICON} />, onSelect: () => copyText(String(item.command ?? "")) },
    output && { label: t("menu.copyOutput"), icon: <ClipboardCopy size={ICON} />, onSelect: () => copyText(output) },
    files.length > 0 && "separator",
    ...files.slice(0, 8).map((f) => ({ label: f.path, icon: <FileText size={ICON} />, onSelect: () => void openFile(f.path) })),
  ];
}

/** Workspace file (relative path) — file links, tool rows, file tree, changes list. */
export function fileMenu(path: string, root: string | null, t: T, opts: { changed?: boolean; isDir?: boolean } = {}): MenuEntry[] {
  const app = useApp.getState();
  const abs = root ? `${root.replace(/[\\/]+$/, "")}${root.includes("\\") ? "\\" : "/"}${root.includes("\\") ? path.replace(/\//g, "\\") : path}` : null;
  const sessionId = app.selectedId;
  return [
    !opts.isDir && { label: t("menu.preview"), icon: <FileText size={ICON} />, onSelect: () => void openFile(path) },
    opts.changed && { label: t("menu.showDiff"), icon: <FileDiff size={ICON} />, onSelect: () => void openGitDiff(path) },
    "separator",
    { label: t("menu.copyRelPath"), icon: <Copy size={ICON} />, onSelect: () => copyText(path) },
    abs && { label: t("menu.copyAbsPath"), icon: <ClipboardCopy size={ICON} />, onSelect: () => copyText(abs) },
    sessionId && { label: t("menu.mention"), icon: <MessageSquareQuote size={ICON} />, onSelect: () => app.insertIntoComposer(sessionId, `\`${path}\` `, "append") },
  ];
}

/**
 * A file link outside what the workspace `fs/file` serves (outside the agent's root, no known
 * root, `~` with an unknown home): the full path, copy, "show in folder" on the local host only,
 * and with `preview` (cutex fs-file-read, an absolute path) the side-pane preview by host path.
 */
export function outsideFileMenu(ref: FileRef, full: string, remote: boolean, t: T, preview?: (() => void) | null): MenuEntry[] {
  const app = useApp.getState();
  const sessionId = app.selectedId;
  const path = ref.abs ?? ref.path;
  return [
    { label: full, hint: t(preview ? "menu.fileOutsideWorkspaceHost" : "menu.fileOutsideWorkspace"), note: true, disabled: true, onSelect: () => {} },
    "separator",
    preview && { label: t("menu.preview"), icon: <FileText size={ICON} />, onSelect: preview },
    { label: t("menu.copyPath"), icon: <Copy size={ICON} />, onSelect: () => copyText(path) },
    ref.line != null && { label: t("menu.copyPathLine"), icon: <ClipboardCopy size={ICON} />, onSelect: () => copyText(full) },
    !remote && ref.abs && { label: t("menu.revealPath"), icon: <FolderOpen size={ICON} />, onSelect: guarded(() => apiFor(LOCAL_HOST_ID).revealPath(path)) },
    sessionId && { label: t("menu.mention"), icon: <MessageSquareQuote size={ICON} />, onSelect: () => app.insertIntoComposer(sessionId, `\`${path}\` `, "append") },
  ];
}
