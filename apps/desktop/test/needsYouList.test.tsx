// @vitest-environment jsdom
// 需要你 (owner 2026-11-05): the tray's 通知中心 (always there, dim at 0), the status-row bell (only while something
// waits, no avatars) and the one list both open: paged, 「就在这里」 on agents on screen, a row opens the agent where its
// need is handled, × hides it, Esc closes back to the button, and the panel opens away from the tray's edge.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Item = { chip: { id: string; key: string; hostId: string; name: string; signal: string }; host: string; key: string; row: undefined; need: { count: number; reasons: string[]; askIds: string[] } | undefined };
const fx = vi.hoisted(() => ({ items: [] as Item[], here: "", elsewhere: 0, strip: true, activate: vi.fn(), dismiss: vi.fn(), scope: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, v?: Record<string, unknown>) => `${key}${v ? JSON.stringify(v) : ""}` }) }));
vi.mock("../src/renderer/src/lib/needsYouView", async (orig) => ({ ...(await orig<object>()), useNeedsYouView: () => ({ items: fx.items, elsewhere: fx.elsewhere, scope: { showHostMarks: false, host: () => null } }) }));
vi.mock("../src/renderer/src/lib/attentionActivate", () => ({ activateAttention: fx.activate }));
vi.mock("../src/renderer/src/lib/needsYouDismiss", async (orig) => ({ ...(await orig<object>()), dismissNeed: fx.dismiss }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ setViewScope: fx.scope }));
vi.mock("../src/renderer/src/lib/workspaces", () => ({ isOnScreen: ({ key }: { key: string }) => key === fx.here }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ needsYouStrip: fx.strip }) }));
vi.mock("../src/renderer/src/lib/paneStore", () => ({ usePanes: () => null }));
vi.mock("../src/renderer/src/lib/sideLayoutStore", () => ({ useSide: () => null }));
vi.mock("../src/renderer/src/lib/turnUnread", () => ({ markSeenOn: () => {} }));
vi.mock("../src/renderer/src/components/AgentStatus", () => ({ StatusAvatar: () => h("i", { "data-avatar": "" }) }));

const { TrayNeedsYou, NeedsYouBell } = await import("../src/renderer/src/components/NeedsYou");

const item = (i: number, signal = "needsYou"): Item => ({
  chip: { id: `a${i}`, key: `h${i}:a${i}`, hostId: `h${i}`, name: `Name ${i}`, signal },
  host: `h${i}`,
  key: `h${i}:a${i}`,
  row: undefined,
  need: signal === "needsYou" ? { count: 1, reasons: ["approval"], askIds: [] } : undefined,
});

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.assign(fx, { items: [], here: "", elsewhere: 0, strip: true });
  fx.activate.mockClear();
  fx.dismiss.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (node: ReturnType<typeof h>) => act(() => root.render(node));
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const list = () => document.querySelector<HTMLElement>("[data-needs-list]");
const tray = () => host.querySelector<HTMLElement>("[data-tray-needs]")!;

