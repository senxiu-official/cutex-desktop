// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SideBodyProps, SideOpenOptions } from "../src/renderer/src/modules/slots";
import type { ItemId, Json } from "../src/renderer/src/modules/types";
import type { SideLayout } from "../src/renderer/src/lib/sideLayout";
const fx = vi.hoisted(() => ({ layout: null as SideLayout | null, focusedCard: null as string | null, open: vi.fn(), reveal: vi.fn(), close: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), cleanIpcMessage: (m: string) => m, bridge: { on: () => () => {} } }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { side: { open: fx.open, reveal: fx.reveal } } }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: () => true }));
vi.mock("../src/renderer/src/lib/sideLayoutStore", () => ({ useSide: { getState: () => ({ layout: fx.layout!, focusedCard: fx.focusedCard }) } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign(() => true, { getState: () => ({ selectedId: "kai" }) }), featuresOf: () => new Set() }));
vi.mock("../src/renderer/src/components/DelegationCard", () => ({ DelegationDetailBody: () => null }));
vi.mock("../src/renderer/src/lib/delegationMenu", () => ({ delegationMenu: () => [] }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ useDelegation: () => undefined, useDelegations: () => undefined, hasDelegationViews: () => true, loadDelegationDetail: async () => null }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useAgentNames: () => () => "", useAgentProfile: () => null, useDelegationContext: () => () => ({}) }));
vi.mock("../src/renderer/src/i18n", async original => ({ ...await original<object>(), useI18n: () => ({ t: (key: string) => key === "settings.back" ? "返回" : key }) }));
import { applyOpen, closeInstances, emptyLayout, locate, place, placeSpec, revealInstance } from "../src/renderer/src/lib/sideLayout";
import { DETAIL, detailReturnSource, initDetail, parseDetailParams, type DetailState } from "../src/renderer/src/modules/delegations/detail";
import { openDelegationRef } from "../src/renderer/src/modules/delegations/refTarget";
import { delegationRef } from "../src/renderer/src/lib/delegationRefs";
import { DetailBody } from "../src/renderer/src/modules/delegations/DetailView";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
function source(kind: ItemId) {
  const base = emptyLayout();
  const decision = place(base, { kind, binding: { kind: "host", hostId: "local" }, key: "source", transient: false, activePage: null, columnOpen: true }, placeSpec({ home: "source" }));
  const applied = applyOpen(base, decision, { kind, binding: { kind: "host", hostId: "local" }, key: "source", state: { query: "worker", filter: "running", scroll: 123 }, v: 1, pinned: true }, 1, { reveal: true, home: "source" });
  fx.layout = applied.layout; fx.focusedCard = locate(applied.layout, applied.instanceId)!.card.id;
  return applied.instanceId;
}
beforeEach(() => {
  vi.clearAllMocks(); fx.layout = emptyLayout(); fx.focusedCard = null;
  fx.open.mockImplementation((kind: ItemId, params: Json, options: SideOpenOptions) => {
    const p = parseDetailParams(params)!;
    const decision = place(fx.layout!, { kind, binding: options.binding!, key: p.askId, transient: !options.pin, activePage: fx.layout!.activePage, columnOpen: true }, placeSpec({ home: "delegations" }));
    const result = applyOpen(fx.layout!, decision, { kind, binding: options.binding!, key: p.askId, state: { ...initDetail(p, null) }, v: 2, pinned: !!options.pin }, 2, { reveal: true, home: "delegations" });
    fx.layout = result.layout;
    return { status: "opened", instanceId: result.instanceId, pageId: result.pageId, reused: result.reused, where: "card" };
  });
  fx.reveal.mockImplementation(({ instanceId }: { instanceId: string }) => { fx.layout = revealInstance(fx.layout!, instanceId, 3); });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it.each(["project-view.view", "page:delegations.page"] as const)("Back returns from a delegation to the exact %s source instance", kind => {
  const origin = source(kind), previousState = fx.layout!.instances[origin]!.state;
  expect(openDelegationRef(delegationRef("local", "ask-7", "Review"), "page").status).toBe("opened");
  const opened = Object.values(fx.layout!.instances).find(i => i.kind === DETAIL)!;
  const id = Object.keys(fx.layout!.instances).find(id => fx.layout!.instances[id] === opened)!;
  expect(opened.state).toMatchObject({ returnTo: origin });
  expect(fx.open.mock.calls[0]![2]).toMatchObject({ pin: true });
  fx.close.mockImplementation(() => { fx.layout = closeInstances(fx.layout!, [id]); });
  const props = { instance: { id, ...opened }, hostId: null, close: fx.close } as unknown as SideBodyProps<DetailState>;
  act(() => root.render(h(DetailBody, props)));
  expect(host.textContent).toContain("返回");
  act(() => host.querySelector<HTMLButtonElement>("[data-delegation-back]")!.click());
  expect(fx.reveal).toHaveBeenCalledWith({ instanceId: origin });
  expect(fx.close).toHaveBeenCalledOnce();
  expect(fx.layout!.activePage).toBe(locate(fx.layout!, origin)!.page.id);
  expect(fx.layout!.instances[origin]!.state).toBe(previousState);
  expect(fx.layout!.instances[id]).toBeUndefined();
});
it("a detail opened without an origin still has a close/back action, including error states", () => {
  act(() => root.render(h(DetailBody, { instance: { id: "detail", state: { askId: "ask-7" } }, hostId: null, close: fx.close } as unknown as SideBodyProps<DetailState>)));
  act(() => host.querySelector<HTMLButtonElement>("[data-delegation-back]")!.click());
  expect(fx.close).toHaveBeenCalledOnce(); expect(fx.reveal).not.toHaveBeenCalled();
});
it("reopening the same detail preserves its origin and does not return to itself", () => {
  const origin = source("project-view.view");
  openDelegationRef(delegationRef("local", "ask-7"), "page");
  fx.focusedCard = fx.layout!.pages.find(p => p.id === fx.layout!.activePage)!.cards[0]!.id;
  expect(detailReturnSource(fx.layout!, fx.focusedCard, "ask-7")).toBe(origin);
  expect(parseDetailParams({ askId: "ask-7", returnTo: "../bad" })).toEqual({ askId: "ask-7" });
});
