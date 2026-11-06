// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ host: "original", restore: vi.fn(), dismiss: vi.fn(), start: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: (select: (state: unknown) => unknown) => select({ features: new Set(["runtime-restore-candidates"]), hosts: { active: fx.host }, sessionAction: fx.start }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: (host: string) => ({ restoreCandidates: () => fx.restore(host), dismissRestoreCandidates: () => fx.dismiss(host) }) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }), translate: (key: string) => key }));
vi.mock("../src/renderer/src/lib/openOverlays", () => ({ useTrackOverlay: () => {} }));
vi.mock("../src/renderer/src/lib/ownerContext", () => ({ useOwnerWindow: () => window }));
import { RestoreBanner } from "../src/renderer/src/components/RestoreBanner";
import { HostBusyActionExhausted } from "../src/renderer/src/lib/hostBusyActions";
import { useBackgroundOperations } from "../src/renderer/src/lib/backgroundOperations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let div: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const candidates = (ids: string[]) => ({ reason: "unclean_stop", items: ids.map(id => ({ cutexSessionId: id, displayName: id, lastOnlineAt: "2026-11-01T00:00:00Z" })) });
const click = async (key: string) => act(async () => { [...div.querySelectorAll("button")].find(button => button.textContent === key)!.click(); });

beforeEach(async () => {
  useBackgroundOperations.setState({operations:[]});
  vi.resetAllMocks();
  fx.host = "original";
  fx.restore.mockResolvedValue(candidates(["a", "b"]));
  fx.start.mockResolvedValue({ status: "online" });
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  await act(async () => root.render(h(RestoreBanner)));
});
afterEach(() => { act(() => root.unmount()); div.remove(); });

it("keeps restore progress and results after the initiating view unmounts", async () => {
  let finish!: () => void;
  fx.start.mockImplementationOnce(() => new Promise<void>(resolve => { finish=resolve; }));
  await click("restore.all");
  await act(async () => root.render(null));
  expect(useBackgroundOperations.getState().operations[0]!.items.map(item=>item.state)).toEqual(["running","queued"]);
  await act(async () => finish());
  expect(fx.start.mock.calls.map(call=>[call[0],call[3]])).toEqual([["a","original"],["b","original"]]);
  expect(useBackgroundOperations.getState().operations[0]!.items.map(item=>item.state)).toEqual(["done","done"]);
});

it("keeps host busy out of per-agent generic failures and continues the batch", async () => {
  fx.start.mockRejectedValueOnce(new HostBusyActionExhausted());
  await click("restore.all");
  expect(fx.start.mock.calls).toEqual([
    ["a", "cutex/runtime/online", { openVisibleTerminal: false }, "original"],
    ["b", "cutex/runtime/online", { openVisibleTerminal: false }, "original"],
  ]);
  expect(div.textContent).not.toContain("restore.failedOne");
  expect(div.textContent).not.toContain("hostAction.exhausted");
});

it("keeps remaining starts on the original host and ignores old completion in the new host view", async () => {
  let release!: () => void;
  fx.start.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  await click("restore.all");
  expect(fx.start).toHaveBeenCalledTimes(1);
  fx.host = "other";
  fx.restore.mockResolvedValue(candidates(["other-agent"]));
  await act(async () => root.render(h(RestoreBanner)));
  await act(async () => release());
  expect(fx.start.mock.calls.map(call => [call[0], call[3]])).toEqual([["a", "original"], ["b", "original"]]);
  expect(fx.restore.mock.calls.map(call => call[0])).toEqual(["original", "other"]);
  await click("restore.all");
  expect(fx.start.mock.calls.at(-1)).toEqual(["other-agent", "cutex/runtime/online", { openVisibleTerminal: false }, "other"]);
});

it("ignores restore listings that arrive after the host changes", async () => {
  let late!: (value: unknown) => void;
  fx.host = "slow";
  fx.restore.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  await act(async () => root.render(h(RestoreBanner)));
  fx.host = "other";
  fx.restore.mockResolvedValue(candidates(["other-agent"]));
  await act(async () => root.render(h(RestoreBanner)));
  await act(async () => late(candidates(["wrong-agent"])));
  await click("restore.all");
  expect(fx.start.mock.calls.map(call => call[0])).toEqual(["other-agent"]);
});
