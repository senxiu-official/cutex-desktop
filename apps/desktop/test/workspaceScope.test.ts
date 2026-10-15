// Regression for 98ce155: when the workspace scope disappears (no agent / an agent without a
// workspace), useWorkspace must drop the previous scope's git status and error instead of keeping
// them on screen. Runs the real hook under a minimal hooks harness (no DOM in the test env).
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    /** One render + commit: run changed effects (cleanup first), like React does. */
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
    reset() {
      state.length = 0;
      effects.length = 0;
      queue = [];
    },
  };
});

vi.mock("react", () => ({ useState: h.useState, useEffect: h.useEffect, createContext: (value: unknown) => ({ Provider: null, value }), useContext: (ctx: { value: unknown }) => ctx.value }));
const git = vi.hoisted(() => {
  const calls: { scope: unknown; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const api = {
    gitStatus: (scope: unknown) => new Promise((resolve, reject) => calls.push({ scope, resolve, reject })),
    watchWorkspace: async () => "w-1",
    unwatchWorkspace: async () => {},
  };
  return { calls, api };
});
vi.mock("../src/renderer/src/store", () => ({ useApp: () => null, hostApi: () => git.api, agentHost: () => "local", selectedSidebar: () => null }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: git.api,
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));

const { useWorkspace } = await import("../src/renderer/src/lib/workspaceView");
type Scope = Parameters<typeof useWorkspace>[0];

const flush = () => new Promise((r) => setTimeout(r, 0));
const STATUS = { branch: "main", files: [{ path: "a.ts", added: 1, deleted: 0 }] };

describe("useWorkspace scope changes (98ce155)", () => {
  beforeEach(() => {
    h.reset();
    git.calls.length = 0;
  });

  it("a null scope clears the previous scope's git status", async () => {
    const a = { kind: "agent", id: "a" } as unknown as Scope;
    h.render(() => useWorkspace(a, "local"));
    git.calls[0]!.resolve(STATUS);
    await flush();
    expect(h.render(() => useWorkspace(a, "local")).git).toEqual(STATUS);
    h.render(() => useWorkspace(null, "local"));
    expect(h.render(() => useWorkspace(null, "local"))).toMatchObject({ git: null, error: null });
  });

  it("a null scope clears the previous scope's error", async () => {
    const a = { kind: "agent", id: "a" } as unknown as Scope;
    h.render(() => useWorkspace(a, "local"));
    git.calls[0]!.reject(new Error("workspace routes unsupported"));
    await flush();
    expect(h.render(() => useWorkspace(a, "local")).error).toBe("workspace routes unsupported");
    h.render(() => useWorkspace(null, "local"));
    expect(h.render(() => useWorkspace(null, "local"))).toMatchObject({ git: null, error: null });
  });

  it("a request still in flight when the scope disappears is ignored", async () => {
    const a = { kind: "agent", id: "a" } as unknown as Scope;
    h.render(() => useWorkspace(a, "local"));
    h.render(() => useWorkspace(null, "local"));
    git.calls[0]!.resolve(STATUS);
    await flush();
    expect(h.render(() => useWorkspace(null, "local"))).toMatchObject({ git: null, error: null });
  });

  it("switching to another scope clears the old status until the new one loads", async () => {
    const a = { kind: "agent", id: "a" } as unknown as Scope;
    const b = { kind: "agent", id: "b" } as unknown as Scope;
    h.render(() => useWorkspace(a, "local"));
    git.calls[0]!.resolve(STATUS);
    await flush();
    h.render(() => useWorkspace(a, "local"));
    h.render(() => useWorkspace(b, "local"));
    expect(h.render(() => useWorkspace(b, "local")).git).toBeNull();
    git.calls[1]!.resolve({ ...STATUS, branch: "dev" });
    await flush();
    expect(h.render(() => useWorkspace(b, "local")).git).toMatchObject({ branch: "dev" });
  });
});
