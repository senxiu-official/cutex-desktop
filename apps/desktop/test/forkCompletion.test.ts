// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forkResult } from "../src/main/sessionFork";
const mock = vi.hoisted(() => ({ fork: vi.fn(), select: vi.fn(), refresh: vi.fn(), notify: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: { forkSession: mock.fork }, apiFor: () => ({ forkSession: mock.fork }),
  bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s,
}));
import { useApp } from "../src/renderer/src/store";
import { forkCompletionNotice } from "../src/renderer/src/lib/forkProfile";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
const t = (key: keyof typeof zhCN, vars?: Record<string, string | number>) => Object.entries(vars ?? {}).reduce<string>((s, [key, value]) => s.replaceAll(`{${key}}`, String(value)), zhCN[key]);
const fork = useApp.getState().forkSession;
beforeEach(() => {
  vi.clearAllMocks();
  mock.select.mockResolvedValue(undefined); mock.refresh.mockResolvedValue(undefined);
  useApp.setState({ hosts: null, sidebar: null, select: mock.select, refreshSidebar: mock.refresh, notify: mock.notify });
});
describe("committed fork presentation", () => {
  it.each([
    { historyBytes: null, warnings: [{ code: "fork_history_size_unavailable", message: "Measurement failed" }] },
    { historyBytes: 1024, warnings: [{ code: "claude_runtime_restart_failed", message: "Restart failed", runtimeState: "failed", restartError: "ProviderError" }] },
    { historyBytes: null, warnings: [{ code: "future_warning", message: "Backend English" }] },
  ])("opens the new session once despite optional facts $warnings.0.code", async (facts) => {
    mock.fork.mockResolvedValue(forkResult({ newCutexSessionId: "new", ...facts }));
    await fork("source", "turn", "local", "other-profile");
    expect(mock.fork).toHaveBeenCalledExactlyOnceWith("source", { afterTurnId: "turn", profile: "other-profile" });
    expect(mock.select).toHaveBeenCalledExactlyOnceWith("new", "local");
    expect(mock.notify).toHaveBeenCalledOnce();
    expect(mock.notify.mock.calls[0]![1]).toBe("info");
    expect(mock.notify.mock.calls[0]![2]).toEqual({ hostId: "local", sessionId: "new" });
    expect(mock.notify.mock.calls[0]![0]).not.toMatch(/Measurement failed|Restart failed|Backend English/);
  });
  it("uses plain Chinese warnings, deduplicates unknown size, and keeps zero distinct from null", () => {
    const message = forkCompletionNotice({ cutexSessionId: "new", historyBytes: null, warnings: [{ code: "fork_history_size_unavailable", message: "English" }, { code: "claude_runtime_restart_failed", message: "English" }] }, "new", t);
    expect(message).toContain("大小暂时算不出");
    expect(message.match(/大小暂时算不出/g)).toHaveLength(1);
    expect(message).toContain("无需再次分叉");
    expect(message).not.toContain("English");
    expect(forkCompletionNotice({ cutexSessionId: "new", historyBytes: 0 }, "new", t)).toBe(t("fork.done", { name: "new" }));
  });
});
