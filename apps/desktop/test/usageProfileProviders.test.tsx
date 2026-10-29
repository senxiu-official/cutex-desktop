// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";

const state = vi.hoisted(() => ({
  hostId: "a", api: { listProfiles: vi.fn() },
  lists: new Map<string, readonly ProfileItem[]>(), listeners: new Set<() => void>(),
}));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({ ...(await importOriginal<object>()), useTargetApi: () => state.api, useTargetHostId: () => state.hostId }));
vi.mock("../src/renderer/src/lib/profileAccountLinks", () => ({
  accountProfilesForHost: (id: string) => state.lists.get(id),
  subscribeAccountProfiles: (fn: () => void) => { state.listeners.add(fn); return () => state.listeners.delete(fn); },
  noteAccountProfiles: (id: string, profiles: readonly ProfileItem[]) => { state.lists.set(id, profiles); for (const fn of state.listeners) fn(); },
}));
const { useProfileProviders } = await import("../src/renderer/src/modules/usage/useProfileProviders");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function View() { const profiles = useProfileProviders(); return createElement("span", null, profiles === undefined ? "loading" : profiles === null ? "failed" : [...profiles.keys()].join(",")); }
const profile = (name: string) => ({ id: name, name }) as ProfileItem;
function publish(id: string, profiles: ProfileItem[]) { state.lists.set(id, profiles); for (const fn of state.listeners) fn(); }
function deferred() { let resolve!: (result: { profiles: ProfileItem[] }) => void; const promise = new Promise<{ profiles: ProfileItem[] }>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { state.hostId = "a"; state.api.listProfiles.mockReset(); state.lists.clear(); state.listeners.clear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

it("shows refreshed link metadata and an explicitly empty profile list", async () => {
  state.api.listProfiles.mockResolvedValue({ profiles: [profile("first")] });
  await act(async () => { root.render(createElement(View)); });
  expect(container.textContent).toBe("first");
  act(() => publish("a", [profile("renamed")]));
  expect(container.textContent).toBe("renamed");
  act(() => publish("a", []));
  expect(container.textContent).toBe("");
});

it("does not overwrite newer link-state metadata with an older in-flight response", async () => {
  const old = deferred(); state.api.listProfiles.mockReturnValue(old.promise);
  act(() => root.render(createElement(View)));
  act(() => publish("a", [profile("new-link")]));
  await act(async () => old.resolve({ profiles: [profile("old-link")] }));
  expect(container.textContent).toBe("new-link");
});

it("drops responses from a previous selected host", async () => {
  const a = deferred(), b = deferred(); state.api.listProfiles.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  act(() => root.render(createElement(View)));
  state.hostId = "b";
  act(() => root.render(createElement(View)));
  await act(async () => a.resolve({ profiles: [profile("host-a")] }));
  expect(container.textContent).toBe("loading");
  expect(state.lists.has("a")).toBe(false);
  await act(async () => b.resolve({ profiles: [profile("host-b")] }));
  expect(container.textContent).toBe("host-b");
});

it("does not republish an old connection's response after a host reset", async () => {
  const old = deferred(); state.api.listProfiles.mockReturnValue(old.promise);
  act(() => root.render(createElement(View)));
  act(() => fireHostReset("a"));
  await act(async () => old.resolve({ profiles: [profile("old-connection")] }));
  expect(state.lists.has("a")).toBe(false);
  expect(container.textContent).toBe("loading");
});
