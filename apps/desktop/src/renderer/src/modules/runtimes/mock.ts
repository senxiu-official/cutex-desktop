// Mock `GET /v2/runtimes` (cutex runtimes-view, shape assumed in shared/runtimes.ts) for the
// renderer preview: the native releases the runtime-packages mock pins its outdated agents to
// (r47 – r50) and the Claude runtimes. Not under `?legacy` (the section then says 需要升级 cutex).
import { RUNTIMES_FEATURE, RUNTIME_PRUNE_FEATURE, type RuntimePrunePlan, type RuntimePruneResult, type RuntimesWire, type RuntimesWireAgent } from "../../../../shared/runtimes";
import type { ModuleMock } from "../../dev/mockTypes";

const agents = (...names: string[]): RuntimesWireAgent[] => names.map((name) => ({ cutexSessionId: `cutex.${name.toLowerCase()}-7f3a`, name }));
const root = "/mnt/data/Projects/Cutex";

const VIEW: RuntimesWire = {
  hostId: "host-a",
  native: [
    { release: "r50", version: "0.160.0-r50", path: `${root}/cute-codex/.local/releases/r50/codex`, selected: true, agents: agents("Rei", "Ritsuko", "Gendo", "Fuyutsuki", "Maya", "Hikari", "Toji", "Kensuke") },
    { release: "r49", version: "0.160.0-r49", path: `${root}/cute-codex/.local/releases/r49/codex`, agents: agents("Beta", "Mari", "Misato") },
    { release: "r48", version: "0.160.0-r48", path: `${root}/cute-codex/.local/releases/r48/codex`, agents: agents("Kaji") },
    { release: "r47", version: "0.160.0-r47", path: "D:\Apps\cutex\cutex-20260916-r91\codex.exe", missing: true, agents: agents("Shinji") },
    { release: "r46", version: "0.160.0-r46", path: `${root}/cute-codex/.local/releases/r46/codex`, agents: [] },
  ],
  claude: [
    { release: "claude-r5", path: "D:/Apps/cutex/runtimes/claude-r5", selected: true, agents: agents("Kaworu", "Pen Pen", "Sakura") },
    { release: "claude-r4", path: "D:/Apps/cutex/runtimes/claude-r4", agents: agents("Yui") },
    { release: "claude-r3", path: "D:/Apps/cutex/runtimes/claude-r3", agentCount: 0 },
    { release: "claude-r2", path: "D:/Apps/cutex/runtimes/claude-r2", agentCount: 0 },
    { release: "claude-r1", path: "D:/Apps/cutex/runtimes/claude-r1", agentCount: 0 },
  ],
};

