import { requestFork } from "./requestFork";
import { isHostBusyActionPending } from "./hostBusyActions";
import { mentionPlainText } from "./mentionWire";
import { agentToolGateNow, agentPauseNow, agentPauseSupported, pauseAgent, resumeAgent } from "./agentPause";
import { canRevealLocal, downloadFileAction, fileActions, performFilePathAction, revealFileLabel } from "./fileActions";
// Menu item builders (DESIGN §4.12). Each surface — sidebar row, project header, message, tool
// row, file link / tree / changes entry, side-pane tab — gets one builder shared by its
// right-click menu and its hover "⋯" button.
import {
  Archive,
  CirclePause,
  Play,
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
  LocateFixed,
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
  ExternalLink,
  FileClock,
  CircleArrowUp,
  CircleDot,
  SlidersHorizontal,
  Plug,
  Smile,
  AppWindow,
  Bot,
} from "lucide-react";
import { desksEnabled } from "./deskWindows";
import { openInNewDesk, openInWindow, windowChoices } from "./deskActions";
import { MAIN_WINDOW } from "./windowScope";
import type { SessionBadge, SessionAvatar, SessionResource } from "@cutex-desktop/protocol";
import { translate, type MessageKey } from "../i18n";
import { agentHost, featuresOf, hostApi, pinnedOn, sidebarOf, useApp, viewHostOf, viewOf } from "../store";
import type { FileRef } from "./workspace";
import { apiFor } from "../bridge";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { MEMORY_INJECTION_FEATURE, memoryInjectionOf } from "../../../shared/memoryInjection";
import { promoteOffered } from "./quickChatPromote";
import { agentInfoDialog, agentMcpDialog, promoteChatDialog, confirmDialog, noticeDialog, promptDialog, type MenuAction, type MenuEntry } from "./contextMenu";
import { showsAgentMcp } from "./agentMcp";
import { refActionEntries } from "./refActions";
import { agentRef } from "./refs";
import { AVATAR_COLOR_FEATURE, agentInfoPatch, isHexColor } from "./avatar";
import { realAgentName } from "./agentAlias";
import { canRenameFormal, restoreError, RestoreNameError, sessionOf } from "./agentRename";
import { writeMetadataRetrying } from "./metadataRetry";
import { holdMetadata, releaseMetadata, serverView } from "./pendingMetadata";
import { refusalText } from "./profileCreate";
import { agentFeaturesOf, canRewindFiles, lacks } from "./agentFeatures";
import { agentFeaturesFor } from "./agentFeaturesView";
import { revertTexts } from "./runtimeWording";
import type { StructuralOp } from "./structuralGate";
import { structuralBlockFor, structuralBlockText, structuralErrorText } from "./structuralGateView";
import { markSeenOn, turnMarksOn } from "./turnUnread";
import { parseUnsupported } from "../../../shared/unsupported";
import { unsupportedNotice } from "../store";
import { captureHostAction } from "./hostSwitch";
import { archivedProjectOf } from "./archivedAgent";
// Cycle by design (projectArchive reuses retireAgent / restoreArchived); both only call each other at run time.
import { restoreWithDirector } from "./projectArchive";
import { openGitDiff, openPath, openSide, revealInTree } from "./sideOpen";
import { FILES_COMPONENT } from "./sideKinds";
import { OWNER_ROTATION_FEATURE } from "../../../shared/directorRotation";
import { FORK_PROFILE_FEATURE } from "../../../shared/sessionFork";
import type { MutationResult } from "../../../shared/ipc";
import { asksPauseKind } from "./stopHold";
import { loadQuotaContinue, quotaContinueNow, setQuotaContinue } from "./quotaContinue";
import { isOwnerFeatures } from "../../../shared/users";
import { runtimeStartSince } from "./runtimeStart";
import { repinApplies, repinMenuOffer, runRepinFlow } from "./claudeRepin";
import { avatarSwitchOf, hiddenAvatar, shownAvatar } from "./avatarDefault";
import { themedEmoji } from "./avatarThemes";
import { agentIndex, agentThemesNow } from "./agentLook";
import { getUiPrefs } from "./prefs";
import { shownStyleAvatar } from "./avatarStyleAssign";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
const ICON = 14;

export function copyText(text: string): void {
  void navigator.clipboard.writeText(text);
}

function reportError(error: unknown): void {
  if (isHostBusyActionPending(error)) return; // the persistent action row owns its retry button
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
  if (lacks(agentFeaturesOf(session), "threadDelete")) return false;
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
  try {
    await app.sessionAction(session.cutexSessionId, "cutex/session/restore", undefined, host);
  } catch (error) {
    throw restoreError(error, host, session);
  }
}

/**
 * Restore refused because its own name is taken / reserved now: say so and offer 改名… (编辑信息…, where an
 * archived agent can be renamed in place); it stays archived until the owner restores it again. Other errors pass.
 */
