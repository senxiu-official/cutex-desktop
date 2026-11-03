// r269 component store (lib/componentStore.ts, contract frozen in shared/componentIndex.ts): terminal `result`s are kept per
// component from events / replies / the list (done never means selected), `cutex/components/indexUpdated` re-reads the list,
// an index refresh is its own request (never a pending install) and its refusal is kept as `indexCheck`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readComponentsList } from "../src/shared/components";

const env = vi.hoisted(() => ({
  components: vi.fn(),
  componentAction: vi.fn(),
  componentIndexCheck: vi.fn(),
  handler: null as null | ((e: { hostId: string; envelope: unknown }) => void),
}));
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  bridge: { on: (_name: string, fn: (e: { hostId: string; envelope: unknown }) => void) => ((env.handler = fn), () => (env.handler = null)) },
  apiFor: () => ({ components: env.components, componentAction: env.componentAction, componentIndexCheck: env.componentIndexCheck }),
}));
const { checkComponentIndex, hostComponents, loadComponents, requestComponent, retainEvents, useComponentStore } = await import("../src/renderer/src/lib/componentStore");

const list = (operation: unknown = null) => readComponentsList({ managed: true, installFrom: "release", components: [{ name: "dsh-runtime", supported: true, state: "ready", selected: "dsh-r2" }], operation });
const done = (result: unknown) => ({ id: "op", name: "dsh-runtime", action: "install", state: "done", step: null, error: null, result });

beforeEach(() => {
  useComponentStore.setState({ byHost: {} });
  env.components.mockReset();
  env.componentAction.mockReset();
  env.componentIndexCheck.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("r269 component store", () => {
  it("a terminal result from the list is kept; done + needsUser is not a selection", async () => {
    env.components.mockResolvedValue(list(done({ outcome: "needsUser", version: "dsh-r3", selected: false })));
    await loadComponents("h");
    expect(hostComponents("h").results["dsh-runtime"]).toEqual({ action: "install", result: { outcome: "needsUser", version: "dsh-r3", selected: false } });
    // A new request on that component clears it.
    env.componentAction.mockResolvedValue({ ok: true, value: { id: "c", name: "dsh-runtime", action: "check", state: "running", step: null, error: null } });
    env.components.mockResolvedValue(list());
    await requestComponent("h", "dsh-runtime", "check");
    expect(hostComponents("h").results).toEqual({});
  });

  it("events: the updated event's result is kept; indexUpdated re-reads the list", async () => {
    vi.useFakeTimers();
    env.components.mockResolvedValue(list());
    const release = retainEvents();
    env.handler!({ hostId: "h", envelope: { cutex: { method: "cutex/components/updated", params: { name: "dsh-runtime", reason: "operation", state: "ready", operation: done({ outcome: "selected", version: "dsh-r3", selected: true }) } } } });
    expect(hostComponents("h").results["dsh-runtime"]?.result.selected).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(env.components).toHaveBeenCalledTimes(1);
    env.handler!({ hostId: "h", envelope: { cutex: { method: "cutex/components/indexUpdated", params: { channel: "public-stable", sequence: 2, stale: false, staleReason: null, operation: null } } } });
    await vi.advanceTimersByTimeAsync(400);
    expect(env.components).toHaveBeenCalledTimes(2);
    release();
  });

  it("index check: never pending, keeps other results, refusal kept as indexCheck", async () => {
    env.components.mockResolvedValue(list(done({ outcome: "ready", version: "dsh-r3", selected: false })));
    await loadComponents("h");
    env.componentIndexCheck.mockResolvedValue({ ok: false, error: { code: "upgrade_blocked", message: "an index refresh is running", status: 409 } });
    await checkComponentIndex("h", "dsh-runtime");
    expect(env.componentIndexCheck).toHaveBeenCalledTimes(1);
    expect(hostComponents("h").pending).toBeNull();
    expect(hostComponents("h").refusal).toMatchObject({ name: "dsh-runtime", action: "indexCheck", error: { code: "upgrade_blocked" } });
    expect(hostComponents("h").results["dsh-runtime"]?.result.outcome).toBe("ready");
  });

  it("a result row lasts while cutex reports its operation (or a new one runs) and goes once cutex reports none (daemon restart)", async () => {
    const finished = done({ outcome: "selected", version: "dsh-r3", selected: true });
    env.components.mockResolvedValue({ ...list(finished), indexOperation: { id: "i", name: null, action: "indexCheck", state: "done", step: null, error: null } });
    await loadComponents("h");
    // Reload case: the finished operation is still in GET → the row stays (re-read twice).
    await loadComponents("h");
    expect(hostComponents("h").results["dsh-runtime"]?.result.selected).toBe(true);
    // Another component's install runs: the row stays.
    env.components.mockResolvedValue(list({ id: "op2", name: "other", action: "install", state: "running", step: "download", error: null }));
    await loadComponents("h");
    expect(hostComponents("h").results["dsh-runtime"]?.result.selected).toBe(true);
    // The daemon restarted: operation and indexOperation null → the remembered row is gone.
    env.components.mockResolvedValue({ ...list(null), indexOperation: null });
    await loadComponents("h");
    expect(hostComponents("h").results).toEqual({});
    expect(hostComponents("h").list?.indexOperation).toBeNull();
    // A later finished operation in GET shows again.
    env.components.mockResolvedValue(list(finished));
    await loadComponents("h");
    expect(hostComponents("h").results["dsh-runtime"]?.result.version).toBe("dsh-r3");
  });

  it("a read started before a reply / event noted a result does not drop it", async () => {
    let answer!: (v: unknown) => void;
    env.components.mockReturnValueOnce(new Promise((r) => (answer = r)));
    const read = loadComponents("h");
    // The install reply (finished at once) arrives while that read is still out.
    env.componentAction.mockResolvedValue({ ok: true, value: readComponentsList({ managed: true, installFrom: "release", components: [], operation: done({ outcome: "selected", version: "dsh-r4", selected: true }) }).operation });
    const sent = requestComponent("h", "dsh-runtime", "install");
    await Promise.resolve();
    await Promise.resolve();
    answer(list(null));
    await read;
    await sent;
    expect(hostComponents("h").results["dsh-runtime"]?.result.version).toBe("dsh-r4");
  });
});