export const mock: ModuleMock = {
  features: { new: [RUNTIMES_FEATURE, RUNTIME_PRUNE_FEATURE] },
  api: () => {
    const deleted = new Set<string>();
    async function rawRuntimes() {
      await new Promise((r) => setTimeout(r, 150));
      // SHA-only selected native build, matching backend-upgrade's host summary.
      if (new URLSearchParams(location.search).get("nativeUnknown") === "1") return {
        ...structuredClone(VIEW),
        native: [
          { release: "dddddddddddd", version: null, sha256Prefix: "dddddddddddd", selected: true, agents: agents("Rei", "Ritsuko", "Maya") },
          ...structuredClone(VIEW.native ?? []).map(r => ({ ...r, selected: false })),
        ],
      } satisfies RuntimesWire;
      if (new URLSearchParams(location.search).has("runtimeArchived")) return {
        hostId: "host-a",
        native: [
          { release: "r260", version: "0.160.0-r52.4", selected: true, agents: [{ cutexSessionId: "eva", name: "Eva" }, { cutexSessionId: "lead", name: "Lead" }] },
          { release: "r241", version: "0.160.0-r52.3", agents: [{ cutexSessionId: "old1", name: "old-refactor" }] },
        ],
        claude: [
          { release: "claude-r42", selected: true, agents: [{ cutexSessionId: "mika", name: "Mika" }] },
          { release: "claude-r35", agents: [{ cutexSessionId: "sora", name: "Sora" }, { cutexSessionId: "old3", name: "atlas-v1" }] },
          { release: "claude-r29", agents: [{ cutexSessionId: "old2", name: "AUTO_old-migration" }, { cutexSessionId: "old4", name: "AUTO_spike-ws" }, { cutexSessionId: "old5", name: "proto-spike" }] },
        ],
      } satisfies RuntimesWire;
      if (new URLSearchParams(location.search).has("runtimeGroups")) return {
        hostId: "host-a",
        native: [
          { release: "r260", version: "0.160.0-r52.4", selected: true, agents: agents("Rei", "Ritsuko", "Maya") },
          { release: "r241", version: "0.160.0-r52.3", agents: agents("Mari") },
          { release: "r238", version: "0.160.0-r52.2", missing: true, agents: agents("Shinji") },
          ...[177, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35].map(n => ({ release: `r${n}`, version: `0.160.0-r${n}`, agents: [] })),
        ],
        claude: [
          { release: "claude-r29", selected: true, agents: agents("Kaworu", "Pen Pen", "Sakura") },
          { release: "claude-r28", agents: agents("Yui") },
          { release: "claude-r27", agentCount: 0 },
        ],
      } satisfies RuntimesWire;
      return structuredClone(VIEW);
    }
    async function runtimePrunePlan(): Promise<RuntimePrunePlan> {
      const view = await rawRuntimes();
      const versions: RuntimePrunePlan["versions"] = [];
      for (const kind of ["native", "claude"] as const) for (const entry of view[kind] ?? []) {
        const blockedReasons = entry.selected ? ["selected"] : entry.missing ? ["unmanaged"] : (entry.agents?.length || entry.agentCount) ? ["pinned"] : entry.release === "claude-r27" ? ["rollback"] : entry.release === "r177" ? ["inspection_failed"] : [];
        versions.push({ id: `opaque:${kind}:${entry.release}`, kind, release: entry.release, ...(entry.version ? { version: entry.version } : {}), bytes: kind === "native" ? 180_000_000 : 65_000_000, canPrune: blockedReasons.length === 0, blockedReasons });
      }
      // Discovered Claude directories need not appear in the session-pin view. Same release, two IDs.
      versions.push(
        { id: "opaque:claude:legacy-0", kind: "claude", release: "claude-r0", bytes: 32_000_000, canPrune: true, blockedReasons: [] },
        { id: "opaque:claude:component-0", kind: "claude", release: "claude-r0", bytes: 64_000_000, canPrune: true, blockedReasons: [] },
      );
      for (const kind of ["dsh", "kimi"] as const) for (const n of [3, 2, 1]) versions.push({ id: `opaque:${kind}:${n}`, kind, release: `${kind}-r${n}`, bytes: 12_000_000, canPrune: n === 1, blockedReasons: n === 3 ? ["selected"] : n === 2 ? ["rollback"] : [] });
      return { versions: versions.filter(v => !deleted.has(v.id)) };
    }
    return {
      async runtimes() {
        const view = await rawRuntimes();
        for (const kind of ["native", "claude"] as const) view[kind] = view[kind]?.filter(v => !deleted.has(`opaque:${kind}:${v.release}`));
        return view;
      },
      runtimePrunePlan,
      async pruneRuntimes(ids): Promise<RuntimePruneResult> {
        if (!ids.length || ids.length > 100) throw new Error("Expected 1–100 runtime IDs");
        const plan = await runtimePrunePlan();
        const results: RuntimePruneResult["results"] = ids.map(id => {
          const version = plan.versions.find(v => v.id === id);
          // The preview exercises authority changing between GET and POST, and partial I/O failure.
          const reason = !version ? "not_found" : !version.canPrune ? version.blockedReasons[0] : version.release === "claude-r2" ? "pinned" : version.release === "claude-r1" ? "io_error" : null;
          if (reason) return { id, status: reason === "io_error" ? "failed" : "refused", freedBytes: 0, reason };
          deleted.add(id);
          return { id, status: "deleted", freedBytes: version!.bytes };
        });
        return { freedBytes: results.reduce((n, r) => n + r.freedBytes, 0), results };
      },
    };
  },
};
