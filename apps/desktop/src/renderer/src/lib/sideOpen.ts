// Core openers for well-known right-side components (lib/sideKinds.ts): file links, the turn
// summary's 查看变更, the title-bar git chip, /diff and the sub-agent chips call these instead of
// importing the modules that own the components. An open that cannot happen says why (a notice);
// it is never a silent no-op.
import { translate, type MessageKey } from "../i18n";
import type { SideOpenOptions, SideOpenResult } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { agentHost, hostApi, selectedSidebar, useApp } from "../store";
import { agentFeaturesFor } from "./agentFeaturesView";
import { canOpenSubAgent } from "./claudeTasks";
import { getUiPrefs } from "./prefs";
import { newInstanceOpts, PLAIN_OPEN, type OpenModifiers } from "./openModifiers";
import { isHostDir, isWorkspaceDir } from "./pathKind";
import { toggleColumn } from "./sideActions";
import { sideRegistry } from "./sideComponents";
import {
  CHANGES_COMPONENT,
  DEFAULT_SIDE_COMPONENTS,
  DIFF_COMPONENT,
  FILES_COMPONENT,
  PREVIEW_COMPONENT,
  SUBAGENT_THREAD_COMPONENT,
  type DiffParams,
  type PreviewParams,
  type SubagentThreadParams,
} from "./sideKinds";
import { openAgentBeside } from "./paneStore";
import { sideOpen } from "./sideServices";
import { updateLayout, useSide } from "./sideLayoutStore";
import { locate } from "./sideLayout";
import { isTurnDiffPage, turnDiffPage } from "./turnDiffPage";
import { showShelfToast } from "./shelves";
import { resolveFileHref, rootFor, scopeFor } from "./workspace";

/** services.side.open + a notice when it cannot open (unknown / off / capability / agent …). */
export function openSide(kind: ItemId, params: Json = null, opts: SideOpenOptions = {}): SideOpenResult {
  const result = sideOpen(kind, params, opts);
  if (result.status === "unavailable") {
    const entry = sideRegistry().get(kind);
    const what = entry ? translate(entry.item.titleKey) : kind;
    useApp.getState().notify(translate("side.unavailable", { what, reason: translate(`side.reason.${result.reason}` as MessageKey) }), "info");
  }
  return result;
}

/**
 * Where a file open comes from: `link` = the conversation (file links, tool rows, the turn summary,
 * menus), `browse` = the file tree / 改动 list. 打开文件 = 对话里开新标签 keeps link opens (pinned tab)
 * and lets browse opens replace the unpinned preview.
 */
export type FileOpenFrom = "link" | "browse";

/** Plain click: the 打开文件 setting. Ctrl/⌘ / middle click (lib/openModifiers): a new kept tab, background unless Shift. */
export function previewOpts(from: FileOpenFrom, mods: OpenModifiers = PLAIN_OPEN): SideOpenOptions {
  if (mods.newInstance) return newInstanceOpts(mods);
  return from === "link" && getUiPrefs().sidePreview === "links-new-tab" ? { pin: true } : {};
}

/** A workspace file (file links, tool rows, the file tree): the preview. */
export function openFile(path: string, line: number | null = null, from: FileOpenFrom = "link", mods: OpenModifiers = PLAIN_OPEN): SideOpenResult {
  return openSide(PREVIEW_COMPONENT, { path, line } satisfies PreviewParams, previewOpts(from, mods));
}

/** An absolute path on the active host outside the workspace root (cutex fs-file-read). */
export function openHostFile(path: string, line: number | null = null, mods: OpenModifiers = PLAIN_OPEN): SideOpenResult {
  return openSide(PREVIEW_COMPONENT, { path, line, host: true } satisfies PreviewParams, previewOpts("link", mods));
}

/** A workspace folder: the 文件 tree, expanded down to it, the folder highlighted and scrolled into view. */
export function openFolder(path: string): SideOpenResult {
  return revealInTree(path);
}

