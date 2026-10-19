// @vitest-environment jsdom
// Owner report 2026-10-19: host-a's desktop showing a hachimi Claude agent — a safety check stopped a
// command, the timeline said 「已拦下，等Master决定 查看」 and 需要你, but 查看 answered 「这条消息不在已加载的历史里」:
// the card read the notice from the focus host only, so a notice of another host drew nothing, and its
// 批准一次 / 不批准 (and 知道了 / 回复 of an ordinary notice) went to the focus host.
import { createElement as h } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  notes: { local: {} as Record<string, unknown>, hachimi: {} as Record<string, unknown> } as Record<string, Record<string, unknown>>,
  safety: [] as [string, string, string][],
  acts: [] as [string, string, string][],
}));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => {
  const state = { notify: () => {}, sidebar: null, selectedId: null, selectedHost: null, hosts: { active: "local" }, features: new Set<string>(), byHost: {} };
  return {
    ...(await importOriginal<object>()),
    agentHost: () => "local",
    selectedSidebar: () => null,
    useApp: Object.assign((select: (s: unknown) => unknown) => select(state), { getState: () => state, setState: () => {}, subscribe: () => () => {} }),
  };
});
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useHostOwnerNotes: (hostId: string) => fx.notes[hostId] ?? {},
  safetyCheckAct: async (r: { agentId: string }, decision: string, hostId: string) => {
    fx.safety.push([r.agentId, decision, hostId]);
    return { ok: true };
  },
  ownerNotifyAct: async (r: { agentId: string }, action: string, _text: unknown, hostId: string) => {
    fx.acts.push([r.agentId, action, hostId]);
    return { ok: true };
  },
}));

// jsdom has no ResizeObserver (the card's Markdown / fold measure with it).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { OwnerNotifyCard } = await import("../src/renderer/src/components/OwnerNotifyCard");

const AGENT = "cutex.hachimi-dev";
const blockNote = {
  notificationId: "ntf-safety",
  agentId: AGENT,
  agentName: "hachimi-cutex-dev",
  level: "attention",
  state: "pending",
  createdAt: "2026-10-19T03:20:00Z",
  title: "Claude Code safety check",
  body: "",
  safetyBlock: { blockId: "sb-1", threadId: "t-1", itemId: "i-1", toolName: "Bash", command: "rm -f $X/*", reason: "possibly empty variable", state: "blocked", blockedAt: "2026-10-19T03:20:00Z", grantSeconds: 1800, expiresAt: null },
};

function render(el: ReturnType<typeof h>) {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  act(() => root.render(el));
  return { div, unmount: () => act(() => root.unmount()) };
}

describe("owner notices of an agent on another host than the focus one", () => {
  it("the safety block card is drawn from that host and its decision goes there", async () => {
    fx.notes.hachimi = { "ntf-safety": blockNote };
    const { div, unmount } = render(h(OwnerNotifyCard, { notificationId: "ntf-safety", sessionId: AGENT, hostId: "hachimi" }));
    expect(div.querySelector("[data-safety-block]")).not.toBeNull();
    const grant = [...div.querySelectorAll("button")].find((b) => /grant|批准/i.test(b.textContent ?? ""));
    expect(grant).toBeTruthy();
    await act(async () => grant!.click());
    expect(fx.safety).toEqual([[AGENT, "grant", "hachimi"]]);
    unmount();
  });

  it("the focus host's notices do not stand in for another host's", () => {
    fx.notes.hachimi = {};
    fx.notes.local = { "ntf-safety": blockNote };
    const { div, unmount } = render(h(OwnerNotifyCard, { notificationId: "ntf-safety", sessionId: AGENT, hostId: "hachimi" }));
    expect(div.querySelector("[data-safety-block]")).toBeNull();
    unmount();
  });
});