export async function offerRenameAfterRestore(error: unknown, t: T): Promise<void> {
  if (!(error instanceof RestoreNameError)) throw error;
  if (error.block.renameRequired === false) { await noticeDialog(error.message); return; }
  const fresh = sessionOf(error.host, error.session.cutexSessionId) ?? error.session;
  if (await confirmDialog(error.message, false, { ok: t("rename.restoreRename"), cancel: t("dialog.cancel") })) await editAgentInfo(fresh, error.host);
}

/** Archiving an agent that owns services: name them so the owner can reassign later. */
export function ownedServicesNote(id: string, t: T, host: string): string {
  const app = useApp.getState();
  const services = host === focusHost() ? app.services : app.byHost[host]?.services;
  const owned = (services ?? []).filter((s) => s.ownerCutexSessionId === id);
  if (owned.length === 0) return "";
  return t("menu.archiveOwnsServices", { n: owned.length, names: owned.map((s) => s.displayName || s.slug).join("、") });
}

/**
 * 显示名称… (menu + `/rename`): `name` given → set it directly, else ask. Empty = back to the default.
 * Only displayNameOverride changes: cutex lists and addresses an agent by its formal name (agent_list, short ids,
 * bus headers fall back to the override only when there is no formal name), so the dialog says which case this is.
 */
export async function renameAgent(session: SessionResource, t: T, name?: string | null, host = hostOfSession(session)): Promise<void> {
  const current = fenceOf(host);
  const formal = session.formalAgentName?.trim() || null;
  const hint = formal ? t("menu.displayNameHint", { name: formal }) : t("menu.displayNameHintNoFormal");
  const next = name ?? (await promptDialog(t("menu.displayName"), session.displayNameOverride ?? session.displayName, { placeholder: formal ?? undefined, hint }));
  if (next === null || !current()) return;
  await updateMetadata(session, host, { displayName: next.trim() || null }, { displayNameOverride: session.displayNameOverride ?? null });
}

/** The session as the host has it now (the sidebar re-read; fields of a write in flight at cutex's values, lib/pendingMetadata). */
async function rereadSession(id: string, host: string): Promise<SessionResource | null> {
  await useApp.getState().refreshHostSidebar(host);
  const sidebar = sidebarOf(useApp.getState(), host);
  const row = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === id);
  return row ? serverView(row) : null;
}

/**
 * A metadata write the owner sees at once (note, badge: owner 2026-10-27 「设置徽章、备注很慢」): the new values are
 * drawn before cutex answers and kept over sidebar refreshes until the write settles (lib/pendingMetadata). On a
 * failure cutex's values come back and the promise rejects (the caller says why). Resolves when cutex has it and the
 * sidebar was read again (store sessionAction), like updateMetadata.
 */
async function updateMetadataNow(session: SessionResource, host: string, fields: Partial<SessionResource>): Promise<void> {
  const id = session.cutexSessionId;
  const app = useApp.getState();
  const current = [...(sidebarOf(app, host)?.active ?? []), ...(sidebarOf(app, host)?.retired ?? [])].find((r) => r.cutexSessionId === id) ?? session;
  const before = serverView(current) as unknown as Record<string, unknown>;
  const token = holdMetadata(id, fields, serverView(current));
  app.patchSessionResource(id, host, fields);
  try {
    await updateMetadata(session, host, fields, Object.fromEntries(Object.keys(fields).map((k) => [k, before[k] ?? null])));
    releaseMetadata(id, token);
  } catch (error) {
    useApp.getState().patchSessionResource(id, host, releaseMetadata(id, token) as Partial<SessionResource>);
    throw error;
  }
}

/**
 * One metadata update fenced by the revision the dialog started from. A conflict caused by something
 * else (a turn or a status change moving the session revision, another writer winning cutex's store
 * CAS) is retried against the fresh session while the fields being changed (`before`, resource field
 * names) still hold what the dialog showed (lib/metadataRetry).
 */
async function updateMetadata(session: SessionResource, host: string, patch: Record<string, unknown>, before: Record<string, unknown>): Promise<void> {
  const id = session.cutexSessionId;
  await writeMetadataRetrying<SessionResource>({
    write: (fresh) => useApp.getState().sessionAction(id, "cutex/session/metadata/update", { ...patch, expectedRevision: (fresh ?? session).revision }, host),
    reread: () => rereadSession(id, host),
    before,
    fenced: true,
    changed: () => new Error(translate("menu.metadataConflict")),
  });
}

/** Tray's small editor uses exactly the same field-level fence and conflict refresh as 编辑信息. */
export async function updateAgentBadge(session: SessionResource, host: string, badge: SessionBadge | null): Promise<void> {
  const features = featuresOf(useApp.getState(), host);
  if (!features.has("session-badge") || !isOwnerFeatures(features)) throw new Error(translate("menu.metadataConflict"));
  if (JSON.stringify(badge) === JSON.stringify(session.badge ?? null)) return;
  await updateMetadataNow(session, host, { badge });
}

