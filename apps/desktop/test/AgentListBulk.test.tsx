// @vitest-environment jsdom
import { act, createContext, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentRow } from "../src/renderer/src/lib/sidebar";
const fx = vi.hoisted(() => ({ host: "original", archived: false, rows: [] as AgentRow[], action: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }), translate: (key: string) => key }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: (s: unknown) => unknown) => select({ activity: {} }), { getState: () => ({ sessionAction: fx.action }) }), sidebarOf: () => ({ retired: [] }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => fx.host, useTargetIsFocus: () => false, useTargetSelect: () => vi.fn() }));
vi.mock("../src/renderer/src/lib/sidebarView", () => ({ useSidebarModel: () => ({ groups: [{ id: "group", online: [], offline: fx.archived ? [] : fx.rows }], archived: fx.archived ? fx.rows : [], chats: [] }), relativeTime: () => "" }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ confirmDialog: async () => true, contextMenu: () => () => {}, openMenuFrom: () => {} }));
vi.mock("../src/renderer/src/lib/menus", () => ({ agentMenu: () => [], ownedServicesNote: () => null, restoreArchived: vi.fn() }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ cachedProfileList: () => null, loadProfileList: async () => null }));
vi.mock("../src/renderer/src/lib/attentionView", () => ({ AttentionContext: createContext(null), useAttention: () => null, useAttentionSource: () => null, useRowSignal: () => ({ signal: null, needs: null }) }));
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ rawIdTitle: () => null, useModelName: () => () => "" }));
vi.mock("../src/renderer/src/lib/modelOverloadRetryView", () => ({ useModelOverloadRetry: () => null }));
vi.mock("../src/renderer/src/lib/sizeFlags", () => ({ dataFlags: () => ({}), useSizeFlags: () => [null, {}], widthBelow: () => () => false }));
vi.mock("../src/renderer/src/components/Avatar", () => ({ Avatar: () => null }));
vi.mock("../src/renderer/src/components/AgentStatus", () => ({ RunningTime: () => null, StatusAvatar: () => null, StatusPill: () => null }));
import { AgentList } from "../src/renderer/src/components/AgentList";
import { HostBusyActionExhausted } from "../src/renderer/src/lib/hostBusyActions";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([false, true])("bulk starts (archived=%s) wait for each agent, keep original host after switching and do not count host busy as generic failure", async archived => {
  fx.host = "original";
  fx.archived = archived;
  fx.action.mockReset();
  fx.rows = ["a", "b", "c"].map(id => ({ id, hostId: "original", name: id, status: "offline", session: { cutexSessionId: id, displayName: id, runtime: { status: "offline", runtimeGeneration: 7, activeTurnId: null } } }) as AgentRow);
  let release!: () => void;
  fx.action.mockImplementation(async (id: string, method: string) => {
    if (!method.endsWith("/online")) return;
    if (id === "a") { await new Promise<void>(resolve => { release = resolve; }); throw new HostBusyActionExhausted(); }
    if (id === "b") throw new Error("real start failure");
  });
  const div = document.createElement("div"); document.body.append(div);
  const root = createRoot(div);
  try {
    const render = () => root.render(h(AgentList, { groupId: "group", variant: "dialog", initialTab: archived ? "archived" : "offline" }));
    await act(async () => render());
    await act(async () => div.querySelector<HTMLInputElement>('input[title="agents.selectAll"]')!.click());
    await act(async () => [...div.querySelectorAll("button")].find(b => b.textContent === (archived ? "agents.restoreStart" : "agents.start"))!.click());
    expect(fx.action.mock.calls.filter(call => call[1].endsWith("/online"))).toHaveLength(1);
    fx.host = "other";
    await act(async () => render());
    await act(async () => release());
    expect(fx.action.mock.calls.filter(call => call[1].endsWith("/online")).map(call => [call[0], call[1], call[3]])).toEqual(["a", "b", "c"].map(id => [id, "cutex/runtime/online", "original"]));
    expect(fx.action.mock.calls.every(call => call[3] === "original")).toBe(true);
    expect(div.querySelectorAll('[title="real start failure"]')).toHaveLength(1);
    expect(div.textContent).not.toContain("hostAction.exhausted");
    expect(div.textContent?.match(/agents.state.failed/g)).toHaveLength(1);
  } finally { act(() => root.unmount()); div.remove(); }
});

it("a click next to a row's checkbox selects the row instead of opening the agent", async () => {
  fx.host = "original";
  fx.archived = false;
  fx.rows = ["a"].map(id => ({ id, hostId: "original", name: id, status: "offline", session: { cutexSessionId: id, displayName: id, runtime: { status: "offline", runtimeGeneration: 1, activeTurnId: null } } }) as AgentRow);
  const div = document.createElement("div"); document.body.append(div);
  const root = createRoot(div);
  try {
    await act(async () => root.render(h(AgentList, { groupId: "group", variant: "dialog", initialTab: "offline" })));
    const row = div.querySelector<HTMLElement>("[data-agent-row]")!;
    const hit = row.querySelector<HTMLElement>("[data-checkbox-hit]")!;
    const box = hit.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    await act(async () => hit.click());
    expect(row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    await act(async () => hit.click());
    expect(row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    await act(async () => row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  } finally { act(() => root.unmount()); div.remove(); }
});
