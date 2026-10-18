// Owner report 2026-10-18 (Livre Apps 开发-KIMI): an alarm-woken turn ended with owner_notify
// needs_reply, the sidebar said 「等Master回复」, yet the agent's conversation showed no card, and
// scrolling up landed on the thread's first turns (02:07 / 02:16) instead of the turn being read.
// The side agent view rendered its timeline `readOnly`, which also dropped every owner-notify card,
// and its scroller did not keep its place when an older history page was prepended at scrollTop 0.
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  state: { selectedId: "main-agent", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {}, outbox: {}, features: new Set(["owner-messages"]), byHost: {} } as Record<string, unknown>,
  notes: {} as Record<string, unknown>,
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
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useHostOwnerNotes: () => fx.notes,
}));
// No module host here: every slot is empty (rows fall back to the core renderers).
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSlot: () => [],
  useModuleEnabled: () => false,
  usePlacement: () => () => "show",
}));
// Message folding measures the DOM: off here.
vi.mock("../src/renderer/src/lib/foldView", () => ({ useMessageFold: () => ({ overflowing: false, canFold: false, folded: false, setFolded: () => {} }) }));
vi.mock("../src/renderer/src/components/Foldable", () => ({ Foldable: ({ children }: { children: unknown }) => children }));
// The card itself is OwnerNotifyCard's business: here only where (and whether) it is placed.
vi.mock("../src/renderer/src/components/OwnerNotifyCard", () => ({
  OwnerNotifyCard: ({ notificationId }: { notificationId: string }) => h("div", { "data-owner-note": notificationId }),
}));

const { TimelineBody } = await import("../src/renderer/src/components/Timeline");
const { orderedEntries, timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const { startMoved } = await import("../src/renderer/src/lib/keepOnPrepend");

const SRC = join(__dirname, "../src/renderer/src");
const AGENT = "cutex.livre";
const NOTE = "ntf-892db1f5";
const alarm = (id: string) => ({
  type: "functionCallOutput",
  id,
  name: "external_event",
  namespace: "external",
  output: JSON.stringify({ source: { kind: "service", id: "Cutex Alarm" }, type: "alarm", text: "Message Type: ALARM\nPayload:\n检查进度" }),
});
// The thread's shape around the notice: an owner turn, an alarm-started turn (no user message) that
// called owner_notify and ended with a reply, then the owner's next turns.
const read = {
  thread: {
    id: "thread-livre",
    turns: [
      { id: "t-owner", status: "completed", startedAt: 1792310749, completedAt: 1792310822, items: [{ type: "userMessage", id: "u1", content: [{ type: "text", text: "usb调试打开了" }] }, { type: "agentMessage", id: "a1", text: "好" }] },
      {
        id: "t-alarm",
        status: "completed",
        startedAt: 1792317261,
        completedAt: 1792317767,
        items: [
          alarm("alarm-f8467909"),
          { type: "commandExecution", id: "c1", command: "adb install", status: "completed", exitCode: 1 },
          { type: "mcpToolCall", id: "m1", server: "cutex", tool: "owner_notify", status: "completed", arguments: { needs_reply: true } },
          { type: "agentMessage", id: "a2", text: "卷一打包完成，卡在装机" },
        ],
      },
      { id: "t-next", status: "completed", startedAt: 1792317824, completedAt: 1792318022, items: [{ type: "userMessage", id: "u2", content: [{ type: "text", text: "手机插上了" }] }, { type: "agentMessage", id: "a3", text: "装机成功" }] },
    ],
  },
};
fx.notes = {
  [NOTE]: { notificationId: NOTE, agentId: AGENT, agentName: "Livre", origin: "agent", level: "attention", needsReply: true, state: "open", turnId: "t-alarm", createdAt: "2026-10-18T10:02:29.276Z", text: "回我一声我立刻装" },
};

function render(props: Record<string, unknown>) {
  const timeline = timelineFromThreadRead(read);
  return renderToStaticMarkup(h(TimelineBody, { timeline, entries: orderedEntries(timeline), sessionId: AGENT, nameOf: (id: string) => id, ...props } as never));
}

describe("owner-notify cards in the side agent view", () => {
  it("the owner's conversation places the card at the end of the alarm-started turn", () => {
    const html = render({});
    expect(html).toContain(`data-owner-note="${NOTE}"`);
    // After the alarm turn's reply, before the owner's next message.
    expect(html.indexOf(`data-owner-note="${NOTE}"`)).toBeGreaterThan(html.indexOf("卷一打包完成"));
    expect(html.indexOf(`data-owner-note="${NOTE}"`)).toBeLessThan(html.indexOf("手机插上了"));
  });

  it("read-only views drop it unless they keep owner notes (the side agent view does)", () => {
    expect(render({ readOnly: true })).not.toContain("data-owner-note");
    const side = render({ readOnly: true, ownerNotes: true });
    expect(side).toContain(`data-owner-note="${NOTE}"`);
    expect(side.indexOf(`data-owner-note="${NOTE}"`)).toBeLessThan(side.indexOf("手机插上了"));
  });

  it("SideAgent keeps the cards and its reading position when older turns are paged in", () => {
    const side = readFileSync(join(SRC, "modules/conversation/SideAgent.tsx"), "utf8");
    expect(side).toMatch(/<TimelineBody[^>]*\breadOnly\s+ownerNotes\b/);
    expect(side).toMatch(/useKeepOnPrepend\(scroller, sessionId, view\?\.timeline\.turns\[0\]\?\.id \?\? null, stick\)/);
  });
});

describe("keepOnPrepend startMoved", () => {
  it("fires when the same view's first loaded turn changes (a page landed above)", () => {
    expect(startMoved({ key: AGENT, turn: "t-12" }, { key: AGENT, turn: "t-1" })).toBe(true);
  });

  it("not on the first render, another agent, an unchanged start or an emptied view", () => {
    expect(startMoved({ key: null, turn: null }, { key: AGENT, turn: "t-1" })).toBe(false);
    expect(startMoved({ key: AGENT, turn: null }, { key: AGENT, turn: "t-1" })).toBe(false);
    expect(startMoved({ key: "other", turn: "t-9" }, { key: AGENT, turn: "t-1" })).toBe(false);
    expect(startMoved({ key: AGENT, turn: "t-1" }, { key: AGENT, turn: "t-1" })).toBe(false);
    expect(startMoved({ key: AGENT, turn: "t-1" }, { key: AGENT, turn: null })).toBe(false);
  });
});