describe("the tray's 通知中心", () => {
  it("is always there: dim with no number at 0, and its list says nothing waits", () => {
    render(h(TrayNeedsYou, { onUsed: () => {} }));
    expect(tray().hasAttribute("data-empty")).toBe(true);
    expect(tray().querySelector("[data-count-badge]")).toBeNull();
    click(tray());
    expect(list()!.textContent).toContain("tray.needsEmpty");
    expect(list()!.querySelector("[data-need-row]")).toBeNull();
  });
  it("counts everyone, the agent on screen too (marked 就在这里), so switching agents does not change the number", () => {
    fx.items = [item(0), item(1, "error")];
    fx.here = "a0";
    render(h(TrayNeedsYou, { onUsed: () => {} }));
    expect(tray().hasAttribute("data-empty")).toBe(false);
    expect(tray().querySelector("[data-count-badge]")!.textContent).toBe("2");
    click(tray());
    const rows = [...list()!.querySelectorAll("[data-need]")];
    expect(rows.map((r) => r.textContent)).toEqual(["Name 0tray.needsHereagentStatus.reason.approval", "Name 1agentStatus.error"]);
    fx.here = "a1";
    render(h(TrayNeedsYou, { onUsed: () => {} }));
    expect(tray().querySelector("[data-count-badge]")!.textContent).toBe("2");
  });
  it("pages past six rows; the pager only shows when there is more than one page", () => {
    fx.items = Array.from({ length: 13 }, (_, i) => item(i));
    render(h(TrayNeedsYou, { onUsed: () => {} }));
    click(tray());
    expect(list()!.querySelectorAll("[data-need-row]")).toHaveLength(6);
    expect(list()!.textContent).toContain('tray.needsPage{"page":1,"pages":3}');
    click(list()!.querySelector('[aria-label="tray.needsNext"]'));
    expect(list()!.textContent).toContain("Name 6");
    expect(list()!.textContent).not.toContain("Name 0");
    fx.items = [item(0)];
    render(h(TrayNeedsYou, { onUsed: () => {} }));
    expect(list()!.querySelector('[aria-label="tray.needsNext"]')).toBeNull();
    expect(list()!.textContent).toContain("Name 0");
  });
  it("a row opens the agent where its need is handled, on its own host, and closes the list", () => {
    fx.items = [item(0), item(1)];
    const used = vi.fn();
    render(h(TrayNeedsYou, { onUsed: used }));
    click(tray());
    click(list()!.querySelectorAll("[data-need-row]")[1]);
    expect(fx.activate).toHaveBeenCalledWith(fx.items[1]!.chip, fx.items[1]!.need, "h1");
    expect(used).toHaveBeenCalled();
    expect(list()).toBeNull();
  });
  it("× hides a need without opening it", () => {
    fx.items = [item(0)];
    render(h(TrayNeedsYou, { onUsed: () => {} }));
    click(tray());
    click(list()!.querySelector('[aria-label="needsYou.dismiss"]'));
    expect(fx.dismiss).toHaveBeenCalledWith("h0:a0", fx.items[0]!.need);
    expect(fx.activate).not.toHaveBeenCalled();
  });
  it("other hosts' waiting items are one line that shows all devices", () => {
    fx.elsewhere = 4;
    render(h(TrayNeedsYou, { onUsed: () => {} }));
    click(tray());
    const other = [...list()!.querySelectorAll("button")].find((b) => b.textContent?.startsWith("needsYou.otherHosts"));
    click(other);
    expect(fx.scope).toHaveBeenCalled();
  });
  it("Esc closes back to the button; an outside click closes it", () => {
    render(h(TrayNeedsYou, { onUsed: () => {} }));
    click(tray());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(tray());
    click(tray());
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(list()).toBeNull();
  });
  it("opens away from the tray's edge", () => {
    for (const [at, side] of [["bottom", "above"], ["top", "below"], ["left", "right"], ["right", "left"]] as const) {
      render(h("div", { "data-tray-at": at }, h(TrayNeedsYou, { key: at, onUsed: () => {} })));
      click(tray());
      expect(list()!.getAttribute("data-side")).toBe(side);
      click(tray());
    }
  });
});

describe("the status-row bell", () => {
  it("is not there while nothing waits, or when switched off in Settings", () => {
    render(h(NeedsYouBell));
    expect(host.querySelector("[data-needs-you-bell]")).toBeNull();
    fx.items = [item(0)];
    fx.strip = false;
    render(h(NeedsYouBell));
    expect(host.querySelector("[data-needs-you-bell]")).toBeNull();
  });
  it("is a bell and a number, no avatars or role words, and opens the same list above it", () => {
    fx.items = [item(0), item(1)];
    render(h(NeedsYouBell));
    const bell = host.querySelector<HTMLElement>("[data-needs-you-bell]")!;
    expect(bell.textContent).toBe("2");
    expect(bell.querySelector("[data-avatar]")).toBeNull();
    click(bell);
    expect(list()!.getAttribute("data-side")).toBe("above");
    expect(list()!.querySelectorAll("[data-need-row]")).toHaveLength(2);
  });
});
