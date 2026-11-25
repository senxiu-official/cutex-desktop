// @vitest-environment jsdom
// Owner 2026-11-24: opening the Director (many owner_notify notes) first showed a long stack of old 给{{owner}}的消息 cards
// (11-05 … 11-19), then the conversation. Not a full load (bootstrap reads one page of turns): before that page lands
// the view has no turn rows, so placeOwnerNotes put every note of the agent at the head; once the page landed they were
// re-placed into its turns (or hidden with older turns). Now nothing is placed while the first page is on its way.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  state: { selectedId: "cutex.director", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {}, outbox: {}, features: new Set(["owner-messages"]), byHost: {} } as Record<string, unknown>,
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
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({ ...(await importOriginal<object>()), useHostOwnerNotes: () => fx.notes }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSlot: () => [],
  useModuleEnabled: () => false,
  usePlacement: () => () => "show",
}));
vi.mock("../src/renderer/src/lib/foldView", () => ({ useMessageFold: () => ({ overflowing: false, canFold: false, folded: false, setFolded: () => {} }) }));
vi.mock("../src/renderer/src/components/Foldable", () => ({ Foldable: ({ children }: { children: unknown }) => children }));
vi.mock("../src/renderer/src/components/OwnerNotifyCard", () => ({
  OwnerNotifyCard: ({ notificationId }: { notificationId: string }) => h("div", { "data-owner-note": notificationId }),
}));

const { TimelineBody } = await import("../src/renderer/src/components/Timeline");
const { orderedEntries, timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const { viewKey } = await import("../src/renderer/src/lib/viewKey");

const AGENT = "cutex.director";
const day = (d: number) => Date.parse(`2026-11-${String(d).padStart(2, "0")}T03:00:00Z`) / 1000;
// Old acknowledged notes, one a day 11-05 … 11-19 (their turns are older than the first page), and one in the newest turn.
for (let d = 5; d <= 19; d++) fx.notes[`old-${d}`] = { notificationId: `old-${d}`, agentId: AGENT, agentName: "Director", origin: "agent", level: "info", needsReply: false, state: "acknowledged", turnId: `t-${d}`, createdAt: new Date(day(d) * 1000 + 60000).toISOString(), text: `note ${d}` };
fx.notes["new-24"] = { notificationId: "new-24", agentId: AGENT, agentName: "Director", origin: "agent", level: "attention", needsReply: true, state: "open", turnId: "t-24", createdAt: new Date(day(24) * 1000 + 60000).toISOString(), text: "需要你" };
const turn = (d: number) => ({ id: `t-${d}`, status: "completed", startedAt: day(d), completedAt: day(d) + 120, items: [{ type: "userMessage", id: `u${d}`, content: [{ type: "text", text: `owner ${d}` }] }, { type: "agentMessage", id: `a${d}`, text: `reply ${d}` }] });
const firstPage = { thread: { id: "thread-dir", turns: [turn(23), turn(24)] } };
const empty = { thread: { id: "thread-dir", turns: [] } };

function render(read: unknown, view: { loading: boolean; error?: string | null }, older: { cursor: string | null } | null) {
  const timeline = timelineFromThreadRead(read as never);
  fx.state.sessions = { [viewKey("local", AGENT)]: { loading: view.loading, error: view.error ?? null, timeline, version: 0, queue: [], older } };
  const html = renderToStaticMarkup(h(TimelineBody, { timeline, sessionId: AGENT, nameOf: (id: string) => id, older: older && { ...older, loading: false, error: null, added: 0 } } as never));
  return { html, notes: [...html.matchAll(/data-owner-note="([^"]+)"/g)].map((m) => m[1]) };
}

describe("owner notes before the first history page", () => {
  it("loading, no turn read yet: no note is placed (no stack of old cards at the head)", () => {
    expect(render(empty, { loading: true }, null).notes).toEqual([]);
  });

  it("the page landed (older history left on the host): only the shown turns' notes, inside their turn", () => {
    const { html, notes } = render(firstPage, { loading: false }, { cursor: "c-22" });
    expect(notes).toEqual(["new-24"]);
    expect(html.indexOf('data-owner-note="new-24"')).toBeGreaterThan(html.indexOf("reply 24"));
  });

  it("a session with no turns at all (notes only): every note at the head once its page is here, as before", () => {
    expect(render(empty, { loading: false }, null).notes).toEqual([...Array.from({ length: 15 }, (_, i) => `old-${i + 5}`), "new-24"]);
  });

  it("a failed first load keeps today's behaviour (notes at the head, nothing to wait for)", () => {
    expect(render(empty, { loading: false, error: "boom" }, null).notes).toHaveLength(16);
  });

  it("a reload over turns already shown (loading again) keeps its notes in place", () => {
    expect(render(firstPage, { loading: true }, { cursor: "c-22" }).notes).toEqual(["new-24"]);
  });
});