/** 编辑信息: 显示名 + avatar + note in one dialog, one metadata update with only what changed. */
export async function editAgentInfo(session: SessionResource, host: string): Promise<void> {
  const current = fenceOf(host);
  const app = useApp.getState();
  const features = featuresOf(app, host);
  const style = sidebarOf(app, host)?.hostRows[session.cutexSessionId]?.profileStyle as { color?: unknown } | null | undefined;
  const editName = features.has("session-metadata");
  // agent-memory-injection: the switch rides along; it is a runtime default, saved apart from the metadata.
  const memory = features.has(MEMORY_INJECTION_FEATURE) && session.lifecycle !== "retired" ? memoryInjectionOf(session) : undefined;
  const before = { avatar: session.avatar ?? null, ...(features.has("session-avatar-mode") ? { avatarMode: session.avatarMode ?? null } : {}), note: session.note ?? null, ...(features.has("session-badge") ? { badge: session.badge ?? null } : {}), ...(editName ? { displayName: session.displayNameOverride ?? null } : {}) };
  const options = { editAvatarMode: features.has("session-avatar-mode"), realName: realAgentName(session), ownName: session.formalAgentName?.trim() || null, combineColor: features.has(AVATAR_COLOR_FEATURE), editName, editBadge: features.has("session-badge"),
    rename: canRenameFormal(features, session) ? { host, sessionId: session.cutexSessionId, revision: session.revision, archived: session.lifecycle === "retired" } : null };
  const after = await agentInfoDialog(session.displayName, typeof style?.color === "string" ? style.color : null, session.cutexSessionId, memory === undefined ? before : { ...before, memoryInjection: memory }, options);
  if (!after || !current()) return;
  const patch: Record<string, unknown> = agentInfoPatch(before, after);
  if ("avatar" in patch && !("avatarMode" in patch) && features.has("session-avatar-mode")) patch.avatarMode = "fixed";
  if (Object.keys(patch).length) {
    const fields: Record<string, unknown> = {};
    for (const field of Object.keys(patch)) fields[field === "displayName" ? "displayNameOverride" : field] = field === "displayName" ? session.displayNameOverride ?? null : before[field as keyof typeof before];
    await updateMetadata(session, host, patch, fields);
  }
  // Applies at the agent's next launch; no confirm (owner 2026-11-06).
  if (memory !== undefined && after.memoryInjection !== undefined && after.memoryInjection !== memory && current()) {
    await app.sessionAction(session.cutexSessionId, "cutex/session/defaults/update", { patch: { memoryInjection: after.memoryInjection } }, host);
  }
}

/**
 * 显示头像 / 隐藏头像 (默认头像 = 仅重要智能体): the owner's explicit, synced choice — writes the 拟人头像 of
 * the enabled themes for its model family (else the theme's default emoji) as the agent's cutex avatar, or clears it back to the dot. Needs `session-metadata`
 * (the avatar field of cutex/session/metadata/update); Directors / pinned agents and pictures get none.
 */
function avatarSwitchItem(session: SessionResource, t: T, host: string, features: ReadonlySet<string>, pinned: boolean): MenuAction | null {
  if (!features.has("session-metadata")) return null;
  const id = session.cutexSessionId;
  const isDirector = !!sidebarOf(useApp.getState(), host)?.projects?.projects.some((p) => p.director_cutex_session_id === id);
  const current = session.avatar ?? null;
  const which = avatarSwitchOf(getUiPrefs().agentAvatarDefault, { isDirector, pinned, avatar: current });
  if (!which) return null;
  const base = (): SessionAvatar => shownStyleAvatar(id, host) ?? { kind: "emoji", value: themedEmoji(id, agentThemesNow(id)).glyph };
  const avatar = which === "show" ? shownAvatar(base(), current, features.has(AVATAR_COLOR_FEATURE)) : hiddenAvatar(current);
  return {
    label: t(which === "show" ? "menu.showAvatar" : "menu.hideAvatar"),
    icon: which === "show" ? <Smile size={ICON} /> : <CircleDot size={ICON} />,
    onSelect: guarded(() => setAgentAvatar(session, host, avatar)),
  };
}

/** One avatar write through the same fenced metadata update as 编辑信息. */
export async function setAgentAvatar(session: SessionResource, host: string, avatar: SessionAvatar | null): Promise<void> {
  const capable = featuresOf(useApp.getState(), host).has("session-avatar-mode");
  await updateMetadata(session, host, { avatar, ...(capable ? { avatarMode: "fixed" } : {}) }, { avatar: session.avatar ?? null, avatarMode: session.avatarMode ?? null });
}

/** Explicit dynamic follow: the backend clears any stored avatar atomically. */
export async function followAgentProfile(session: SessionResource, host: string): Promise<void> {
  const features = featuresOf(useApp.getState(), host);
  if (!features.has("session-avatar-mode") || !isOwnerFeatures(features)) return;
  await updateMetadata(session, host, { avatarMode: "inherit" }, { avatar: session.avatar ?? null, avatarMode: session.avatarMode ?? null });
}

