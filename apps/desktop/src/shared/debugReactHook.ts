/** Serialized by contextBridge: every runtime dependency must remain inside this function. */
export function installDebugReactHook(): void {
  type DebugEntry = { time: number; kind: string; source: string; data: unknown };
  type Fiber = { type?: { displayName?: string; name?: string }; child?: Fiber; sibling?: Fiber; flags?: number; memoizedProps?: unknown; memoizedState?: unknown; alternate?: Fiber };
  type Hook = { supportsFiber?: boolean; inject?: (renderer: unknown) => number; renderers?: Map<number, unknown>; onCommitFiberRoot?: (...args: unknown[]) => void };
  const global = globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook; __cutexDebugReact?: { configure(enabled: boolean): boolean; drain(): DebugEntry[] } };
  if (global.__cutexDebugReact) { global.__cutexDebugReact.configure(true); return; }
  let generation = 0, recording = false;
  let queue: DebugEntry[] = [], seen = false, restore: (() => void) | null = null;
  function configureDebugReact(enabled: boolean): boolean {
    const current = ++generation; recording = enabled;
    restore?.(); restore = null;
    queue = [];
    if (!enabled) return false;
    let hook = global.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) {
      const renderers = new Map<number, unknown>();
      hook = { supportsFiber: true, renderers, inject: renderer => { seen = true; const id = renderers.size + 1; renderers.set(id, renderer); return id; } };
      global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
    }
    const original = hook.onCommitFiberRoot;
    const commit = (...args: unknown[]) => {
      original?.apply(hook, args);
      if (!recording || current !== generation) return;
      seen = true;
      const root = args[1] as { current?: Fiber } | undefined;
      const names = new Set<string>(), todo: Fiber[] = root?.current ? [root.current] : [];
      for (let n = 0; todo.length && n < 2000; n++) {
        const fiber = todo.pop()!;
        const name = fiber.type?.displayName || fiber.type?.name;
        if (name && (!fiber.alternate || fiber.memoizedProps !== fiber.alternate.memoizedProps || fiber.memoizedState !== fiber.alternate.memoizedState)) names.add(name);
        if (fiber.sibling) todo.push(fiber.sibling);
        if (fiber.child) todo.push(fiber.child);
      }
      queue.push({ time: Date.now(), kind: "react-commit", source: "React", data: { renderer: args[0], components: [...names].slice(-32), traversalLimit: 2000 } });
      if (queue.length > 64) queue.shift();
    };
    hook.onCommitFiberRoot = commit;
    restore = () => { if (hook.onCommitFiberRoot === commit) { if (original) hook.onCommitFiberRoot = original; else delete hook.onCommitFiberRoot; } };
    return seen || !!hook.renderers?.size;
  }
  function drainDebugReact(): DebugEntry[] { const out = queue; queue = []; return out; }

  global.__cutexDebugReact = { configure: configureDebugReact, drain: drainDebugReact };
  configureDebugReact(true);
}
