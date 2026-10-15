// Well-known right-side component ids and their open params (docs/desktop-modules.md §18.8). Shell and
// core callers (file links, the turn summary, the title-bar git chip, /diff) open components through
// services.side.open with these constants instead of importing the modules that own them. A module
// that is off / missing makes the open return "unavailable" — never a silent no-op.
import type { ItemId } from "../modules/types";

export const FILES_COMPONENT: ItemId = "workspace.files";
export const CHANGES_COMPONENT: ItemId = "workspace.changes";
export const PREVIEW_COMPONENT: ItemId = "workspace.preview";
export const DIFF_COMPONENT: ItemId = "diff.view";
export const SUBAGENT_THREAD_COMPONENT: ItemId = "subagents.thread";
/**
 * Core (module `conversation`, ungated): one turn as a reference card (left gutter) or a right-side card.
 * The RFC's `turn.peek` — item ids carry their module's prefix. Its refs are `turn` refs (§19.9).
 */
export const TURN_PEEK: ItemId = "conversation.turnPeek";
export const SIDE_CHAT_COMPONENT: ItemId = "side-chat.chat";

/** The title-bar toggle on an empty right side opens these (D28: one 工作区 page, 文件 / 改动). */
export const DEFAULT_SIDE_COMPONENTS: readonly ItemId[] = [FILES_COMPONENT, CHANGES_COMPONENT];

/** Shell-derived components for `conversation.status` categories: `status:<item id>` (§18.9). */
export const STATUS_COMPONENT_PREFIX = "status:";

/** workspace.preview: a workspace-relative path, or with `host` an absolute path on the host (fs-file-read). */
export type PreviewParams = { path: string; line?: number | null; host?: boolean };

/**
 * diff.view: a git working-tree diff, one turn's changes to a file (text from the timeline; memory
 * only), or (v1.7) a unified diff the caller computed (`text`: key = its identity, e.g. two versions
 * of a stored artifact; memory only).
 */
export type DiffParams =
  | { source: "git"; path: string; staged?: boolean }
  | { source: "turn"; sessionId: string; turnId: string; path: string; diff: string }
  | { source: "text"; key: string; title: string; diff: string };

/** subagents.thread: a sub-agent thread of the bound agent, read-only. */
export type SubagentThreadParams = { threadId: string };

/** conversation.turnPeek: a `turn` ref's target (lib/refServices.ts turnPeekParams); the snapshot fields show a gone turn. */
export type TurnPeekParams = { hostId: string; sessionId: string; turnId: string; threadId?: string; ordinal?: number; agentName?: string; snippet?: string };