function followAvatarItem(session: SessionResource, t: T, host: string, features: ReadonlySet<string>): MenuAction | null {
  if (!features.has("session-avatar-mode") || session.avatarMode === "inherit") return null;
  return { label: t("avatarStyle.followProfile" as MessageKey), icon: <Smile size={ICON} />, onSelect: guarded(() => followAgentProfile(session, host)) };
}

/** Replacing an own avatar is an explicit second choice in the same menu. */
function resetAvatarItem(session: SessionResource, t: T, host: string, features: ReadonlySet<string>): MenuAction | null {
  if (!features.has("session-metadata") || agentIndex(useApp.getState()).get(session.cutexSessionId)?.hostId !== host) return null;
  const pick = () => {
    const base = shownStyleAvatar(session.cutexSessionId, host);
    const color = session.avatar?.kind === "color" ? session.avatar.value : session.avatar?.color;
    return base && features.has(AVATAR_COLOR_FEATURE) && isHexColor(color) ? { ...base, color: color.toLowerCase() } : base;
  };
  const avatar = pick();
  if (JSON.stringify(avatar) === JSON.stringify(session.avatar ?? null) && (!features.has("session-avatar-mode") || session.avatarMode === "fixed")) return null;
  const apply = guarded(() => setAgentAvatar(session, host, pick()));
  return { label: t("avatarStyle.reset" as MessageKey), icon: <Smile size={ICON} />, onSelect: session.avatar ? () => {} : apply,
    ...(session.avatar ? { submenu: [{ label: t("avatarStyle.confirmReset" as MessageKey, { name: session.displayName }), hint: t("avatarStyle.resetOwnHint" as MessageKey), onSelect: apply }] } : {}) };
}

/** 头像 › (owner 2026-11-05): 跟着 Profile 变, 重置为当前风格 (its confirm stays one level down), 显示 / 隐藏头像; null when none applies. */
function avatarItem(session: SessionResource, t: T, host: string, features: ReadonlySet<string>, pinned: boolean): MenuAction | null {
  const rows = [followAvatarItem(session, t, host, features), resetAvatarItem(session, t, host, features), avatarSwitchItem(session, t, host, features, pinned)].filter((r): r is MenuAction => !!r);
  if (!rows.length) return null;
  return { label: t("menu.avatar"), icon: <Smile size={ICON} />, onSelect: () => {}, submenu: rows };
}

/** One note write (the tray's 「备注…」) through the same fenced metadata update as 编辑信息, drawn at once
 *  (updateMetadataNow); null / blank clears it. */
