// Core openers for well-known right-side components (lib/sideKinds.ts): file links, the turn
// summary's 查看变更, the title-bar git chip, /diff and the sub-agent chips call these instead of
// importing the modules that own the components. An open that cannot happen says why (a notice);
// it is never a silent no-op.
import { translate, type MessageKey } from "../i18n";
import type { SideOpenOptions, SideOpenResult } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { useApp } from "../store";
import { isClaudeTaskRef } from "./claudeTasks";
import { getUiPrefs } from "./prefs";
import { newInstanceOpts, PLAIN_OPEN, type OpenModifiers } from "./openModifiers";
import { toggleColumn } from "./sideActions";
import { sideRegistry } from "./sideComponents";
import {
  CHANGES_COMPONENT,
  DEFAULT_SIDE_COMPONENTS,
  DIFF_COMPONENT,
  PREVIEW_COMPONENT,
  SUBAGENT_THREAD_COMPONENT,
  type DiffParams,
  type PreviewParams,
  type SubagentThreadParams,
} from "./sideKinds";
import { sideOpen } from "./sideServices";

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

/** A file's git working-tree diff (改动 list, Changes menu). */
export function openGitDiff(path: string, staged?: boolean): SideOpenResult {
  return openSide(DIFF_COMPONENT, { source: "git", path, ...(staged === undefined ? {} : { staged }) } satisfies DiffParams);
}

/** One turn's changes to a file (turn summary 查看变更); the text comes from the timeline. */
export function openTurnDiff(diff: { sessionId: string; turnId: string; path: string; diff: string }): SideOpenResult {
  return openSide(DIFF_COMPONENT, { source: "turn", ...diff } satisfies DiffParams);
}

/** The 改动 list (title-bar git chip, /diff). */
export function openChanges(): SideOpenResult {
  return openSide(CHANGES_COMPONENT, {}, { focus: true });
}

/**
 * A sub-agent's thread, read-only (sub-agent chips, the status category's rows). A Claude task
 * (`claude:<session>:task:<id>`, lib/claudeTasks) is not a thread: the callers render it as not
 * openable; should one still get here, it says why and opens nothing.
 */
export function openSubagentThread(threadId: string): SideOpenResult {
  if (isClaudeTaskRef(threadId)) {
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
