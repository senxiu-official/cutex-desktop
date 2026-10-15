// CutexRef (lib/refs.ts; docs/desktop-modules.md §19): strict parsing of stored refs and the
// `ref.target` ownership rule (one provider per kind; built-in kinds and side component ids taken);
// the built-in ref builders; services.refs.open's dispatch by kind and `how` (lib/refServices.ts, the
// side / jump services mocked).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRef, BUILTIN_REF_KINDS, checkRefContributions, mainPageRef, pageParamsOf, parseRef, REF_MAX_KEY, REF_MAX_PARAM, REF_MAX_PARAMS, REF_MAX_SNIPPET, sidePageRef, turnRef, turnTitle } from "../src/renderer/src/lib/refs";

const m = vi.hoisted(() => {
  const opened = { status: "opened", instanceId: "i1", where: "card", pageId: "p1", reused: false };
  return {
    jumpToTurn: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ status: "focused" })),
    sideOpen: vi.fn((..._args: unknown[]): unknown => opened),
    sideOpenPeek: vi.fn((..._args: unknown[]): unknown => ({ ...opened, where: "peek" })),
    sideReveal: vi.fn((..._args: unknown[]): unknown => ({ status: "revealed", instanceId: "i1", pageId: "p1" })),
    whyUnavailable: vi.fn(() => "module-off"),
    registry: new Map<string, { moduleId: string; item: Record<string, unknown> }>(),
    host: {
      modules: [] as { id: string; contributes?: Record<string, { id?: string; kind?: string }[]> }[],
      entries: { "main.page": [] as unknown[], "ref.target": [] as unknown[] } as Record<string, unknown[]>,
      statuses: () => new Map(),
      snapshot(slot: string): unknown[] {
        return this.entries[slot] ?? [];
      },
    },
  };
});
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/lib/jump", () => ({ jumpToTurn: m.jumpToTurn }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideOpen: m.sideOpen, sideOpenPeek: m.sideOpenPeek, sideReveal: m.sideReveal, whyUnavailable: m.whyUnavailable }));
vi.mock("../src/renderer/src/lib/sideComponents", () => ({ sideRegistry: () => m.registry, sideViewNow: () => ({ hostId: "local", sessionId: null, workspaceKey: null }), specFrom: () => null }));
vi.mock("../src/renderer/src/modules/app", () => ({ appModules: () => m.host, services: {} }));

const ok = { hostId: "local", kind: "turn", key: "turn:local:s1:t9", title: "Lead · #9", params: { sessionId: "s1", turnId: "t9" } };

