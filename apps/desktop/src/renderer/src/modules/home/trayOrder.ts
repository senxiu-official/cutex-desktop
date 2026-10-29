// The tray's marks and 「需要你 N」 (docs/design/001-tray-taskbar.md, docs/design/039-workspace-groups.md). Which entries the
// tray shows and in what order is modules/home/trayEntries.ts (钉住, then 最近). Pure (unit-tested in test/trayOrder.test.ts).
// Marks: on screen = a bar under the icon; folded to a strip = a hollow bar; open (off screen) = a dot; only pinned = none.

export type TrayMark = "on" | "strip" | "open" | "pinned";

export interface AgentId {
  hostId: string;
  sessionId: string;
}

export const agentEntryId = (a: AgentId): string => `${a.hostId}\u0000${a.sessionId}`;

/** 「需要你 N」: the sum over the tray's agents, and the first one needing you (null: none). */
export function trayNeeds<T>(agents: readonly T[], needsOf: (a: T) => number): { total: number; first: T | null } {
  let total = 0;
  let first: T | null = null;
  for (const a of agents) {
    const n = needsOf(a);
    if (n <= 0) continue;
    total += n;
    first ??= a;
  }
  return { total, first };
}