/**
 * 在文件树中显示 (docs/design/019 §3): a workspace file or folder in the 文件 explorer — the way down opened,
 * the item selected and scrolled to the middle; outside the explorer's current folder it goes to the
 * item's folder (a history step). The explorer of this agent's own Shelf (017) is used, else one opens.
 */
export function revealInTree(path: string): SideOpenResult {
  return openSide(FILES_COMPONENT, { reveal: path }, { focus: true });
}

/** An absolute host path in the 文件 explorer: inside the workspace root as `revealInTree`, else a notice. */
export function revealHostInTree(path: string, root: string | null = selectedWorkspace().root): void {
  const rel = root ? relativeTo(path, root) : null;
  if (rel !== null) revealInTree(rel);
  else useApp.getState().notify(translate("workspace.revealOutside"), "info");
}

/** The selected agent's most recently used 预览 tab: its file (null = none open). */
export function currentPreviewFile(): { path: string; host: boolean } | null {
  const selected = useApp.getState().selectedId;
  let best: { at: number; path: string; host: boolean } | null = null;
  for (const inst of Object.values(useSide.getState().layout.instances)) {
    if (inst.kind !== PREVIEW_COMPONENT || inst.binding.kind !== "agent" || inst.binding.sessionId !== selected) continue;
    const st = inst.state as { path?: unknown; host?: unknown } | null;
    if (typeof st?.path !== "string" || (best && inst.lastActiveAt <= best.at)) continue;
    best = { at: inst.lastActiveAt, path: st.path, host: st.host === true };
  }
  return best && { path: best.path, host: best.host };
}

/** Ctrl/⌘ Alt R: the open file in the 文件 explorer (019 §3); a notice when no file is open. */
export function revealCurrentFile(): void {
  const file = currentPreviewFile();
  if (!file) useApp.getState().notify(translate("workspace.noOpenFile"), "info");
  else if (file.host) revealHostInTree(file.path);
  else revealInTree(file.path);
}

/** Double-click / Enter in the 文件 explorer: the file in the 预览 card as a kept tab (Ctrl/⌘: a new one). */
export function openFileKept(path: string, mods: OpenModifiers = PLAIN_OPEN): SideOpenResult {
  return openSide(PREVIEW_COMPONENT, { path, line: null } satisfies PreviewParams, mods.newInstance ? newInstanceOpts(mods) : { pin: true });
}

/** The selected agent's workspace (what the preview and the 文件 tree read). */
function selectedWorkspace() {
  const s = useApp.getState();
  const sidebar = selectedSidebar(s);
  const scope = scopeFor(sidebar, s.selectedId);
  const hostId = agentHost(s);
  return { hostId, api: hostApi(hostId), scope, root: scope ? rootFor(sidebar, scope) : null };
}

/**
 * A workspace path that may be a folder (file links, tool rows, the turn summary, menus, search
 * results): the daemon says which (lib/pathKind.ts); a folder opens in the 文件 tree, a file as `openFile`.
 */
export async function openPath(path: string, line: number | null = null, from: FileOpenFrom = "link", mods: OpenModifiers = PLAIN_OPEN): Promise<void> {
  const { hostId, api, scope } = selectedWorkspace();
  if (scope && (await isWorkspaceDir(api, hostId, scope, path))) openFolder(path);
  else openFile(path, line, from, mods);
}

/**
 * An absolute host path that may be a folder: inside the workspace root it opens in the 文件 tree;
 * outside, the tree cannot show it, so a notice says so (never a preview of an error).
 */
export async function openHostPath(path: string, line: number | null = null, mods: OpenModifiers = PLAIN_OPEN): Promise<void> {
  const { hostId, api, root } = selectedWorkspace();
  if (await isHostDir(api, hostId, path)) openHostFolder(path, root);
  else openHostFile(path, line, mods);
}

