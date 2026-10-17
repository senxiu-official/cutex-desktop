// File tree auto-refresh (lib/workspaceRefresh.ts + useWorkspace): which folders reload after a
// watch batch, an agent's fileChange item, a turn's end and a host reconnect. The hook runs under a
// minimal hooks harness (no DOM in the test env), like workspaceScope.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_DIRS, ChangeBatcher, changeForPaths, DirVersions, dirsForPaths, fileChangePaths, itemMayWrite, mergeChanges, relativeToRoot, sameEntries } from "../src/renderer/src/lib/workspaceRefresh";

const h = vi.hoisted(() => {
  type Effect = { deps: readonly unknown[] | undefined; cleanup: void | (() => void) };
  const state: unknown[] = [];
  const effects: Effect[] = [];
  let queue: { i: number; fn: () => void | (() => void); deps: readonly unknown[] | undefined }[] = [];
  let si = 0;
  let ei = 0;
  return {
    useState<T>(init: T) {
      const i = si++;
      if (!(i in state)) state[i] = init;
      const set = (v: T | ((prev: T) => T)) => {
        state[i] = typeof v === "function" ? (v as (prev: T) => T)(state[i] as T) : v;
      };
      return [state[i] as T, set] as const;
    },
    useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) {
      const i = ei++;
      const prev = effects[i];
      if (!prev || !deps || !prev.deps || deps.some((d, k) => !Object.is(d, prev.deps![k]))) queue.push({ i, fn, deps });
    },
    render<T>(hook: () => T): T {
      si = 0;
      ei = 0;
      const out = hook();
      const run = queue;
      queue = [];
      for (const { i, fn, deps } of run) {
        const prev = effects[i];
        if (prev && typeof prev.cleanup === "function") prev.cleanup();
        effects[i] = { deps, cleanup: fn() };
      }
      return out;
    },
    unmount() {
      for (const e of effects) if (typeof e?.cleanup === "function") e.cleanup();
      state.length = 0;
      effects.length = 0;
      queue = [];
    },
  };
});

vi.mock("react", () => ({
  useState: h.useState,
  useEffect: h.useEffect,
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
  createContext: (value: unknown) => ({ Provider: null, value }),
  useContext: (ctx: { value: unknown }) => ctx.value,
}));

const env = vi.hoisted(() => {
  const listeners = new Map<string, Set<(payload: never) => void>>();
  const watches: string[] = [];
  const unwatched: string[] = [];
  let n = 0;
  const api = {
    gitReads: 0,
    gitStatus: async () => {
      api.gitReads++;
      return { branch: "main", files: [] };
    },
    watchWorkspace: async () => {
      const id = `w-${++n}`;
      watches.push(id);
      return id;
    },
    unwatchWorkspace: async (id: string) => {
      unwatched.push(id);
    },
  };
  const sidebar = {
    hostRows: { s1: { projectId: "p1" }, s2: { projectId: "other" } },
    projects: { projects: [{ project_id: "p1", workspace_root: "/work/repo" }] },
    active: [{ cutexSessionId: "s1", cwd: "/work/repo" }],
    retired: [],
  };
  return {
    listeners,
    watches,
    unwatched,
    api,
    sidebar,
    emit(event: string, payload: unknown) {
      for (const l of listeners.get(event) ?? []) (l as (p: unknown) => void)(payload);
    },
    reset() {
      listeners.clear();
      watches.length = 0;
      unwatched.length = 0;
      api.gitReads = 0;
      n = 0;
    },
  };
});

