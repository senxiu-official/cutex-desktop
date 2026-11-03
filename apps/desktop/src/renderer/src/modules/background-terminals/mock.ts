// Browser-preview data for background terminals (Eva's running processes; dev/mockTypes.ts).
import type { ModuleMock } from "../../dev/mockTypes";

const mockTerminals = [
  { itemId: "c9", processId: "p1", command: "pnpm --filter desktop dev", cwd: "D:\\Apps\\cutex-desktop", osPid: 41236, cpuPercent: 3.2, rssKb: 412000, killed: false },
  { itemId: "c10", processId: "p2", command: "cargo watch -x check", cwd: "D:\\Apps\\cutex-desktop\\upstream\\cutex", osPid: 40112, cpuPercent: 41.5, rssKb: 1650000, killed: false },
];
let claudeShellRunning = false;
/** Preview-only lifecycle fixture: open an empty Shelf first, then start a Claude shell. */
export function setMockClaudeShellRunning(running: boolean): void { claudeShellRunning = running; }

export const mock: ModuleMock = {
  api: () => ({
    async backgroundTerminals(sessionId, threadId) {
      if (sessionId === "kai" && threadId === "thread-kai" && claudeShellRunning) return [{ itemId: "claude-bg-bash", processId: "shell-1", command: "bash ./scripts/verify.sh", cwd: "/work/demo", osPid: null, cpuPercent: null, rssKb: null }];
      return sessionId === "eva" && threadId === "thread-eva" ? mockTerminals.filter((t) => !t.killed) : [];
    },
    async terminateBackgroundTerminal(_sessionId, _threadId, processId) {
      const t = mockTerminals.find((x) => x.processId === processId);
      if (t) t.killed = true;
    },
  }),
};