export async function setAgentNote(session: SessionResource, host: string, note: string | null): Promise<void> {
  const next = note?.trim() || null;
  if (next === (session.note ?? null)) return;
  await updateMetadataNow(session, host, { note: next });
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

/** Claude 工具: its two switches, flattened into 设置 › under a 「Claude 工具」 note (no third menu level); [] when not a Claude agent. */
function claudeToolRows(session: SessionResource, t: T, host: string): MenuAction[] {
  const write = claudeTool(session, "claudeAllowWrite");
  const exec = claudeTool(session, "claudeAllowExec");
  if (write === null || exec === null) return [];
  const state = (on: boolean) => (on ? t("menu.on") : t("menu.off"));
  return [
    { label: t("menu.claudeTools"), note: true, disabled: true, onSelect: () => {} },
    { label: t("menu.claudeWrite"), icon: <Wrench size={ICON} />, hint: state(write), onSelect: guarded(() => toggleClaudeTool(session, "claudeAllowWrite", t, host)) },
    { label: t("menu.claudeExec"), icon: <Wrench size={ICON} />, hint: state(exec), onSelect: guarded(() => toggleClaudeTool(session, "claudeAllowExec", t, host)) },
  ];
}

/**
 * 设置 › (owner 2026-11-05): the agent's own switches. A single row stays at the top level (no one-row submenu); the
 * Claude tool switches only come with their note, so they always go one level down.
 */
function settingsEntries(session: SessionResource, t: T, host: string): MenuEntry[] {
  const claude = claudeToolRows(session, t, host);
  const quota = quotaContinueItem(session, t, host);
  // MCP 服务器… (cutex scoped-mcp): this agent's MCP switches in a dialog (components/AgentMcpDialog).
  const mcp: MenuAction | null = showsAgentMcp(session, featuresOf(useApp.getState(), host))
    ? { label: t("agent-config.mcp.menu"), icon: <Plug size={ICON} />, onSelect: () => void agentMcpDialog(session.cutexSessionId, host) }
    : null;
  const own = [quota, mcp].filter((e): e is MenuAction => !!e);
  if (!claude.length) return own.length > 1 ? [{ label: t("menu.agentSettings"), icon: <SlidersHorizontal size={ICON} />, onSelect: () => {}, submenu: own }] : own;
  return [{ label: t("menu.agentSettings"), icon: <SlidersHorizontal size={ICON} />, onSelect: () => {}, submenu: own.length ? [...claude, "separator", ...own] : claude }];
}

/** 打开 › (owner 2026-11-05): 打开文件面板, 打开所在项目 and the window rows; one row alone stays at the top level. */
function openEntries(rows: (MenuAction | false | null | undefined | "")[], t: T): MenuEntry[] {
  const shown = rows.filter((r): r is MenuAction => !!r);
  if (shown.length <= 1) return shown;
  return [{ label: t("menu.open"), icon: <ExternalLink size={ICON} />, onSelect: () => {}, submenu: shown }];
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
    info: t("quotaContinue.menuHint"),
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
    // A start of ours still waiting for cutex's answer (lib/runtimeStart): shown, not offered again.
    if (runtimeStartSince(host, id) !== null) return { label: t("menu.starting"), icon: <Power size={ICON} />, disabled: true, onSelect: () => {} };
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
  const operatorPending = sidebarOf(useApp.getState(), host)?.operatorRestartRequired?.includes(id) === true;
  return {
    label: t(operatorPending ? "projects.operatorRestartNow" : "menu.restart"),
    icon: <RotateCw size={ICON} />,
    armed: t(operatorPending ? "projects.operatorRestartArmed" : busy ? "menu.restartArmedBusy" : "menu.restartArmed"),
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
 * 升级运行时 (cutex claude-runtime-repin, lib/claudeRepin): a Claude agent whose pinned runtime is older than
 * the host's selected one ("claude-r17 → claude-r19"). Decided from the agent list (cutex
 * session-claude-runtime; older cutex: the cached view, loaded now for the next open); the click reloads
 * the view, confirms and repins; a running agent is offered the restart.
 */
function repinItem(session: SessionResource, t: T, host: string): MenuAction | null {
  const app = useApp.getState();
  if (!repinApplies(featuresOf(app, host), session)) return null;
  const id = session.cutexSessionId;
  const sidebar = sidebarOf(app, host);
  // The list's row is the freshest copy of the agent (the caller's may predate a reload).
  const row = sidebar?.active.find((s) => s.cutexSessionId === id) ?? session;
  const offer = repinMenuOffer(() => hostApi(host), host, row, sidebar?.claudeRuntime);
  if (!offer) return null;
  return {
    label: t("menu.upgradeRuntime"),
    icon: <CircleArrowUp size={ICON} />,
    hint: `${offer.from} → ${offer.to}`,
    onSelect: guarded(async () => {
      const current = fenceOf(host);
      await runRepinFlow({
        api: hostApi(host),
        hostId: host,
        session,
        t,
        confirm: (message, labels, danger) => confirmDialog(message, danger, labels),
        notice: noticeDialog,
        notify: (message) => useApp.getState().notify(message),
        restart: async () => {
          if (!current()) return;
          const live = useApp.getState();
          await live.sessionAction(id, "cutex/runtime/offline", undefined, host);
          if (!current()) return;
          await live.sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false }, host);
        },
      });
    }),
  };
}

/**
 * The agent menu (sidebar row, title bar, 全部 agent dialog). `hostId`: the agent's host (default: the
 * host of its open view, else the focus host). Another host's agent gets the same actions, sent to
 * that host's daemon (multi-host P1).
 */
/** 暂停{{agent}} / 继续{{agent}} (agent-pause): one row, worded apart from 暂停新委托 (header ⋯ and the agent menus). */
export function agentPauseItem(hostId: string, sessionId: string, t: T): MenuAction {
  const pause = agentPauseNow(hostId, sessionId);
  return pause
    ? { label: t("agentPause.resume"), info: t("agentPause.resumeHint"), icon: <Play size={ICON} />, onSelect: () => void resumeAgent(hostId, sessionId) }
    : { label: t("agentPause.pause"), info: t(agentToolGateNow(hostId, sessionId) ? "agentPause.pauseHintToolGate" : "agentPause.pauseHint"), icon: <CirclePause size={ICON} />, onSelect: () => void pauseAgent(hostId, sessionId) };
}

/**
 * Multi-window (P3; only with the 多窗口 setting on, P6): 「在主窗口打开」 / 「在 桌子 N 打开」 for every other window, 「在新窗口打开」.
 * One copy per agent: it moves from where it is (lib/deskActions openInWindow).
 */
function windowEntries(host: string, id: string, t: T): MenuEntry[] {
  if (!desksEnabled()) return [];
  return [
    ...windowChoices().map((w): MenuAction => ({ label: w.key === MAIN_WINDOW ? t("desk.openInMain") : t("desk.openIn", { n: w.n }), icon: <AppWindow size={ICON} />, info: t("desk.openInHint"), onSelect: () => openInWindow(w.key, host, id) })),
    { label: t("desk.openInNew"), icon: <AppWindow size={ICON} />, info: t("desk.moveToWindowHint"), onSelect: () => void openInNewDesk(host, id) },
  ];
}