vi.mock("../src/renderer/src/store", () => {
  const useApp = Object.assign(() => null, { getState: () => ({}) });
  return { useApp, hostApi: () => env.api, agentHost: () => "local", selectedSidebar: () => null, sidebarOf: () => env.sidebar };
});
vi.mock("../src/renderer/src/bridge", () => ({
  api: env.api,
  bridge: {
    on: (event: string, fn: (payload: never) => void) => {
      const set = env.listeners.get(event) ?? new Set();
      set.add(fn);
      env.listeners.set(event, set);
      return () => set.delete(fn);
    },
  },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));

const { useWorkspace } = await import("../src/renderer/src/lib/workspaceView");
type Scope = Parameters<typeof useWorkspace>[0];
const SCOPE = { kind: "project", id: "p1" } as unknown as Scope;

describe("workspaceRefresh helpers", () => {
  it("a changed path reloads its folder and itself (when it is a shown folder)", () => {
    expect([...dirsForPaths(["a.txt", "src/main/x.ts", "newdir"])].sort()).toEqual(["", "a.txt", "newdir", "src/main", "src/main/x.ts"]);
    expect([...dirsForPaths([""])]).toEqual([""]);
  });

  it("relativeToRoot handles POSIX, Windows, verbatim and outside paths", () => {
    expect(relativeToRoot("/work/repo", "/work/repo/src/a.ts")).toBe("src/a.ts");
    expect(relativeToRoot("/work/repo/", "/work/repo")).toBe("");
    expect(relativeToRoot("/work/repo", "/work/repo2/a.ts")).toBeNull();
    expect(relativeToRoot("/work/repo", "/Work/repo/a.ts")).toBeNull();
    expect(relativeToRoot("D:\\Apps\\x", "d:\\apps\\X\\src\\a.ts")).toBe("src/a.ts");
    expect(relativeToRoot("\\\\?\\D:\\Apps\\x", "D:/Apps/x/a.ts")).toBe("a.ts");
    expect(relativeToRoot(null, "/abs/a.ts")).toBeNull();
    expect(relativeToRoot(null, "src/a.ts")).toBe("src/a.ts");
    expect(relativeToRoot("/r", "../escape")).toBeNull();
  });

  it("fileChangePaths takes both ends of a move and ignores other items", () => {
    expect(fileChangePaths({ type: "fileChange", changes: [{ path: "/r/a", kind: { type: "add" } }, { path: "/r/b", kind: { type: "update", move_path: "/r/c/d" } }] })).toEqual(["/r/a", "/r/b", "/r/c/d"]);
    expect(fileChangePaths({ type: "commandExecution" })).toEqual([]);
    expect(fileChangePaths(null)).toEqual([]);
  });

  it("changeForPaths falls back to everything for a path outside the root", () => {
    expect(changeForPaths("/r", [])).toBeNull();
    expect(changeForPaths("/r", ["/r/x/y.ts"])).toEqual({ all: false, dirs: new Set(["x", "x/y.ts"]) });
    expect(changeForPaths("/r", ["/r/x/y.ts", "/elsewhere/z"])).toBe(ALL_DIRS);
  });

  it("DirVersions bumps only the invalidated folders; everything bumps all", () => {
    const v = new DirVersions();
    const calls: number[] = [];
    v.subscribe(() => calls.push(1));
    const before = { root: v.version(""), src: v.version("src"), docs: v.version("docs") };
    v.invalidate({ all: false, dirs: new Set(["src"]) });
    expect(v.version("src")).toBeGreaterThan(before.src);
    expect(v.version("")).toBe(before.root);
    expect(v.version("docs")).toBe(before.docs);
    const mid = { src: v.version("src"), docs: v.version("docs") };
    v.invalidate(ALL_DIRS);
    expect(v.version("src")).toBeGreaterThan(mid.src);
    expect(v.version("docs")).toBeGreaterThan(mid.docs);
    v.invalidate({ all: false, dirs: new Set() });
    expect(calls).toHaveLength(2);
  });

  it("mergeChanges / ChangeBatcher coalesce into one flush", () => {
    vi.useFakeTimers();
    try {
      expect(mergeChanges({ all: false, dirs: new Set(["a"]) }, ALL_DIRS)).toBe(ALL_DIRS);
      const flushed: unknown[] = [];
      const b = new ChangeBatcher((c) => flushed.push(c), 100);
      b.add({ all: false, dirs: new Set(["a"]) });
      b.add(null);
      b.add({ all: false, dirs: new Set(["b"]) });
      vi.advanceTimersByTime(99);
      expect(flushed).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(flushed).toEqual([{ all: false, dirs: new Set(["a", "b"]) }]);
      b.add(ALL_DIRS);
      b.dispose();
      vi.advanceTimersByTime(500);
      expect(flushed).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("itemMayWrite: commands, tools and unknown kinds may write; messages and edits do not", () => {
    expect(itemMayWrite({ type: "commandExecution" })).toBe(true);
    expect(itemMayWrite({ type: "mcpToolCall" })).toBe(true);
    expect(itemMayWrite({ type: "somethingNew" })).toBe(true);
    expect(itemMayWrite(null)).toBe(true);
    expect(itemMayWrite({ type: "agentMessage" })).toBe(false);
    expect(itemMayWrite({ type: "fileChange" })).toBe(false);
  });

  it("sameEntries compares what a row shows", () => {
    const e = { path: "a", kind: "file", size: 1, modifiedAt: "t", ignored: false, targetKind: null };
    expect(sameEntries([e], [{ ...e }])).toBe(true);
    expect(sameEntries([e], [{ ...e, size: 2 }])).toBe(false);
    expect(sameEntries(null, [e])).toBe(false);
  });
});

describe("useWorkspace auto refresh", () => {
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const render = () => h.render(() => useWorkspace(SCOPE, "local"));
  let result: ReturnType<typeof useWorkspace>;

  beforeEach(async () => {
    vi.useFakeTimers();
    env.reset();
    result = render();
    await flush();
    result = render();
  });
  afterEach(() => {
    h.unmount();
    vi.useRealTimers();
  });

  it("a watch batch reloads only the changed folders, once, after a short pause", async () => {
    const { dirs } = result;
    const v = { root: dirs.version(""), src: dirs.version("src"), docs: dirs.version("docs") };
    env.emit("workspaceChanged", { watchId: "w-1", paths: ["src/a.ts"], gitChanged: false, overflow: false });
    env.emit("workspaceChanged", { watchId: "w-1", paths: ["src/b.ts"], gitChanged: false, overflow: false });
    expect(dirs.version("src")).toBe(v.src);
    await vi.advanceTimersByTimeAsync(200);
    expect(dirs.version("src")).toBe(v.src + 1);
    expect(dirs.version("docs")).toBe(v.docs);
    expect(dirs.version("")).toBe(v.root);
    expect(render().revision).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(env.api.gitReads).toBe(2);
  });

  it("ignores another watch's and another host's batches", async () => {
    const before = result.dirs.version("src");
    env.emit("workspaceChanged", { watchId: "w-other", paths: ["src/a.ts"], gitChanged: false, overflow: false });
    env.emit("workspaceChanged", { hostId: "remote", watchId: "w-1", paths: ["src/a.ts"], gitChanged: false, overflow: false });
    await vi.advanceTimersByTimeAsync(500);
    expect(result.dirs.version("src")).toBe(before);
  });

  it("an overflow batch reloads every open folder", async () => {
    const before = result.dirs.version("deep/er");
    env.emit("workspaceChanged", { watchId: "w-1", paths: [], gitChanged: false, overflow: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(result.dirs.version("deep/er")).toBeGreaterThan(before);
  });

  it("a completed fileChange of an agent in the project reloads its folders without any watch event", async () => {
    const before = { lib: result.dirs.version("lib"), docs: result.dirs.version("docs"), root: result.dirs.version("") };
    const item = { type: "fileChange", id: "f1", status: "completed", changes: [{ path: "/work/repo/lib/new.ts", kind: { type: "add" }, diff: "" }] };
    env.emit("sessionEvent", { sessionId: "s1", envelope: { native: { kind: "notification", message: { method: "item/completed", params: { item } } } } });
    await vi.advanceTimersByTimeAsync(200);
    expect(result.dirs.version("lib")).toBe(before.lib + 1);
    expect(result.dirs.version("docs")).toBe(before.docs);
    expect(result.dirs.version("")).toBe(before.root);
  });

  it("agents outside the workspace and other items do nothing; a turn's end reloads everything", async () => {
    const item = { type: "fileChange", changes: [{ path: "/work/repo/lib/new.ts", kind: { type: "add" } }] };
    const before = result.dirs.version("lib");
    env.emit("sessionEvent", { sessionId: "s2", envelope: { native: { kind: "notification", message: { method: "item/completed", params: { item } } } } });
    env.emit("sessionEvent", { sessionId: "s1", envelope: { native: { kind: "notification", message: { method: "item/completed", params: { item: { type: "agentMessage" } } } } } });
    env.emit("sessionEvent", { sessionId: "s1", envelope: { cutex: { method: "cutex/x" } } });
    await vi.advanceTimersByTimeAsync(200);
    expect(result.dirs.version("lib")).toBe(before);
    env.emit("sessionEvent", { sessionId: "s1", envelope: { native: { kind: "notification", message: { method: "turn/completed", params: { turn: { id: "t" } } } } } });
    await vi.advanceTimersByTimeAsync(200);
    expect(result.dirs.version("lib")).toBeGreaterThan(before);
    expect(result.dirs.version("anything")).toBeGreaterThan(0);
  });

  it("a turn seen from its start with only edits reloads just their folders; a command reloads all", async () => {
    const send = (method: string, params: unknown) => env.emit("sessionEvent", { sessionId: "s1", envelope: { native: { kind: "notification", message: { method, params } } } });
    const edit = { type: "fileChange", changes: [{ path: "/work/repo/lib/a.ts", kind: { type: "update", move_path: null } }] };
    const before = { lib: result.dirs.version("lib"), docs: result.dirs.version("docs") };
    send("turn/started", { turn: { id: "t1" } });
    send("item/completed", { item: { type: "agentMessage", text: "hi" } });
    send("item/completed", { item: edit });
    send("turn/completed", { turn: { id: "t1" } });
    await vi.advanceTimersByTimeAsync(200);
    expect(result.dirs.version("lib")).toBe(before.lib + 1);
    expect(result.dirs.version("docs")).toBe(before.docs);
    send("turn/started", { turn: { id: "t2" } });
    send("item/completed", { item: { type: "commandExecution", command: "touch docs/x" } });
    send("turn/completed", { turn: { id: "t2" } });
    await vi.advanceTimersByTimeAsync(200);
    expect(result.dirs.version("docs")).toBeGreaterThan(before.docs);
  });

  it("a host reconnect watches again and reloads everything", async () => {
    expect(env.watches).toEqual(["w-1"]);
    env.emit("daemonState", { state: { kind: "connected" } });
    await flush();
    expect(env.watches).toEqual(["w-1"]);
    const before = result.dirs.version("src");
    env.emit("daemonState", { state: { kind: "disconnected" } });
    env.emit("daemonState", { state: { kind: "connected" } });
    await flush();
    expect(env.watches).toEqual(["w-1", "w-2"]);
    expect(env.unwatched).toContain("w-1");
    await vi.advanceTimersByTimeAsync(200);
    expect(result.dirs.version("src")).toBeGreaterThan(before);
    // The new watch's batches count; the old one's no longer do.
    const mid = result.dirs.version("src");
    env.emit("workspaceChanged", { watchId: "w-1", paths: ["src/x"], gitChanged: false, overflow: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(result.dirs.version("src")).toBe(mid);
    env.emit("workspaceChanged", { watchId: "w-2", paths: ["src/x"], gitChanged: false, overflow: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(result.dirs.version("src")).toBe(mid + 1);
  });

  it("unmounting stops listening and unwatches", async () => {
    h.unmount();
    expect(env.unwatched).toContain("w-1");
    expect([...env.listeners.values()].every((s) => s.size === 0)).toBe(true);
  });
});
