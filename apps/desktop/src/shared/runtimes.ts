// `GET /v2/runtimes` (cutex capability `runtimes-view`): the runtimes installed on a host and which
// agents pin each one. Shape as implemented in cutex r218 (`feat/profile-id-runtimes`, contractVersion 2;
// extra fields cutex, unpinnedAgentCount, releaseDir, latest are not read yet). Every wire field the
// desktop reads is in this file (`RuntimesWire` + `adaptRuntimes`) and the preview mock (modules/runtimes/mock.ts).

/** Error text of a cleanup-plan read main gave up on (~20 s); the renderer shows 「暂时读不出 · 重试」 for it. */
export const RUNTIME_PRUNE_PLAN_TIMEOUT = "runtime prune plan read timed out";
export { RUNTIME_PRUNE_FEATURE, type RuntimePruneKind, type RuntimePruneVersion, type RuntimePruneClaudeProcesses, type RuntimePrunePlan, type RuntimePruneResult } from "@cutex-desktop/cutex-client";

/** cutex capability of `GET /v2/runtimes`. */
export const RUNTIMES_FEATURE = "runtimes-view";

// ---------- wire ----------

/** An agent pinned to a runtime (same ids as `/v2/runtime-packages` agents). */
export interface RuntimesWireAgent {
  cutexSessionId: string;
  name?: string | null;
}

/** One installed runtime (a native cute-codex release or a Claude runtime directory). */
export interface RuntimesWireEntry {
  /** Short label: "r50" (native) / "claude-r5" (Claude). */
  release: string;
  /** Short SHA of the runtime binary, including unregistered native builds. */
  sha256Prefix?: string | null;
  /** Full version, e.g. "0.160.0-r50"; absent for Claude and unregistered native runtimes. */
  version?: string | null;
  /** `<release dir>/<file>` (native) or the adapter directory name (Claude); never a full path. */
  path?: string | null;
  /** The one new launches use (native: in the selected bundle; Claude: the default runtime). */
  selected?: boolean;
  /** Pinned by agents, but its files are gone. */
  missing?: boolean;
  /** cutex r286: the background digest check of this entry's files has not finished; its SHA (and an unknown version
   *  derived from it) is not a finding yet. Absent once checked, and on older cutex. */
  verificationPending?: boolean;
  /** Agents pinned to it (may be omitted when only a count is sent). */
  agents?: RuntimesWireAgent[] | null;
  /** Count of pinned agents; defaults to `agents.length`. */
  agentCount?: number | null;
  /** Exact split of `agentCount` (cutex B2, 2026-11-15): not archived / archived. Absent on older cutex. */
  activeAgentCount?: number | null;
  archivedAgentCount?: number | null;
}

/** `GET /v2/runtimes` reply. */
export interface RuntimesWire {
  hostId?: string;
  native?: RuntimesWireEntry[] | null;
  claude?: RuntimesWireEntry[] | null;
}

// ---------- what the desktop uses ----------

export interface PinnedAgent {
  id: string;
  name: string;
}

export interface InstalledRuntime {
  release: string;
  version: string | null;
  sha256Prefix: string | null;
  path: string | null;
  selected: boolean;
  missing: boolean;
  /** See RuntimesWireEntry.verificationPending; only present (true) while the check runs. */
  verificationPending?: true;
  agentCount: number;
  /** Sorted by name; may be shorter than agentCount (cutex sends at most 20 names). */
  agents: PinnedAgent[];
  /** cutex's exact split of agentCount into not archived / archived; null when it sends none. */
  activeAgentCount?: number | null;
  archivedAgentCount?: number | null;
}

export interface RuntimesView {
  /** In cutex's order: its version sort, newest first (the release label is not a version: r260 can be 0.160.0-r52.4). */
  native: InstalledRuntime[];
  claude: InstalledRuntime[];
}

function adaptEntry(e: unknown): InstalledRuntime | null {
  if (!e || typeof e !== "object") return null;
  const w = e as Partial<RuntimesWireEntry>;
  if (typeof w.release !== "string" || !w.release) return null;
  const agents = (Array.isArray(w.agents) ? w.agents : [])
    .filter((a): a is RuntimesWireAgent => !!a && typeof a === "object" && typeof a.cutexSessionId === "string")
    .map((a) => ({ id: a.cutexSessionId, name: typeof a.name === "string" && a.name ? a.name : a.cutexSessionId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const count = typeof w.agentCount === "number" && Number.isFinite(w.agentCount) ? Math.max(w.agentCount, agents.length) : agents.length;
  const whole = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
  const active = whole(w.activeAgentCount), archived = whole(w.archivedAgentCount);
  // Only a split that adds up to the count is used.
  const split = active !== null && archived !== null && active + archived === count;
  return {
    release: w.release,
    version: typeof w.version === "string" ? w.version : null,
    sha256Prefix: typeof w.sha256Prefix === "string" && w.sha256Prefix ? w.sha256Prefix : null,
    path: typeof w.path === "string" ? w.path : null,
    selected: w.selected === true,
    missing: w.missing === true,
    ...(w.verificationPending === true ? { verificationPending: true as const } : {}),
    agentCount: count,
    agents,
    ...(split ? { activeAgentCount: active, archivedAgentCount: archived } : {}),
  };
}

function adaptList(list: unknown): InstalledRuntime[] {
  if (!Array.isArray(list)) return [];
  // cutex sorts by version; re-sorting by the release label's last number put r260 (0.160.0-r52.4) above r61 and
  // claude-r42-source-…600 above claude-r47-source-…579 (EVA, 2026-11-15).
  return list
    .map(adaptEntry)
    .filter((e): e is InstalledRuntime => !!e);
}

/** The wire reply → RuntimesView; null for anything that is not an object (a missing route is null already). */
export function adaptRuntimes(raw: unknown): RuntimesView | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as RuntimesWire;
  return { native: adaptList(w.native), claude: adaptList(w.claude) };
}

/** The selected (default) entry of a list, or null. */
export function selectedRuntime(list: readonly InstalledRuntime[]): InstalledRuntime | null {
  return list.find((e) => e.selected) ?? null;
}