export function agentMenu(session: SessionResource, t: T, hostId?: string): MenuEntry[] {
  const app = useApp.getState();
  const id = session.cutexSessionId;
  const host = hostId ?? viewHostOf(id);
  const focus = host === focusHost();
  const features = featuresOf(app, host);
  const retired = session.lifecycle === "retired";
  const busy = !!session.runtime.activeTurnId;
  const pinned = (focus ? app.pinned : pinnedOn(host)).has(id);
  const canDelete = features.has(SESSION_FEATURES.delete) && !lacks(agentFeaturesOf(session), "threadDelete");
  // 暂停委托 / 继续委托 (asks-pause-v2): the explicit owner pause of new delegations to this agent (its
  // view on this host, keyed by host + id: panes step 2).
  const asksPaused = !!viewOf(app, host, id)?.asksPaused;
  // 已随停止暂停 (stop-holds-ridealongs, lib/stopHold): 继续发送 (queue resume releases the stop hold).
  const stopOnly = asksPauseKind(viewOf(app, host, id)?.asksPaused) === "stop";
  // A closed runtime gate (runtime-gate-pause): 恢复输入 = asks resume (reopens the gate).
  const gate = asksPauseKind(viewOf(app, host, id)?.asksPaused) === "gate";
  const asksPauseItem: MenuAction | false = !retired && features.has("asks-pause-v2") && {
    label: t(stopOnly ? "paused.resume" : gate ? "asksPause.gateResumeMenu" : asksPaused ? "menu.asksResume" : "menu.asksPause"),
    info: t(stopOnly ? "paused.resumeHintStop" : gate ? "asksPause.gateResumeHint" : asksPaused ? "menu.asksPauseHint" : "menu.asksPauseHint"),
    icon: <Hourglass size={ICON} />,
    onSelect: guarded(() => (stopOnly ? app.resumePaused(id, host) : asksPaused ? app.resumeAsks(id, host) : app.pauseAsks(id, host))),
  };
  // 暂停智能体 / 继续智能体 (agent-pause, lib/agentPause): the whole agent, after its running turn; not 暂停新委托.
  const pauseItem: MenuAction | false = !retired && agentPauseSupported(app, host) && agentPauseItem(host, id, t);
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
  // for an agent whose view belongs to `host`; a busy Claude agent without forkWhileBusy refuses (lib/structuralGate).
  const canFork = !retired && features.has(SESSION_FEATURES.fork) && !lacks(agentFeaturesFor(id, host), "fork");
  const block = canFork ? structuralBlockFor(id, "fork", host) : null;
  const projectId = sidebarOf(app, host)?.hostRows[id]?.projectId ?? null;
  // users: on a host where this device is not the owner, only this device's own view actions remain
  // (pin, read mark, open project, copy, module ref actions); everything that changes the agent is the owner's.
  if (!isOwnerFeatures(features)) {
    return [
      !retired && { label: pinned ? t("menu.unpin") : t("menu.pin"), icon: pinned ? <PinOff size={ICON} /> : <Pin size={ICON} />, onSelect: () => app.togglePin(id, host) },
      unread && { label: t("menu.markRead"), icon: <MailCheck size={ICON} />, onSelect: () => markSeenOn(host, id) },
      // One row here (打开所在项目): stays at the top level (openEntries' one-row rule).
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
  // Grouped (owner 2026-10-16, cleaned 2026-11-05): this device's view (置顶, 标为已读, the modules' ref actions:
  // 并排打开, 投影, 钉到托盘) · open / copy, with the project's actions · who it is (显示名称, 编辑信息, 头像 ›, 分叉) ·
  // its switches · pause · its runtime · archive / delete. Pause, runtime and danger rows sit in their own groups,
  // so a stray click near a view action never arms 停止运行时.
  return [
    // ── view (this device only) ──
    !retired && { label: pinned ? t("menu.unpin") : t("menu.pin"), icon: pinned ? <PinOff size={ICON} /> : <Pin size={ICON} />, onSelect: () => app.togglePin(id, host) },
    unread && { label: t("menu.markRead"), icon: <MailCheck size={ICON} />, onSelect: () => markSeenOn(host, id) },
    // The modules' `ref.action` items for the agent (§19.8).
    ...refActionEntries(agentRef(host, id, session.displayName)),
    "separator",
    // ── open › (files, project, windows) · 轮换主管… where a Director finds it · copy ──
    ...openEntries([
      !retired && {
        label: t("menu.openFiles"),
        icon: <FolderOpen size={ICON} />,
        onSelect: async () => {
          await app.openAgent(id, host);
          openSide(FILES_COMPONENT, {}, { focus: true });
        },
      },
      projectId && { label: t("menu.openProject"), icon: <FolderKanban size={ICON} />, onSelect: () => app.openPage("projects.page", { project: projectId, ...(focus ? {} : { host }) }) },
      ...(retired ? [] : (windowEntries(host, id, t) as MenuAction[])),
    ], t),
    rotateItem,
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
    "separator",
    // ── who it is (one-off actions): 编辑信息… holds the display name (first field), avatar, badge and note ──
    { label: t("menu.editInfo"), icon: <Pencil size={ICON} />, onSelect: guarded(() => editAgentInfo(session, host)) },
    !retired && avatarItem(session, t, host, features, pinned),
    // 转为智能体… (quick-chat-promote-v1): the same conversation, now an agent with an own name, standalone or in a project.
    promoteOffered(features, session, sidebarOf(app, host)?.hostRows?.[id]) && {
      label: t("promote.menu"),
      icon: <Bot size={ICON} />,
      onSelect: () => void promoteChatDialog(id, host),
    },
    canFork && {
      // Ellipsis rule (docs/GLOSSARY.md): … only when a dialog asks for a choice first, here the Profile.
      label: t("menu.forkAgent") + (features.has(FORK_PROFILE_FEATURE) ? "…" : ""),
      icon: <GitFork size={ICON} />,
      ...(block ? { disabled: true, hint: t("structural.busyHint"), title: structuralBlockText(block) } : {}),
      onSelect: guarded(() => requestFork(id, null, host)),
    },
    "separator",
    // ── its switches (on / off) ──
    ...(retired ? [] : settingsEntries(session, t, host)),
    "separator",
    // ── pause (the whole agent, or only new delegations) ──
    pauseItem,
    asksPauseItem,
    "separator",
    // ── runtime ──
    runtimeItem(session, t, host),
    restartItem(session, t, host),
    repinItem(session, t, host),
    "separator",
    // ── archive / delete ──
    retired && { label: t("menu.restore"), icon: <ArchiveRestore size={ICON} />, onSelect: guarded(() => restoreWithDirector(session, t, host).catch((e: unknown) => offerRenameAfterRestore(e, t))) },
    retired && canDelete && deleteItem,
    // 归档 stays a plain, clickable row; 删除… sits one level down under 更多 › (a row with "›" reads
    // as a pure submenu, so it never doubles as an action).
    !retired && archiveItem,
    !retired && canDelete && { label: t("menu.more"), icon: <MoreHorizontal size={ICON} />, onSelect: () => {}, submenu: [deleteItem] },
  ];
}

export interface MessageMenuInput {
  sessionId: string;
  /** The agent's host (panes step 2: the conversation's; default the host of its latest view). */
  hostId?: string;
  kind: "user" | "agent" | "received" | "sent";
  text: string;
  /** A user message's image / skill input items (编辑并重发 puts them back). */
  extra?: unknown[];
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
  const host = m.hostId ?? viewHostOf(m.sessionId);
  const canFork = featuresOf(app, host).has(SESSION_FEATURES.fork) && !lacks(agentFeaturesFor(m.sessionId, host), "fork");
  // A busy Claude agent refuses revert, and fork without forkWhileBusy (lib/structuralGate): offered
  // disabled, with the reason.
  const blockedBy = (op: StructuralOp) => {
    const block = structuralBlockFor(m.sessionId, op, host);
    return block ? { disabled: true, hint: t("structural.busyHint"), title: structuralBlockText(block) } : {};
  };
  const blocked = blockedBy("revert");
  const forkBlocked = blockedBy("fork");
  // DSH: conversation only, files are not restored (no checkpoints; rewindFiles is never offered).
  const texts = revertTexts(agentFeaturesFor(m.sessionId, host).runtime);
  return [
    { label: t("menu.copy"), icon: <Copy size={ICON} />, onSelect: () => copyText(mentionPlainText(m.text)) },
    { label: t("menu.quote"), icon: <MessageSquareQuote size={ICON} />, onSelect: () => app.insertIntoComposer(m.sessionId, quoteText(m.text), "append", undefined, host) },
    m.fold && { label: t(m.fold.folded ? "fold.unfold" : "fold.fold"), icon: m.fold.folded ? <ChevronsUpDown size={ICON} /> : <ChevronsDownUp size={ICON} />, onSelect: m.fold.toggle },
    m.kind === "user" && "separator",
    m.kind === "user" && {
      label: t("menu.editResend"),
      icon: <Undo2 size={ICON} />,
      hint: canRevert ? undefined : "·",
      disabled: !canRevert || !m.turnId,
      confirm: t(texts.editResendConfirm),
      onSelect: guarded(() => app.editAndResend(m.sessionId, m.turnId!, m.text, host, m.extra)),
      ...(canRevert ? blocked : {}),
    },
    m.kind === "agent" && "separator",
    // Fork creates a new agent; requestFork confirms alternate-profile costs. Revert rewrites this agent's history.
    m.kind === "agent" && {
      label: t("menu.fork"),
      icon: <GitFork size={ICON} />,
      hint: canFork ? undefined : "·",
      disabled: !canFork || !m.turnId,
      onSelect: guarded(() => requestFork(m.sessionId, m.turnId, host)),
      ...(canFork ? forkBlocked : {}),
    },
    m.kind === "agent" &&
      canRevert &&
      m.nextTurnId && {
        label: t("reply.revert"),
        icon: <History size={ICON} />,
        danger: true,
        confirm: t(texts.revertConfirm, { n: m.laterTurns ?? 0 }),
        onSelect: guarded(() => app.revertTo(m.sessionId, m.nextTurnId!, { hostId: host })),
        ...blocked,
      },
    // Claude agents with file rewind (claude-rewind-files): the same revert, files restored too.
    m.kind === "agent" &&
      canRevert &&
      m.nextTurnId &&
      canRewindFiles(agentFeaturesFor(m.sessionId, host), featuresOf(app, host)) && {
        label: t("reply.revertWithFiles"),
        icon: <FileClock size={ICON} />,
        danger: true,
        confirm: t("menu.revertFilesConfirm", { n: m.laterTurns ?? 0 }),
        onSelect: guarded(() => app.revertTo(m.sessionId, m.nextTurnId!, { rewindFiles: true, hostId: host })),
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
    ...files.slice(0, 8).map((f) => ({ label: f.path, icon: <FileText size={ICON} />, onSelect: () => void openPath(f.path) })),
  ];
}

/** Workspace file (relative path) — file links, tool rows, file tree, changes list. */
export function fileMenu(path: string, root: string | null, t: T, opts: { changed?: boolean; isDir?: boolean; inTree?: boolean; hostId?: string } = {}): MenuEntry[] {
  const app = useApp.getState();
  const hostId = opts.hostId ?? agentHost(app);
  const sourceHost = app.hosts?.hosts.find((host) => host.id === hostId);
  const hostHint = sourceHost?.kind === "local" ? "" : ` · ${sourceHost?.label ?? hostId}`;
  const abs = root ? `${root.replace(/[\\/]+$/, "")}${root.includes("\\") ? "\\" : "/"}${root.includes("\\") ? path.replace(/\//g, "\\") : path}` : null;
  const sessionId = app.selectedId;
  return [
    !opts.isDir && { label: t("menu.preview"), icon: <FileText size={ICON} />, onSelect: () => void openPath(path) },
    // 在文件树中显示 (docs/design/019 §3); the 文件 explorer's own rows leave it out (`inTree`).
    !opts.inTree && { label: t("workspace.revealInTree"), icon: <LocateFixed size={ICON} />, hint: "Ctrl+Alt+R", onSelect: () => void revealInTree(path) },
    opts.changed && { label: t("menu.showDiff"), icon: <FileDiff size={ICON} />, onSelect: () => void openGitDiff(path) },
    "separator",
    { label: `${t("menu.copyRelPath")}${hostHint}`, icon: <Copy size={ICON} />, onSelect: () => copyText(path) },
    abs && { label: `${t("menu.copyAbsPath")}${hostHint}`, icon: <ClipboardCopy size={ICON} />, onSelect: () => copyText(abs) },
    sessionId && { label: t("menu.mention"), icon: <MessageSquareQuote size={ICON} />, onSelect: () => app.insertIntoComposer(sessionId, `\`${path}\` `, "append") },
    // Local host only: a remote host's files are not on this machine. Reveal, never open (it could run it).
    abs && canRevealLocal({ hostId, path: abs }) && { label: revealFileLabel(t), icon: <FolderOpen size={ICON} />, onSelect: guarded(() => performFilePathAction(hostId, abs, "reveal")) },
    abs && downloadFileAction({ hostId, path: abs, isDir: opts.isDir }, t),
  ];
}

/**
 * A file link outside what the workspace `fs/file` serves (outside the agent's root, no known
 * root, `~` with an unknown home): the full path, copy, "show in folder" on the local host only,
 * and with `preview` (cutex fs-file-read, an absolute path) the side-pane preview by host path.
 */
export function outsideFileMenu(ref: FileRef, full: string, remote: boolean, t: T, preview?: (() => void) | null, hostId = agentHost(useApp.getState())): MenuEntry[] {
  const app = useApp.getState();
  // Older callers supplied only the remote flag: a focus-host fallback must
  // never reinterpret that remote path as a local one.
  const sourceHostId = remote && hostId === LOCAL_HOST_ID ? "unknown-remote" : hostId;
  const sourceHost = app.hosts?.hosts.find((host) => host.id === sourceHostId);
  const hostHint = sourceHost?.kind === "local" ? "" : ` · ${sourceHost?.label ?? sourceHostId}`;
  const sessionId = app.selectedId;
  const path = ref.abs ?? ref.path;
  return [
    { label: full, hint: t(preview ? "menu.fileOutsideWorkspaceHost" : "menu.fileOutsideWorkspace"), note: true, disabled: true, onSelect: () => {} },
    "separator",
    preview && { label: t("menu.preview"), icon: <FileText size={ICON} />, onSelect: preview },
    ...fileActions({ hostId: sourceHostId, path }, t),
    ref.line != null && { label: `${t("menu.copyPathLine")}${hostHint}`, icon: <ClipboardCopy size={ICON} />, onSelect: () => copyText(full) },
    sessionId && { label: t("menu.mention"), icon: <MessageSquareQuote size={ICON} />, onSelect: () => app.insertIntoComposer(sessionId, `\`${path}\` `, "append") },
  ];
}
