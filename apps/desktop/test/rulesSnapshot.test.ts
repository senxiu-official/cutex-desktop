import { beforeEach, expect, it, vi } from "vitest";
import type { ApprovalRulesView, ClaudePermissionRules, DaemonApi } from "../src/shared/ipc";
const events = vi.hoisted(() => new Map<string, (event: any) => void>());
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: (name: string, callback: (event: any) => void) => events.set(name, callback) } }));
import { cachedApprovalRules, cachedClaudeRules, loadApprovalRules, loadClaudeRules, rememberApprovalRules, watchApprovalRules } from "../src/renderer/src/lib/rulesSnapshot";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
const view = (revision: number): ApprovalRulesView => ({ contractVersion: 1, hostId: "fixture", revision, rules: [], catalog: [] });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { fireHostReset("a"); fireHostReset("b"); vi.restoreAllMocks(); });

it("deduplicates chip and panel reads and uses a fresh host-specific snapshot", async () => {
  const pending = deferred<ApprovalRulesView>();
  const read = vi.fn(() => pending.promise), api = { approvalRules: read } as unknown as DaemonApi;
  const first = loadApprovalRules("a", api), second = loadApprovalRules("a", api);
  expect(first).toBe(second); expect(read).toHaveBeenCalledTimes(1);
  pending.resolve(view(2)); await first;
  expect(await loadApprovalRules("a", api)).toEqual(view(2));
  expect(read).toHaveBeenCalledTimes(1);
  expect(cachedApprovalRules("b")).toBeNull();
});

it("refreshes stale snapshots while retaining the previous first-frame content", async () => {
  let now = 1000; vi.spyOn(Date, "now").mockImplementation(() => now);
  const read = vi.fn().mockResolvedValueOnce(view(1)).mockResolvedValueOnce(view(2));
  const api = { approvalRules: read } as unknown as DaemonApi;
  await loadApprovalRules("a", api); now += 30_001;
  const next = loadApprovalRules("a", api);
  expect(cachedApprovalRules("a")?.revision).toBe(1);
  await next; expect(cachedApprovalRules("a")?.revision).toBe(2);
});

it("does not let a pre-mutation or replaced-host read overwrite a newer snapshot", async () => {
  const pending = deferred<ApprovalRulesView>();
  const read = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(view(3));
  const api = { approvalRules: read } as unknown as DaemonApi;
  const old = loadApprovalRules("a", api);
  await loadApprovalRules("a", api, true);
  pending.resolve(view(1)); expect(await old).toBeNull();
  expect(cachedApprovalRules("a")?.revision).toBe(3);
  const late = deferred<ApprovalRulesView>(); read.mockReturnValueOnce(late.promise);
  const replaced = loadApprovalRules("a", api, true); fireHostReset("a");
  late.resolve(view(9)); expect(await replaced).toBeNull();
  expect(cachedApprovalRules("a")).toBeNull();
});

it("invalidates on rule events and resync, without dropping another host", () => {
  rememberApprovalRules("a", view(1)); rememberApprovalRules("b", view(2));
  const changed = vi.fn(), stop = watchApprovalRules("a", changed);
  events.get("hostEvent")!({ hostId: "a", envelope: { cutex: { method: "cutex/approvalRules/changed" } } });
  expect(changed).toHaveBeenCalledTimes(1); expect(cachedApprovalRules("a")).toBeNull();
  expect(cachedApprovalRules("b")?.revision).toBe(2);
  rememberApprovalRules("a", view(3)); events.get("hostResync")!({ hostId: "a" });
  expect(changed).toHaveBeenCalledTimes(2); expect(cachedApprovalRules("a")).toBeNull();
  rememberApprovalRules("a", view(4));
  events.get("hostEvent")!({ hostId: "a", envelope: { cutex: { method: "cutex/sessions/changed", params: { projectsChanged: true } } } });
  expect(changed).toHaveBeenCalledTimes(3); expect(cachedApprovalRules("a")).toBeNull(); stop();
});

it("shares Claude count/list reads by host and session and clears them on disconnect", async () => {
  const result = { cutexSessionId: "s", workspace: "/fixture", revision: 1, allow: ["Read"], supported: true } as ClaudePermissionRules;
  const read = vi.fn().mockResolvedValue(result), api = { claudePermissionRules: read } as unknown as DaemonApi;
  await Promise.all([loadClaudeRules("a", "s", api), loadClaudeRules("a", "s", api)]);
  expect(read).toHaveBeenCalledTimes(1); expect(cachedClaudeRules("a", "s")).toEqual(result);
  expect(cachedClaudeRules("a", "other")).toBeNull(); expect(cachedClaudeRules("b", "s")).toBeNull();
  events.get("daemonState")!({ hostId: "a", state: { kind: "unreachable" } });
  expect(cachedClaudeRules("a", "s")).toBeNull();
});