describe("parseRef", () => {
  it("accepts a valid ref and keeps only known fields", () => {
    expect(parseRef({ ...ok, extra: 1 })).toEqual(ok);
    expect(parseRef({ ...ok, kind: "status:jobs.tasks" })?.kind).toBe("status:jobs.tasks");
    expect(parseRef({ ...ok, kind: "workspace.preview", params: {} })?.params).toEqual({});
  });

  it("rejects missing / wrong-typed / oversize fields", () => {
    for (const bad of [
      null,
      "x",
      [],
      { ...ok, hostId: "" },
      { ...ok, hostId: 1 },
      { ...ok, kind: "Turn" },
      { ...ok, kind: "1turn" },
      { ...ok, kind: "a b" },
      { ...ok, key: "" },
      { ...ok, key: "k".repeat(REF_MAX_KEY + 1) },
      { ...ok, title: 5 },
      { ...ok, title: "t".repeat(201) },
      { ...ok, params: null },
      { ...ok, params: [] },
      { ...ok, params: { n: 1 } },
      { ...ok, params: { n: { nested: "x" } } },
      { ...ok, params: { "bad name": "x" } },
      { ...ok, params: { n: "x".repeat(REF_MAX_PARAM + 1) } },
      { ...ok, params: Object.fromEntries(Array.from({ length: REF_MAX_PARAMS + 1 }, (_, k) => [`p${k}`, "x"])) },
      { ...ok, snapshot: "x" },
      { ...ok, snapshot: {} },
    ]) {
      expect(parseRef(bad), JSON.stringify(bad)?.slice(0, 80)).toBeNull();
    }
  });

  it("rejects prototype keys in params", () => {
    expect(parseRef(JSON.parse(`{"hostId":"h","kind":"turn","key":"k","title":"t","params":{"__proto__":"x"}}`))).toBeNull();
    expect(parseRef({ ...ok, params: { constructor: "x" } })).toBeNull();
    const parsed = parseRef(ok)!;
    expect(Object.getPrototypeOf(parsed.params)).toBe(Object.prototype);
  });

  it("snapshot: `at` required; snippet clipped; unknown fields dropped", () => {
    const r = parseRef({ ...ok, snapshot: { at: "2026-10-09T10:00:00Z", snippet: "s".repeat(REF_MAX_SNIPPET + 50), icon: "bookmark", agentName: "Lead", x: 1 } })!;
    expect(r.snapshot).toEqual({ at: "2026-10-09T10:00:00Z", snippet: "s".repeat(REF_MAX_SNIPPET), icon: "bookmark", agentName: "Lead" });
  });

  it("round-trips through JSON", () => {
    const r = parseRef({ ...ok, snapshot: { at: "2026-10-09" } })!;
    expect(parseRef(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
});

describe("ref.target ownership", () => {
  const mod = (id: string, targets: string[], components: string[] = []) => ({
    id,
    contributes: { "ref.target": targets.map((kind) => ({ kind })), "side.component": components.map((c) => ({ id: c })) },
  });

  it("built-in kinds are taken", () => {
    for (const kind of BUILTIN_REF_KINDS) expect(checkRefContributions([mod("x", [kind])], []).get("x")).toMatch(/already provided/);
  });

  it("side component ids are taken (their refs open the component)", () => {
    expect(checkRefContributions([mod("x", ["workspace.preview"])], [mod("workspace", [], ["workspace.preview"])]).get("x")).toMatch(/workspace/);
    // the component's own module may also declare a ref.target for it
    expect(checkRefContributions([mod("workspace", ["workspace.preview"], ["workspace.preview"])], []).has("workspace")).toBe(false);
  });

  it("one provider per kind: an earlier module keeps it (even while off); same-batch duplicates lose", () => {
    expect(checkRefContributions([mod("b", ["notes.note"])], [mod("a", ["notes.note"])]).get("b")).toMatch(/already provided by a/);
    const batch = checkRefContributions([mod("a", ["notes.note"]), mod("b", ["notes.note"])], []);
    expect(batch.has("a")).toBe(false);
    expect(batch.get("b")).toMatch(/already provided by a/);
  });

  it("invalid kinds are rejected; a module re-registering its own kind is fine", () => {
    expect(checkRefContributions([mod("x", ["Bad Kind"])], []).get("x")).toMatch(/not a valid ref kind/);
    expect(checkRefContributions([mod("a", ["notes.note"])], [mod("a", ["notes.note"])]).size).toBe(0);
  });
});

describe("ref builders", () => {
  it("turn: key session:turn, title name · #n · time, params, clipped snapshot", () => {
    const r = turnRef({ hostId: "local", sessionId: "lead", turnId: "t36", agentName: "Lead", ordinal: 36, threadId: "th", snippet: "a\n  b " + "x".repeat(600), at: "2026-10-10T00:00:00Z" });
    expect(parseRef(r)).toEqual(r);
    expect(r).toMatchObject({ kind: "turn", key: "lead:t36", params: { sessionId: "lead", turnId: "t36", threadId: "th", ordinal: "36" } });
    expect(r.title.startsWith("Lead · #36")).toBe(true);
    expect(r.snapshot!.snippet!.startsWith("a b x")).toBe(true);
    expect(r.snapshot!.snippet!.length).toBe(REF_MAX_SNIPPET);
    expect(turnTitle("Lead", null, null)).toBe("Lead");
  });
  it("agent / side.page / main.page (sorted params, flat strings only)", () => {
    expect(parseRef(agentRef("local", "s1", "Mika"))).toMatchObject({ kind: "agent", key: "s1", params: { sessionId: "s1" } });
    expect(parseRef(sidePageRef("local", { id: "pg1", groups: ["workspace", "reference"] }, "工作区"))).toMatchObject({ kind: "side.page", key: "pg1", params: { pageId: "pg1", groups: "workspace,reference" } });
    const page = mainPageRef("local", "tasks.page", { z: "1", a: "2" }, "Tasks");
    expect(page.key).toBe('tasks.page:{"a":"2","z":"1"}');
    expect(pageParamsOf(page.params.pageParams)).toEqual({ a: "2", z: "1" });
    expect(pageParamsOf('{"a":1}')).toBeNull();
    expect(pageParamsOf("not json")).toBeNull();
  });
});

describe("services.refs.open dispatch", async () => {
  const { useApp } = await import("../src/renderer/src/store");
  const { refsOpen } = await import("../src/renderer/src/lib/refServices");
  const { TURN_PEEK } = await import("../src/renderer/src/lib/sideKinds");
  const turn = turnRef({ hostId: "local", sessionId: "lead", turnId: "t36", agentName: "Lead", ordinal: 36, snippet: "hi" });
  beforeEach(() => {
    vi.clearAllMocks();
    m.registry.clear();
    m.host.modules = [];
    m.host.entries = { "main.page": [], "ref.target": [] };
    useApp.setState({ hosts: { active: "local", hosts: [] } as never, sidebar: { active: [{ cutexSessionId: "lead", displayName: "Lead" }], retired: [] } as never });
  });

  it("rejects bad refs and refs of another host", async () => {
    expect(await refsOpen({ ...turn, kind: "Bad" })).toEqual({ status: "unavailable", reason: "bad-ref" });
    expect(await refsOpen({ ...turn, hostId: "workstation" })).toEqual({ status: "unavailable", reason: "host-changed" });
  });

  it("turn: auto → the reference card (where the setting puts it); peek → the left; page → the right side; jump → focusTurn", async () => {
    expect(await refsOpen(turn)).toEqual({ status: "opened", where: "card" });
    expect(m.sideOpen).toHaveBeenLastCalledWith(TURN_PEEK, expect.objectContaining({ sessionId: "lead", turnId: "t36", ordinal: 36, agentName: "Lead", snippet: "hi" }), { target: "peek" });
    expect(await refsOpen(turn, { how: "peek" })).toEqual({ status: "opened", where: "peek" });
    expect(m.sideOpenPeek).toHaveBeenLastCalledWith(TURN_PEEK, expect.anything(), "left");
    await refsOpen(turn, { how: "page" });
    expect(m.sideOpen).toHaveBeenLastCalledWith(TURN_PEEK, expect.anything(), { target: "page", focus: true });
    expect(await refsOpen(turn, { how: "jump" })).toEqual({ status: "opened", where: "timeline" });
    expect(m.jumpToTurn).toHaveBeenLastCalledWith("local", "lead", "t36");
    m.jumpToTurn.mockResolvedValueOnce({ status: "not-found", reason: "reverted" });
    expect(await refsOpen(turn, { how: "jump" })).toEqual({ status: "unavailable", reason: "reverted" });
    m.jumpToTurn.mockResolvedValueOnce({ status: "not-found", reason: "too-old" });
    expect(await refsOpen(turn, { how: "jump" })).toEqual({ status: "unavailable", reason: "gone" });
  });

  it("agent: selects a known agent, else gone", async () => {
    const select = vi.fn(async () => {});
    useApp.setState({ select } as never);
    expect(await refsOpen(agentRef("local", "lead", "Lead"))).toEqual({ status: "opened", where: "selected" });
    expect(select).toHaveBeenCalledWith("lead", "local");
    expect(await refsOpen(agentRef("local", "nobody", "X"))).toEqual({ status: "unavailable", reason: "gone" });
  });

  it("main.page: needs refParams; module off / missing capability are told apart", async () => {
    const openPage = vi.fn();
    useApp.setState({ openPage } as never);
    const ref = mainPageRef("local", "tasks.page", { id: "7" }, "Tasks");
    expect(await refsOpen(ref)).toEqual({ status: "unavailable", reason: "bad-ref" });
    m.host.modules = [{ id: "tasks", contributes: { "main.page": [{ id: "tasks.page" }] } }];
    expect(await refsOpen(ref)).toEqual({ status: "unavailable", reason: "module-off" });
    m.host.entries["main.page"] = [{ mode: "show", item: { id: "tasks.page" } }];
    expect(await refsOpen(ref)).toEqual({ status: "unavailable", reason: "bad-ref" }); // no refParams: not referable
    m.host.entries["main.page"] = [{ mode: "show", item: { id: "tasks.page", refParams: (p: Record<string, string>) => ({ id: p.id! }) } }];
    expect(await refsOpen(ref)).toEqual({ status: "opened", where: "page" });
    expect(openPage).toHaveBeenCalledWith("tasks.page", { id: "7" });
  });

  it("components: peekable → content (fromRef); other → reveal; declared but off → module-off", async () => {
    m.registry.set("workspace.preview", { moduleId: "workspace", item: { peekable: true, fromRef: (p: Record<string, string>) => ({ path: p.path, line: null, host: false }) } });
    m.registry.set("terminal.pty", { moduleId: "terminal", item: {} });
    const preview = { hostId: "local", kind: "workspace.preview", key: "a.md", title: "a.md", params: { path: "a.md" } };
    expect(await refsOpen(preview)).toEqual({ status: "opened", where: "card" });
    expect(m.sideOpen).toHaveBeenLastCalledWith("workspace.preview", { path: "a.md", line: null, host: false }, { target: "peek" });
    expect(await refsOpen({ ...preview, kind: "terminal.pty", key: "t1" })).toEqual({ status: "opened", where: "card" });
    expect(m.sideReveal).toHaveBeenCalled();
    m.host.modules = [{ id: "browser", contributes: { "side.component": [{ id: "browser.tab" }] } }];
    expect(await refsOpen({ ...preview, kind: "browser.tab", key: "x" })).toEqual({ status: "unavailable", reason: "module-off" });
  });

  it("anything else: the kind's one ref.target provider (jump → auto), else module-off", async () => {
    const open = vi.fn(async () => ({ status: "opened", where: "peek" }) as const);
    const note = { hostId: "local", kind: "notes.note", key: "n1", title: "Note", params: { noteId: "n1" } };
    expect(await refsOpen(note)).toEqual({ status: "unavailable", reason: "module-off" });
    m.host.entries["ref.target"] = [{ mode: "show", item: { kind: "notes.note", role: "content", open } }];
    expect(await refsOpen(note, { how: "jump" })).toEqual({ status: "opened", where: "peek" });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ kind: "notes.note" }), "auto");
    open.mockRejectedValueOnce(new Error("deleted"));
    expect(await refsOpen(note)).toEqual({ status: "unavailable", reason: "gone" });
  });
});
