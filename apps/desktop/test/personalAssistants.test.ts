// 个人助理 (cutex older personal-assistants-local-v1): main's fixed routes (bodies rebuilt from checked fields, replies
// checked), the renderer's pure model ({instance, project} refs, overlaps and their dismissal key, refusal codes,
// request groups) and the store's write paths (one action id kept across a lost reply, revisions as shown).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { personalAssistantsApi } from "../src/main/personalAssistantsApi";
import type { PaAssistant } from "../src/shared/personalAssistants";

const assistant = (over: Partial<PaAssistant> = {}, config: Partial<PaAssistant["config"]> = {}): PaAssistant => ({
  id: "pa-1", revision: 3, enabled: true, sessionId: "s-1", coordinationProjectId: "pa-c",
  grants: { tier: "coordinator", operations: [], fullOwner: false },
  config: { name: "Life", profile: "claude", homeInstanceId: "inst-a", projectIds: ["desktop"], ...config },
  ...over,
});
const view = (a = assistant()) => ({ assistant: a, overlaps: [], moreOverlaps: false, availability: "ready", activeProfile: "claude", capabilities: { agenda: true } });

const calls: { method: string; args: unknown[] }[] = [];
let createReply: () => Promise<unknown> = () => Promise.resolve(null);
vi.mock("../src/renderer/src/lib/hostLists", () => ({
  // An older host (no r296 features).
  hostDataNow: () => null,
  hostApi: () =>
    new Proxy({}, {
      get: (_t, method: string) => (...args: unknown[]) => {
        calls.push({ method, args });
        if (method === "paCreate") return createReply();
        if (method === "paList") return Promise.resolve({ homeInstanceId: "inst-a", items: [assistant()], nextCursor: null });
        if (method === "paGet") return Promise.resolve(view());
        if (method === "paRequests") return Promise.resolve({ items: [], nextCursor: null });
        if (method === "paUpdate") return Promise.resolve(view(assistant({ revision: 4 })));
        return Promise.resolve(null);
      },
    }),
}));

function fakeClient(reply: (method: string, path: string, opts: unknown) => unknown) {
  const calls: { method: string; path: string; opts: any }[] = [];
  return {
    calls,
    client: { request: async (method: string, path: string, opts: unknown) => (calls.push({ method, path, opts }), reply(method, path, opts)) } as any,
  };
}

