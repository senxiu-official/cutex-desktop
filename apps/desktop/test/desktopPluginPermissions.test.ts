import { describe, expect, it, vi } from "vitest";
import { createBroker, type Json } from "@cutex-desktop/plugin-sandbox";
import { PLUGIN_OPEN_INTERVAL_MS, PLUGIN_SETTINGS_MAX_BYTES, PLUGIN_SETTINGS_MAX_KEYS, pluginOperations, type PluginAgent } from "../src/renderer/src/modules/plugins/permissions";
import { captureHostAction, fireHostSwitch } from "../src/renderer/src/lib/hostSwitch";

function fixture(grants = ["agents.read", "agents.open", "settings"], options: { failWrites?: () => boolean } = {}) {
  const controller = new AbortController();
  let clock = 1_000_000;
  let agents: PluginAgent[] = [{ id: "agent-a", name: "A", state: "online", threadId: "thread-a" }];
  const values = new Map<string, Json>();
  const open = vi.fn(async (_id: string) => {});
  const current = captureHostAction();
  const operations = pluginOperations({ signal: controller.signal, current, agents: () => agents, openAgent: open,
    now: () => clock,
    prefs: { get: (key, fallback) => (values.get(key) ?? fallback) as typeof fallback, set: (key, value) => { if (options.failWrites?.()) throw new DOMException("quota", "QuotaExceededError"); values.set(key, value); }, subscribe: () => () => {} } });
  let listener: ((event: MessageEvent) => void) | undefined;
  const replies: { id?: number; result?: Json; error?: { code: string } }[] = [];
  const port = { postMessage: (value: unknown) => { replies.push(value as typeof replies[number]); }, addEventListener: (_type: "message", next: (event: MessageEvent) => void) => { listener = next; }, removeEventListener: () => { listener = undefined; }, start() {}, close() {} };
  const broker = createBroker(port, { instanceId: "frame", channel: "secret", scope: { hostId: "A" }, requestedPermissions: ["agents.read", "agents.open", "settings"], grantedPermissions: grants, operations });
  let id = 0;
  const dispatch = (method: string, params: Json = null) => { const next = ++id; listener?.({ data: { version: 1, kind: "request", instanceId: "frame", channel: "secret", id: next, method, params } } as MessageEvent); return next; };
  const reply = async (id: number) => { await vi.waitFor(() => expect(replies.some((row) => row.id === id)).toBe(true)); return replies.find((row) => row.id === id)!; };
  return { broker, controller, operations, values, open, replies, dispatch, reply, agents: (next: PluginAgent[]) => { agents = next; }, tick: (ms: number) => { clock += ms; } };
}

