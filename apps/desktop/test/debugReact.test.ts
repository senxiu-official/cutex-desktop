// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  delete (window as unknown as Record<string, unknown>).__cutexDebugReact;
  localStorage.removeItem("cutex-desktop.debugMode");
  vi.resetModules();
});
it("installs no React hook by default", async () => {
  await import("../src/renderer/src/lib/debugReact");
  expect((window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeUndefined();
});
it("captures real commit callbacks when enabled before React starts and removes its callback when off", async () => {
  localStorage.setItem("cutex-desktop.debugMode", "true");
  const { configureDebugReact, drainDebugReact } = await import("../src/renderer/src/lib/debugReact");
  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: { inject(): void; onCommitFiberRoot?: (...args: unknown[]) => void } }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  hook.inject();
  hook.onCommitFiberRoot!(1, { current: { child: { type: { name: "Conversation" }, flags: 1 } } });
  expect(drainDebugReact()[0]).toMatchObject({ kind: "react-commit", data: { components: ["Conversation"] } });
  expect(configureDebugReact(true)).toBe(true);
  configureDebugReact(false);
  expect(hook.onCommitFiberRoot).toBeUndefined();
  expect(drainDebugReact()).toEqual([]);
});
it("does not double-record or keep collecting after Fast Refresh / another DevTools wrapper chains its callback", async () => {
  localStorage.setItem("cutex-desktop.debugMode", "true");
  const { configureDebugReact, drainDebugReact } = await import("../src/renderer/src/lib/debugReact");
  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: { onCommitFiberRoot?: (...args: unknown[]) => void } }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const initial = hook.onCommitFiberRoot!;
  hook.onCommitFiberRoot = (...args) => initial(...args); // installed after our early preload hook
  configureDebugReact(true);
  hook.onCommitFiberRoot!(1, { current: { type: { name: "Conversation" } } });
  expect(drainDebugReact()).toHaveLength(1);
  configureDebugReact(false);
  hook.onCommitFiberRoot!(1, { current: { type: { name: "Conversation" } } });
  expect(drainDebugReact()).toEqual([]);
});
