// @vitest-environment jsdom
// Owner report 2026-10-24: after a send, the user bubble showed a status line under it (发送中… / 已送达 · 等待记录 /
// 发送失败); when the recorded message replaced it the row grew (the status line was h-6, the action row that took its
// place h-7) and the bubble jumped. Now the status is laid over one slot of one height (h-7) that the row keeps from
// the send to the recorded message (components/Timeline Entry, components/PendingSends). Measured in the mock preview
// (row 67 → 71 px before, 71 px throughout after): .claude/previews/send-status/.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  state: { selectedId: "s1", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {}, outbox: {}, features: new Set<string>(), byHost: {} } as Record<string, unknown>,
}));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentHost: () => "local",
  selectedSidebar: () => null,
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({ ...(await importOriginal<object>()), useHostOwnerNotes: () => ({}) }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSlot: () => [],
  useModuleEnabled: () => false,
  usePlacement: () => () => "show",
}));
vi.mock("../src/renderer/src/lib/foldView", () => ({ useMessageFold: () => ({ overflowing: false, canFold: false, folded: false, setFolded: () => {} }) }));
vi.mock("../src/renderer/src/components/Foldable", () => ({ Foldable: ({ children }: { children: unknown }) => children }));

const { TimelineBody } = await import("../src/renderer/src/components/Timeline");
const { orderedEntries, timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const { newOutboxEntry } = await import("../src/renderer/src/lib/legacyDelivery/outbox");
const { viewKey } = await import("../src/renderer/src/lib/viewKey");

const SID = "s1";
const CLIENT = "cm-status-1";
const TEXT = "看看发送状态会不会让气泡跳一下";
const earlier = { id: "t0", status: "completed", startedAt: 1792310749, completedAt: 1792310822, items: [{ type: "userMessage", id: "u0", content: [{ type: "text", text: "早先的消息" }] }, { type: "agentMessage", id: "a0", text: "好" }] };
// Recorded: the thread has the native userMessage carrying the send's clientId.
const recorded = { id: "t1", status: "inProgress", startedAt: 1792310900, items: [{ type: "userMessage", id: "u1", clientId: CLIENT, content: [{ type: "text", text: TEXT }] }] };

function render(turns: unknown[], pending: Record<string, unknown> | null) {
  const timeline = timelineFromThreadRead({ thread: { id: "thread-s1", turns } } as never);
  fx.state.outbox = pending ? { [viewKey("local", SID)]: [{ ...newOutboxEntry(timeline, { id: CLIENT, text: TEXT, strategy: "auto", placement: "turn" }), ...pending }] } : {};
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(h(TimelineBody, { timeline, entries: orderedEntries(timeline), sessionId: SID, nameOf: (id: string) => id, pendingSends: true } as never));
  const bubble = [...host.querySelectorAll<HTMLElement>("[data-send-bubble]")].find((b) => b.textContent!.includes(TEXT))!;
  return bubble.parentElement!;
}

/** What sizes the row: its children, their marks and their sizing classes (the bubble's dimming / red border are paint only; the status is laid over the slot, not one of them). */
const SIZING = /^(h-|min-h-|max-w-|p[xy]?-|m[tby]?-|gap-|flex|w-)/;
const layout = (row: HTMLElement) =>
  [...row.children].map((c) => [c.tagName, ...[...c.attributes].filter((x) => x.name.startsWith("data-") && x.name !== "data-testid").map((x) => x.name), ...(c.getAttribute("class") ?? "").split(/s+/).filter((k) => SIZING.test(k))].join(" "));

describe("the user bubble's status never moves the row (owner 2026-10-24)", () => {
  it("发送中… / 已送达 · 等待记录 / 发送失败 and the recorded message: the same rows, one slot of one height", () => {
    const sending = render([earlier], { state: "sending" });
    const confirmed = render([earlier], { state: "confirmed" });
    const failed = render([earlier], { state: "failed", error: "ssh tunnel closed" });
    const done = render([earlier, recorded], null);
    expect(sending.querySelector('[data-testid="outbox-status"]')!.textContent).toContain("outbox.sending");
    expect(failed.querySelector('[data-testid="outbox-status"]')!.textContent).toContain("outbox.failed");
    expect(done.querySelector('[data-testid="outbox-status"]')).toBeNull();
    expect(done.querySelector("[data-user-bar]")).not.toBeNull();
    // Bubble + slot in every state; the slot is the same fixed height.
    for (const row of [sending, confirmed, failed]) expect(layout(row)).toEqual(layout(done));
    const slot = done.querySelector<HTMLElement>("[data-user-slot]")!;
    expect(slot.className).toMatch(/\bh-7\b/);
    // The status is out of the layout: laid over the slot's right edge, never wider than the row.
    for (const row of [sending, confirmed, failed]) {
      const status = row.querySelector<HTMLElement>("[data-user-slot] > [data-testid='outbox-status']")!;
      expect(status.className).toMatch(/\babsolute\b/);
      expect(status.className).toMatch(/\bmax-w-full\b/);
      expect(status.className).not.toMatch(/\bh-6\b/);
    }
  });
});