describe("desktop plugin RPC permissions and scope", () => {
  it("denies ungranted reads/writes/open and every unsupported operation without invoking app code", async () => {
    const f = fixture([]);
    for (const [method, params] of [["agents.list", null], ["agents.open", { id: "agent-a" }], ["settings.set", { key: "note", value: "x" }], ["daemon.command", {}]] as [string, Json][]) expect((await f.reply(f.dispatch(method, params))).error?.code).toBe("permission_denied");
    expect(f.values.size).toBe(0); expect(f.open).not.toHaveBeenCalled(); f.broker.dispose();
  });

  it("returns only reviewed Agent metadata; refuses unknown or reincarnated agent IDs", async () => {
    const f = fixture();
    expect((await f.reply(f.dispatch("agents.open", { id: "agent-a" }))).error?.code).toBe("operation_failed");
    expect((await f.reply(f.dispatch("agents.list"))).result).toEqual([{ id: "agent-a", name: "A", state: "online" }]);
    expect((await f.reply(f.dispatch("agents.open", { id: "other" }))).error?.code).toBe("operation_failed");
    f.agents([{ id: "agent-a", name: "Replacement", state: "online", threadId: "new-thread" }]);
    expect((await f.reply(f.dispatch("agents.open", { id: "agent-a" }))).error?.code).toBe("operation_failed");
    expect(f.open).not.toHaveBeenCalled();
    await f.reply(f.dispatch("agents.list"));
    expect((await f.reply(f.dispatch("agents.open", { id: "agent-a" }))).result).toBeNull();
    expect(f.open).toHaveBeenCalledExactlyOnceWith("agent-a"); f.broker.dispose();
  });

  it("never lets settings address another plugin or reserved objects", async () => {
    const a = fixture(); const b = fixture();
    expect((await a.reply(a.dispatch("settings.set", { key: "note", value: "A only" }))).result).toBeNull();
    expect((await b.reply(b.dispatch("settings.get", { key: "note" }))).result).toBeNull();
    expect((await a.reply(a.dispatch("settings.get", { key: "note" }))).result).toBe("A only");
    const invalidSettings: Json[] = [{ key: "../plugins.consents", value: [] }, { key: "note", value: [], pluginId: "other" }, { key: "constructor", value: [] }];
    for (const params of invalidSettings) expect((await a.reply(a.dispatch("settings.set", params))).error?.code).toBe("invalid_params");
    expect(a.values.size).toBe(1); a.broker.dispose(); b.broker.dispose();
  });

  it("host A→B→A lifetime prevents delayed reads, opens and settings writes", async () => {
    const f = fixture(); await f.reply(f.dispatch("agents.list"));
    fireHostSwitch(); fireHostSwitch();
    expect((await f.reply(f.dispatch("agents.open", { id: "agent-a" }))).error?.code).toBe("operation_failed");
    expect((await f.reply(f.dispatch("settings.set", { key: "note", value: "stale" }))).error?.code).toBe("operation_failed");
    expect((await f.reply(f.dispatch("agents.list"))).error?.code).toBe("operation_failed");
    expect(f.open).not.toHaveBeenCalled(); expect(f.values.size).toBe(0); f.broker.dispose();
  });

  it("scope abort fences operations before they reach their effects", async () => {
    const f = fixture(); await f.reply(f.dispatch("agents.list")); f.controller.abort();
    expect((await f.reply(f.dispatch("agents.open", { id: "agent-a" }))).error?.code).toBe("operation_failed");
    expect((await f.reply(f.dispatch("settings.set", { key: "note", value: "stale" }))).error?.code).toBe("operation_failed");
    expect(f.open).not.toHaveBeenCalled(); expect(f.values.size).toBe(0); f.broker.dispose();
  });

  it("revoke aborts an in-flight open reply and suppresses late completion", async () => {
    const f = fixture(); await f.reply(f.dispatch("agents.list"));
    let finish!: () => void; f.open.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const id = f.dispatch("agents.open", { id: "agent-a" }); await vi.waitFor(() => expect(f.open).toHaveBeenCalledOnce());
    f.broker.revoke("agents.open"); expect((await f.reply(id)).error?.code).toBe("permission_revoked");
    finish(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.replies.filter((row) => row.id === id)).toHaveLength(1); f.broker.dispose();
  });

  it("caps each plugin's settings by key count and bytes; null deletes to free quota", async () => {
    const f = fixture();
    const set = async (key: string, value: Json) => (await f.reply(f.dispatch("settings.set", { key, value })));
    for (let index = 0; index < PLUGIN_SETTINGS_MAX_KEYS; index++) expect((await set(`k${index}`, index)).result).toBeNull();
    expect((await set("one-more", 1)).error?.code).toBe("operation_failed");
    expect((await set("k0", null)).result).toBeNull();
    expect((await f.reply(f.dispatch("settings.get", { key: "k0" }))).result).toBeNull();
    expect((await set("one-more", 1)).result).toBeNull();
    const g = fixture();
    const chunk = "x".repeat(Math.floor(PLUGIN_SETTINGS_MAX_BYTES / 4));
    for (const key of ["a", "b", "c"]) expect((await g.reply(g.dispatch("settings.set", { key, value: chunk }))).result).toBeNull();
    expect((await g.reply(g.dispatch("settings.set", { key: "d", value: chunk }))).error?.code).toBe("operation_failed");
    expect((await g.reply(g.dispatch("settings.get", { key: "d" }))).result).toBeNull();
    expect(g.values.size).toBe(1); f.broker.dispose(); g.broker.dispose();
  });

  it("reports a storage failure to the plugin instead of a false success", async () => {
    let fail = false; const f = fixture(undefined, { failWrites: () => fail });
    expect((await f.reply(f.dispatch("settings.set", { key: "note", value: "saved" }))).result).toBeNull();
    fail = true;
    expect((await f.reply(f.dispatch("settings.set", { key: "note", value: "lost" }))).error?.code).toBe("operation_failed");
    expect((await f.reply(f.dispatch("settings.get", { key: "note" }))).result).toBe("saved");
    f.broker.dispose();
  });

  it("throttles agents.open so a plugin cannot keep switching the conversation", async () => {
    const f = fixture(); await f.reply(f.dispatch("agents.list"));
    expect((await f.reply(f.dispatch("agents.open", { id: "agent-a" }))).result).toBeNull();
    expect((await f.reply(f.dispatch("agents.open", { id: "agent-a" }))).error?.code).toBe("operation_failed");
    f.tick(PLUGIN_OPEN_INTERVAL_MS - 1);
    expect((await f.reply(f.dispatch("agents.open", { id: "agent-a" }))).error?.code).toBe("operation_failed");
    f.tick(1);
    expect((await f.reply(f.dispatch("agents.open", { id: "agent-a" }))).result).toBeNull();
    expect(f.open).toHaveBeenCalledTimes(2); f.broker.dispose();
  });
});
