// `GET /v2/runtimes` (cutex capability `runtimes-view`): the runtimes installed on a host and which
// agents pin each one. Shape as implemented in cutex r218 (`feat/profile-id-runtimes`, contractVersion 2;
// extra fields cutex, unpinnedAgentCount, releaseDir, sha256Prefix, latest are not read yet). Every wire field the
// desktop reads is in this file (`RuntimesWire` + `adaptRuntimes`) and the preview mock (modules/runtimes/mock.ts).

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
  /** Full version, e.g. "0.160.0-r50"; absent for Claude runtimes. */
  version?: string | null;
  /** `<release dir>/<file>` (native) or the adapter directory name (Claude); never a full path. */
  path?: string | null;
  /** The one new launches use (native: in the selected bundle; Claude: the default runtime). */
  selected?: boolean;
  /** Pinned by agents, but its files are gone. */
  missing?: boolean;
  /** Agents pinned to it (may be omitted when only a count is sent). */
  agents?: RuntimesWireAgent[] | null;
  /** Count of pinned agents; defaults to `agents.length`. */
  agentCount?: number | null;
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
  path: string | null;
  selected: boolean;
  missing: boolean;
  agentCount: number;
  /** Sorted by name; may be shorter than agentCount when cutex sends only a count. */
  agents: PinnedAgent[];
}

export interface RuntimesView {
  /** Newest release first. */
  native: InstalledRuntime[];
  claude: InstalledRuntime[];
}

/** Trailing number of a release label ("r50" → 50, "claude-r5" → 5); -1 when there is none. */
function releaseNumber(release: string): number {
  const m = /(\d+)\D*$/.exec(release);
  return m ? Number(m[1]) : -1;
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
  return {
    release: w.release,
    version: typeof w.version === "string" ? w.version : null,
    path: typeof w.path === "string" ? w.path : null,
    selected: w.selected === true,
    missing: w.missing === true,
    agentCount: count,
    agents,
  };
}

function adaptList(list: unknown): InstalledRuntime[] {
  if (!Array.isArray(list)) return [];
  return list
    .map(adaptEntry)
    .filter((e): e is InstalledRuntime => !!e)
    .sort((a, b) => releaseNumber(b.release) - releaseNumber(a.release) || b.release.localeCompare(a.release));
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
