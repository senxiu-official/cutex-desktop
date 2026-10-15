// Browser-preview data for background terminals (Eva's running processes; dev/mockTypes.ts).
import type { ModuleMock } from "../../dev/mockTypes";

const mockTerminals = [
  { itemId: "c9", processId: "p1", command: "pnpm --filter desktop dev", cwd: "D:\\Apps\\cutex-desktop", osPid: 41236, cpuPercent: 3.2, rssKb: 412000, killed: false },
  { itemId: "c10", processId: "p2", command: "cargo watch -x check", cwd: "D:\\Apps\\cutex-desktop\\upstream\\cutex", osPid: 40112, cpuPercent: 41.5, rssKb: 1650000, killed: false },
];

export const mock: ModuleMock = {
  api: () => ({
    async backgroundTerminals(_sessionId, threadId) {
      return threadId === "thread-eva" ? mockTerminals.filter((t) => !t.killed) : [];
    },
    async terminateBackgroundTerminal(_sessionId, _threadId, processId) {
      const t = mockTerminals.find((x) => x.processId === processId);
      if (t) t.killed = true;
    },
  }),
};
