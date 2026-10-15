// Mock `GET /v2/runtimes` (cutex runtimes-view, shape assumed in shared/runtimes.ts) for the
// renderer preview: the native releases the runtime-packages mock pins its outdated agents to
// (r47 – r50) and the Claude runtimes. Not under `?legacy` (the section then says 需要升级 cutex).
import { RUNTIMES_FEATURE, type RuntimesWire, type RuntimesWireAgent } from "../../../../shared/runtimes";
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
  features: { new: [RUNTIMES_FEATURE] },
  api: () => ({
    async runtimes() {
      await new Promise((r) => setTimeout(r, 150));
      return structuredClone(VIEW);
    },
  }),
};
