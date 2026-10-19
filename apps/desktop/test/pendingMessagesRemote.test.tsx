// @vitest-environment jsdom
// Cross-host notes (peers `agent_tell to="name@host"`) in the 待读留言 section: the sender shows as
// `name@host` with a small 另一台主机 tag (never as a cutex service), and the owner's 唤醒 is offered
// for an idle agent like for any passive note.
import { createElement as h } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentMessageRecord } from "../src/renderer/src/lib/agentMessages";

const fx = vi.hoisted(() => ({ actions: [] as [string, string][] }));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => {
  const state = {
    notify: () => {},
    sidebar: null,
    pinned: [],
    byHost: {},
    hosts: { active: "local" },
    features: new Set<string>(),
    sessionAction: async (sessionId: string, method: string) => {
      fx.actions.push([sessionId, method]);
    },
  };
  return {
    ...(await importOriginal<object>()),
    selectedSidebar: () => null,
    useApp: Object.assign((select: (s: unknown) => unknown) => select(state), { getState: () => state, setState: () => {}, subscribe: () => () => {} }),
  };
});
vi.mock("../src/renderer/src/lib/viewHost", async (importOriginal) => ({ ...(await importOriginal<object>()), rowsOf: () => [] }));

const { PendingMessagesSection } = await import("../src/renderer/src/components/PendingMessagesSection");

const remoteNote: AgentMessageRecord = {
  messageId: "ptell-1",
  from: "worker@alpha",
  to: "cutex.b",
  sourceKind: null,
  timing: null,
  remote: { host: "alpha", peerId: "ci-0123456789abcdef0123456789abcdef", senderId: "cutex.remote" },
  senderName: "worker@alpha",
  recipientName: null,
  kind: "note",
  downgraded: false,
  body: "see /tmp/x",
  state: "pending",
  sentAt: 1,
  deliveredAt: null,
  turnId: null,
  error: null,
  failedLive: false,
};

describe("PendingMessagesSection: a note from another host", () => {
  it("names name@host with the another-host tag and offers 唤醒 on an idle agent", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(h(PendingMessagesSection, { sessionId: "cutex.b", messages: [remoteNote], busy: false })));
    const row = el.querySelector('[data-testid="pending-message"]')!;
    expect(row.textContent).toContain("worker@alpha");
    expect(row.textContent).not.toContain("system.cutex");
    const tag = el.querySelector('[data-testid="pending-message-remote"]')!;
    expect(tag.textContent).toBe("agentMsg.remote");
    expect(tag.getAttribute("title")).toBe('agentMsg.remoteHint:{"host":"alpha"}');
    const wake = el.querySelector<HTMLButtonElement>('[data-testid="wake-notes"]')!;
    expect(wake).not.toBeNull();
    await act(async () => wake.click());
    expect(fx.actions).toEqual([["cutex.b", "cutex/agentBus/wake"]]);
    // A local agent's note carries no tag.
    await act(async () => root.render(h(PendingMessagesSection, { sessionId: "cutex.b", messages: [{ ...remoteNote, remote: null, from: "cutex.a", senderName: "Alpha" }], busy: false })));
    expect(el.querySelector('[data-testid="pending-message-remote"]')).toBeNull();
    root.unmount();
  });
});
