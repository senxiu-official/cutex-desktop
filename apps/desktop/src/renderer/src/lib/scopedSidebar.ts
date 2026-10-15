// Multi-host sidebar (RFC §8.3 ★ 合并, P1 step 2a): the sidebars of every host in the view scope as one
// list. Pure (unit-tested in test/scopedSidebar.test.ts); the React side is lib/scopedSidebarView.ts.
//
// - Projects of all hosts sort together by the usual rule (live agents first, then name; the owner's
//   dragged order first): two hosts' projects with the same id stay two groups (keys differ, §8.4).
// - Agents without a project: one 「无项目」 group per host, last, in host order.
// - Quick chats: one merged list, newest first.
// - Every row / group carries its `hostId` and host key (lib/hostKeys); a one-host scope gives exactly
//   today's sidebar (same groups, same order).
import type { SidebarSnapshot } from "../../../shared/ipc";
import type { AgentSignal, NeedsYou } from "./agentAttention";
import { agentSignal, needsYouByAgent, type NeedsYouInput } from "./agentAttention";
import { buildSidebar, compareChats, compareProjects, rowKey, type AgentRow, type AgentStatus, type SidebarGroup } from "./sidebar";
import type { TurnMarks } from "./turnUnread";

/** One host's sidebar input. */
export interface HostSidebarPart {
  hostId: string;
  /** Its current snapshot, else the last one seen this run (RFC §8.5, memory only), else null. */
  snapshot: SidebarSnapshot | null;
  pinned?: ReadonlySet<string>;
  /** Its agents with a pending native request. */
  needsInput?: ReadonlySet<string>;
  /** Quick chats in their own list (that host's human-create-session). */
  chats?: boolean;
  /** `snapshot` is the last one seen, not current (host reconnecting): its agents show `unknown` (connecting). */
  statusUnknown?: boolean;
  /** Statuses that host's session views know live this run (win over `unknown`). */
  liveStatus?: ReadonlyMap<string, AgentStatus>;
}

export interface ScopedSidebarModel {
  /** Projects of every host (merged order), then one no-project group per host (host order). */
  groups: SidebarGroup[];
  /** Quick chats of every host, newest first. */
  chats: AgentRow[];
}

export function mergeHostSidebars(parts: readonly HostSidebarPart[]): ScopedSidebarModel {
  const projects: SidebarGroup[] = [];
  const independents: SidebarGroup[] = [];
  const chats: AgentRow[] = [];
  for (const part of parts) {
    if (!part.snapshot) continue;
    const model = buildSidebar(part.snapshot, { hostId: part.hostId, pinned: part.pinned, needsInput: part.needsInput, chats: part.chats, statusUnknown: part.statusUnknown, liveStatus: part.liveStatus });
    for (const group of model.groups) (group.kind === "project" ? projects : independents).push(group);
    chats.push(...model.chats);
  }
  // Stable: equal projects keep host order.
  projects.sort(compareProjects);
  chats.sort(compareChats);
  return { groups: [...projects, ...independents], chats };
}

/** One host's attention inputs (needs-you sources and done / failed marks). */
export interface HostAttentionPart extends NeedsYouInput {
  hostId: string;
  marks: TurnMarks;
}

/** Signals / needs-you of merged rows, keyed by row key (rowKey); each row reads its own host's inputs. */
export function scopedSignals(rows: readonly AgentRow[], parts: readonly HostAttentionPart[], focus: string): { signals: Map<string, AgentSignal>; needs: Map<string, NeedsYou> } {
  const byHost = new Map(parts.map((p) => [p.hostId, { needs: needsYouByAgent(p), marks: p.marks }] as const));
  const signals = new Map<string, AgentSignal>();
  const needs = new Map<string, NeedsYou>();
  for (const row of rows) {
    const host = byHost.get(row.hostId ?? focus);
    const n = host?.needs.get(row.id);
    const key = rowKey(row);
    if (n) needs.set(key, n);
    signals.set(key, agentSignal(row, n, host?.marks[row.id]));
  }
  return { signals, needs };
}