/** A host folder (known to be one): the 文件 tree when inside the workspace root, else a notice. */
export function openHostFolder(path: string, root: string | null = selectedWorkspace().root): void {
  const rel = root ? relativeTo(path, root) : null;
  if (rel !== null) openFolder(rel);
  else useApp.getState().notify(translate("workspace.folderOutside"), "info");
}

/** `path` relative to `root` ("" = the root itself); null when outside it. */
function relativeTo(path: string, root: string): string | null {
  // Windows roots compare case-insensitively, POSIX roots exactly (as resolveFileHref).
  const fold = /^[a-zA-Z]:/.test(root) ? (p: string) => p.toLowerCase() : (p: string) => p;
  const norm = (p: string) => fold(p.replace(/\\/g, "/").replace(/\/+$/, ""));
  if (norm(path) === norm(root)) return "";
  return resolveFileHref(path, root)?.rel ?? null;
}

/** A file's git working-tree diff (改动 list, Changes menu). */
export function openGitDiff(path: string, staged?: boolean): SideOpenResult {
  return openSide(DIFF_COMPONENT, { source: "git", path, ...(staged === undefined ? {} : { staged }) } satisfies DiffParams);
}

/** One turn's changes to a file (turn summary 查看变更); the text comes from the timeline. */
export function openTurnDiff(diff: { sessionId: string; turnId: string; path: string; diff: string }): SideOpenResult {
  const result = openSide(DIFF_COMPONENT, { source: "turn", ...diff } satisfies DiffParams);
  if (result.status !== "opened" || result.where !== "card") return result;
  updateLayout(layout => turnDiffPage(layout, result.instanceId, Date.now()));
  const at = locate(useSide.getState().layout, result.instanceId);
  if (at && !isTurnDiffPage(useSide.getState().layout, at.page)) showShelfToast(translate("shelf.toast.pagesFull"));
  return { ...result, pageId: at?.page.id ?? result.pageId };
}

/** The 改动 list (title-bar git chip, /diff). */
export function openChanges(): SideOpenResult {
  return openSide(CHANGES_COMPONENT, {}, { focus: true });
}

/**
 * A sub-agent's thread, read-only (sub-agent chips, the status category's rows, a Claude Agent tool
 * card). A Claude task (`claude:<session>:task:<id>`, lib/claudeTasks) opens only when the agent's
 * adapter keeps subagent transcripts; otherwise the callers render it as not openable, and should
 * one still get here, it says why and opens nothing.
 */
export function openSubagentThread(threadId: string, sessionId: string | null = useApp.getState().selectedId): SideOpenResult {
  if (!canOpenSubAgent(threadId, agentFeaturesFor(sessionId))) {
    useApp.getState().notify(translate("sub.claudeTask"), "info");
    return { status: "unavailable", reason: "bad-params" };
  }
  return openSide(SUBAGENT_THREAD_COMPONENT, { threadId } satisfies SubagentThreadParams);
}

/** The title-bar toggle / Ctrl+Alt+B: an empty side opens the default components (D28). */
export function toggleSideColumn(): void {
  toggleColumn(() => {
    let opened = false;
    for (const kind of DEFAULT_SIDE_COMPONENTS) {
      if (!sideRegistry().has(kind)) continue;
      opened = sideOpen(kind, {}, { reveal: true }).status === "opened" || opened;
    }
    // Nothing available (no workspace, module off): show the empty column with its launchers.
    if (!opened) toggleColumn();
  });
}

/**
 * Another agent's live conversation beside the focused one (agent menu 「在侧边打开」, ＋ ▸ 智能体): v1.17
 * (§24.4) the v1.16 side agent card is a conversation pane — a column beside the focused conversation
 * (lib/paneStore openAgentBeside, as Ctrl/⌘ + click on a sidebar row). `background`: the focus stays.
 */
export function openAgentSide(sessionId: string, hostId: string, background = false): SideOpenResult | null {
  openAgentBeside(hostId, sessionId, { focus: !background });
  return null;
}