describe("main: fixed personal assistant routes", () => {
  it("reads with background priority; ids are encoded and checked; pages bounded", async () => {
    const { client, calls } = fakeClient((_m, path) => (path === "/v2/personal-assistants" ? { homeInstanceId: "inst-a", items: [assistant()], nextCursor: null } : view()));
    const api = personalAssistantsApi(client);
    expect((await api.paList({ limit: 100 })).items[0]!.config.name).toBe("Life");
    await api.paGet("pa-1");
    expect(calls.map((c) => [c.method, c.path, c.opts.background])).toEqual([["GET", "/v2/personal-assistants", true], ["GET", "/v2/personal-assistants/pa-1", true]]);
    await expect(api.paGet("../x")).rejects.toThrow(/invalid personal assistant id/);
    await expect(api.paList({ limit: 101 })).rejects.toThrow(/limit/);
  });

  it("create / update bodies are rebuilt from checked fields (extra keys never pass; unknown change kinds refused)", async () => {
    const { client, calls } = fakeClient(() => view());
    const api = personalAssistantsApi(client);
    await api.paCreate({ actionId: "a1", config: { name: "Life", profile: "claude", homeInstanceId: "inst-a", projectIds: ["desktop", "desktop"], extra: 1 } as any });
    expect(calls[0]!.opts.body).toEqual({ actionId: "a1", config: { name: "Life", profile: "claude", homeInstanceId: "inst-a", projectIds: ["desktop"] } });
    await api.paUpdate("pa-1", { actionId: "a2", expectedRevision: 3, change: { kind: "grants", grants: { tier: "operational", operations: ["publishing"], fullOwner: false } } });
    expect(calls[1]!).toMatchObject({ method: "PATCH", path: "/v2/personal-assistants/pa-1", opts: { body: { actionId: "a2", expectedRevision: 3, change: { kind: "grants", grants: { tier: "operational", operations: ["publishing"], fullOwner: false } } } } });
    await expect(api.paUpdate("pa-1", { actionId: "a3", expectedRevision: 3, change: { kind: "anything" } as any })).rejects.toThrow(/change/);
    await expect(api.paUpdate("pa-1", { actionId: "a3", expectedRevision: 3, change: { kind: "grants", grants: { tier: "root", operations: [], fullOwner: true } } as any })).rejects.toThrow(/grants/);
    await expect(api.paCreate({ actionId: "", config: { name: "x", profile: "p", homeInstanceId: "i", projectIds: [] } })).rejects.toThrow(/action id/);
  });

  it("confirm sends both revisions and the seat shown; cancel only its revision", async () => {
    const r = { id: "dr-1", assistantId: "pa-1", projectId: "desktop", outcome: "o", constraints: "", sourceRef: "", director: { sessionId: "eva", epoch: 2 }, assistantRevision: 3, state: "queued", revision: 2, updatedAt: "", detail: null };
    const { client, calls } = fakeClient(() => ({ request: r }));
    const api = personalAssistantsApi(client);
    expect((await api.paConfirm("pa-1", "dr-1", { actionId: "c1", expectedRevision: 1, expectedAssistantRevision: 3, director: { sessionId: "eva", epoch: 2 } })).state).toBe("queued");
    await api.paCancel("pa-1", "dr-1", { actionId: "c2", expectedRevision: 2 });
    expect(calls.map((c) => [c.method, c.path, c.opts.body])).toEqual([
      ["POST", "/v2/personal-assistants/pa-1/requests/dr-1/confirm", { actionId: "c1", expectedRevision: 1, expectedAssistantRevision: 3, director: { sessionId: "eva", epoch: 2 } }],
      ["POST", "/v2/personal-assistants/pa-1/requests/dr-1/cancel", { actionId: "c2", expectedRevision: 2 }],
    ]);
  });

  it("agenda / audit / requests: query checked, replies normalised; a malformed reply is refused", async () => {
    const { client, calls } = fakeClient((_m, path) =>
      path.endsWith("/agenda")
        ? { date: "2026-11-25", timezone: "host", items: [], nextCursor: null, reminders: [{ alarmId: "al", at: "t", message: "m", state: "pending" }], nextReminderCursor: "r2", schedules: [], nextScheduleCursor: null }
        : path.endsWith("/audit") ? { items: [{ seq: 9, actor: "owner", actionId: "a", verb: "create", at: "t", detail: { x: 1 } }], nextCursor: 9 } : { nope: true },
    );
    const api = personalAssistantsApi(client);
    expect((await api.paAgenda("pa-1", { date: "2026-11-25", reminderCursor: "r1", limit: 50 })).nextReminderCursor).toBe("r2");
    expect(calls[0]!.opts.query).toEqual({ date: "2026-11-25", cursor: undefined, reminderCursor: "r1", scheduleCursor: undefined, limit: 50 });
    expect((await api.paAudit("pa-1", { cursor: 20 })).items[0]!.verb).toBe("create");
    expect(calls[1]!.opts.query).toEqual({ cursor: "20", limit: undefined });
    await expect(api.paRequests("pa-1")).rejects.toThrow(/unexpected/);
    await expect(api.paAgenda("pa-1", { date: "25/11/2026" })).rejects.toThrow(/date/);
  });
});

