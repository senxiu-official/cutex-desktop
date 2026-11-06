// 需要你 (owner 2026-11-05): the one list behind the tray's 通知中心 and the status-row bell — who is in it (needs-you
// and 出错, the open agent too, not finished turns, not dismissed ones), its pages and where its panel opens.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostKey } from "../src/renderer/src/lib/hostKeys";

const fx = vi.hoisted(() => ({ rows: [] as unknown[], signals: new Map(), needs: new Map(), marks: {}, dismissals: {} as Record<string, { fp: string; at: number }> }));
vi.mock("../src/renderer/src/lib/scopedSidebarView", () => ({
  useScopedSidebar: () => ({ model: {}, scope: { focus: "local" } }),
  useScopedAttention: () => fx,
}));
vi.mock("../src/renderer/src/lib/turnUnread", () => ({ turnMarksOn: () => ({}) }));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ useOutOfScopeAttention: () => 3 }));
vi.mock("../src/renderer/src/lib/needsYouDismiss", async (orig) => ({ ...(await orig<object>()), useDismissals: () => fx.dismissals, pruneStoredDismissals: () => {} }));

const { useNeedsYouView, needReason } = await import("../src/renderer/src/lib/needsYouView");
const { needsPage, NEEDS_PAGE_SIZE } = await import("../src/renderer/src/lib/needsYouPage");
const { placePanel } = await import("../src/renderer/src/lib/anchoredPanel");
const { needFingerprint } = await import("../src/renderer/src/lib/needsYouDismiss");

const row = (hostId: string, id: string) => ({ id, key: hostKey(hostId, id), hostId, name: `${hostId}/${id}`, session: { runtime: { status: "online" } } });
function view() {
  let out: ReturnType<typeof useNeedsYouView> | null = null;
  function Probe() {
    out = useNeedsYouView();
    return h("span");
  }
  renderToStaticMarkup(h(Probe));
  return out!;
}

beforeEach(() => {
  fx.rows = [];
  fx.signals = new Map();
  fx.needs = new Map();
  fx.dismissals = {};
});

describe("who is in the list", () => {
  it("needs-you and 出错 from every host in view, colliding ids kept apart; finished turns are not", () => {
    fx.rows = [row("local", "same"), row("remote", "same"), row("local", "done")];
    fx.signals = new Map([[hostKey("local", "same"), "error"], [hostKey("remote", "same"), "needsYou"], [hostKey("local", "done"), "done"]]);
    const v = view();
    expect(v.items.map((i) => i.key).sort()).toEqual([hostKey("local", "same"), hostKey("remote", "same")].sort());
    expect(v.items.find((i) => i.host === "remote")!.chip.signal).toBe("needsYou");
    expect(v.elsewhere).toBe(3);
  });
  it("a dismissed need stays out until it changes", () => {
    const key = hostKey("local", "a");
    fx.rows = [row("local", "a")];
    fx.signals = new Map([[key, "needsYou"]]);
    const need = { count: 1, reasons: ["approval"], askIds: [] };
    fx.needs = new Map([[key, need]]);
    fx.dismissals = { [key]: { fp: needFingerprint(need as never), at: 1 } };
    expect(view().items).toEqual([]);
    fx.needs = new Map([[key, { ...need, count: 2, reasons: ["approval", "question"] }]]);
    expect(view().items).toHaveLength(1);
  });
});

describe("the reason line", () => {
  const t = (k: string) => k;
  it("joins several reasons, says 出错 for an error and 等待确认 when nothing more is known", () => {
    expect(needReason(t as never, { chip: { signal: "needsYou" } as never, need: { count: 2, reasons: ["approval", "question"], askIds: [] } as never })).toBe("agentStatus.reason.approval · agentStatus.reason.question");
    expect(needReason(t as never, { chip: { signal: "needsYou" } as never, need: { count: 5, reasons: ["question"], askIds: [] } as never })).toBe("agentStatus.reason.question ×5");
    expect(needReason(t as never, { chip: { signal: "error" } as never, need: undefined })).toBe("agentStatus.error");
    expect(needReason(t as never, { chip: { signal: "needsYou" } as never, need: undefined })).toBe("agentStatus.reason.confirm");
  });
});

describe("pages", () => {
  it("a page holds NEEDS_PAGE_SIZE rows and is clamped when the list shrinks", () => {
    expect(NEEDS_PAGE_SIZE).toBe(6);
    expect(needsPage(Array.from({ length: 13 }, (_, i) => i), 1)).toEqual({ page: 1, pages: 3, rows: [6, 7, 8, 9, 10, 11] });
    expect(needsPage([1], 2)).toEqual({ page: 0, pages: 1, rows: [1] });
    expect(needsPage([], 0)).toEqual({ page: 0, pages: 1, rows: [] });
  });
});

describe("where the panel opens", () => {
  const view = { width: 1200, height: 800 };
  const box = { width: 320, height: 300 };
  it("above a bottom tray button, right edges meeting in the right half", () => {
    expect(placePanel({ left: 1100, right: 1132, top: 760, bottom: 792 }, box, "above", view)).toEqual({ left: 812, top: 454 });
  });
  it("below a top tray button, start edges meeting in the left half", () => {
    expect(placePanel({ left: 100, right: 132, top: 8, bottom: 40 }, box, "below", view)).toEqual({ left: 100, top: 46 });
  });
  it("beside a left or right tray, and always inside the window", () => {
    expect(placePanel({ left: 4, right: 36, top: 600, bottom: 632 }, box, "right", view)).toEqual({ left: 42, top: 332 });
    expect(placePanel({ left: 1160, right: 1192, top: 10, bottom: 42 }, box, "left", view)).toEqual({ left: 834, top: 16 });
    expect(placePanel({ left: 0, right: 32, top: 0, bottom: 32 }, { width: 2000, height: 2000 }, "above", view)).toEqual({ left: 16, top: 16 });
  });
});