describe("renderer model", async () => {
  const m = await import("../src/renderer/src/lib/personalAssistants");
  it("project refs: {instance, project}; older stores only the home's ids", () => {
    const a = assistant({}, { projectIds: ["desktop", "waveline"] });
    expect(m.assistantRefs(a)).toEqual([{ instanceId: "inst-a", projectId: "desktop" }, { instanceId: "inst-a", projectId: "waveline" }]);
    expect(m.homeProjectIds([{ instanceId: "inst-b", projectId: "lab" }, { instanceId: "inst-a", projectId: "waveline" }, { instanceId: "inst-a", projectId: "desktop" }], "inst-a")).toEqual(["desktop", "waveline"]);
    expect(m.remoteProjectsSupported(null)).toBe(false);
  });

  it("draft overlaps: other enabled assistants on the same {instance, project}; dismissal key per assistant and exact set", () => {
    const others = [assistant({ id: "pa-2" }, { name: "Research", projectIds: ["waveline", "proto"] }), assistant({ id: "pa-3", enabled: false }, { projectIds: ["waveline"] }), assistant({ id: "pa-4" }, { homeInstanceId: "inst-b", projectIds: ["waveline"] })];
    const rows = m.draftOverlaps([{ instanceId: "inst-a", projectId: "waveline" }, { instanceId: "inst-a", projectId: "desktop" }], others, "pa-1");
    expect(rows).toEqual([{ assistantId: "pa-2", name: "Research", projectId: "waveline", instanceId: "inst-a" }]);
    expect(m.overlapDismissKey("pa-1", rows)).toBe("pa-1|pa-2:waveline");
    expect(m.overlapDismissKey(null, [...rows, { assistantId: "pa-5", projectId: "a" }])).toBe("new|pa-2:waveline,pa-5:a");
  });

  it("refusal codes: stale ones read again; a lost reply / busy store keeps the action id", () => {
    expect(m.paErrorCode(new Error("Error invoking remote method 'invoke': Error: revision_conflict: revision_conflict"))).toBe("revision_conflict");
    expect(m.STALE_CODES.has("director_changed")).toBe(true);
    expect(m.keepsActionId(new Error("fetch failed"))).toBe(true);
    expect(m.keepsActionId(new Error("assistant_unavailable: Personal Assistant storage…"))).toBe(true);
    expect(m.keepsActionId(new Error("invalid_name: invalid_name"))).toBe(false);
  });

  it("request groups and the owner's actions", () => {
    expect(["awaitingOwner", "queued", "accepted", "clarification", "declined", "completed", "cancelled", "future"].map(m.requestGroup)).toEqual(["decide", "open", "open", "open", "done", "done", "done", "done"]);
    expect(m.confirmable({ state: "awaitingOwner" })).toBe(true);
    expect(m.confirmable({ state: "queued" })).toBe(false);
    expect(m.cancellable({ state: "accepted" })).toBe(false);
    expect(m.cancellable({ state: "clarification" })).toBe(true);
  });
});

describe("store write paths", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("a lost create reply is retried with the same action id and config; a refusal is not", async () => {
    const store = await import("../src/renderer/src/lib/personalAssistantStore");
    const m = await import("../src/renderer/src/lib/personalAssistants");
    store.resetPaStore();
    const config = { name: "Life", profile: "claude", homeInstanceId: "inst-a", projectIds: [] };
    createReply = () => Promise.reject(new Error("fetch failed"));
    const id = m.newActionId("create");
    const lost = await store.createAssistant("local", id, config).catch((e) => e);
    expect(m.keepsActionId(lost)).toBe(true);
    createReply = () => Promise.resolve(view());
    await store.createAssistant("local", id, config);
    expect(calls.filter((c) => c.method === "paCreate").map((c) => c.args)).toEqual([[{ actionId: id, config }], [{ actionId: id, config }]]);
    expect(store.usePa.getState().byHost.local!.assistants.map((a) => a.id)).toEqual(["pa-1"]);
  });

  it("an update goes at the revision shown and takes the reply; a host read lists, views and requests each assistant", async () => {
    const store = await import("../src/renderer/src/lib/personalAssistantStore");
    store.resetPaStore();
    await store.refreshHost("local");
    expect(calls.map((c) => c.method)).toEqual(["paList", "paGet", "paRequests"]);
    expect(store.usePa.getState().byHost.local).toMatchObject({ instanceId: "inst-a", error: null });
    await store.updateAssistant("local", assistant(), { kind: "enabled", enabled: false }, "act-1");
    expect(calls.at(-1)).toEqual({ method: "paUpdate", args: ["pa-1", { actionId: "act-1", expectedRevision: 3, change: { kind: "enabled", enabled: false } }] });
    expect(store.usePa.getState().byHost.local!.assistants[0]!.revision).toBe(4);
  });
});
