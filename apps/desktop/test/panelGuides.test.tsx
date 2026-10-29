// @vitest-environment jsdom
// Panel guides (lib/panelGuides, components/PanelGuideHost; design .claude/previews/panel-guides-design.md): opened only
// on request, scoped to the panel instance asked from, non-modal, Esc after menus / dialogs, focus back to the opener,
// a finished guide recorded for 帮助 without touching 全部跳过 / 重置.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = { hosts: { active: "h1" }, selectedHost: "h1", selectedId: null as string | null, byHost: {} };
const caps = { pause: true, hold: true, session: null as null | { cutexSessionId: string; runtime: string; unsupported?: string[] } };
const overlay = { dialog: false };
const binding = { sessionId: "s1" as string | null };

vi.mock("../src/renderer/src/i18n", () => ({
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.mod ? `${key}[${vars.mod}]` : key) }),
  translate: (key: string) => key,
}));
vi.mock("../src/renderer/src/store", () => {
  const useApp = Object.assign((sel: (s: typeof app) => unknown) => sel(app), { getState: () => app });
  return {
    useApp,
    featuresOf: () => new Set(caps.hold ? ["stop-holds-ridealongs"] : []),
    sidebarOf: () => ({ active: caps.session ? [caps.session] : [], retired: [] }),
  };
});
vi.mock("../src/renderer/src/lib/agentPause", () => ({ agentPauseSupported: () => caps.pause }));
vi.mock("../src/renderer/src/lib/agentFeatures", () => ({
  agentFeaturesOf: (s: { unsupported?: string[] }) => new Set(s.unsupported ?? []),
  lacks: (f: Set<string>, name: string) => f.has(name),
}));
vi.mock("../src/renderer/src/lib/agentList", () => ({ runtimeOf: (s: { runtime: string }) => s.runtime }));
vi.mock("../src/renderer/src/lib/openModifiers", () => ({ newInstanceKey: () => "Ctrl+" }));
vi.mock("../src/renderer/src/lib/sideDnd", () => ({ sideDragging: () => false }));
vi.mock("../src/renderer/src/lib/onboarding", () => ({ openOnboarding: vi.fn(), finishOnboarding: vi.fn() }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ useOverlayState: () => overlay }));
vi.mock("../src/renderer/src/lib/openOverlays", () => ({ anyOverlayOpen: () => false }));
vi.mock("../src/renderer/src/lib/paneStore", () => ({ usePanes: { getState: () => ({ layout: {} }) } }));
vi.mock("../src/renderer/src/lib/paneLayout", () => ({ paneBinding: () => (binding.sessionId ? { sessionId: binding.sessionId } : null) }));

import { PanelGuideHost, placeCard } from "../src/renderer/src/components/PanelGuideHost";
import { getGuides, liveGuides, reloadGuideState, resetGuides, skipAllGuides } from "../src/renderer/src/lib/guides";
import {
  closePanelGuide,
  finishPanelGuide,
  guideContext,
  openPanelGuide,
  PANEL_GUIDES,
  PANEL_IDS,
  panelGuideDone,
  panelGuideNow,
  panelScope,
  panelSeenId,
  setPanelGuideStep,
  stepText,
} from "../src/renderer/src/lib/panelGuides";
import { panelGuidesZhCN } from "../src/renderer/src/modules/onboarding/panelGuideMessages";
import { panelGuidesEn } from "../src/renderer/src/modules/onboarding/panelGuideMessages.en";
import * as locales from "../src/renderer/src/modules/onboarding/panelGuideMessages.locales";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lays nothing out: elements marked data-box are "on screen" (data-box "x,y[,w,h]"; 100×20 by default).
const realRects = Element.prototype.getClientRects;
const realBox = Element.prototype.getBoundingClientRect;
function boxOf(el: Element): DOMRect | null {
  const at = el.getAttribute("data-box");
  if (at == null) return null;
  const [x = 0, y = 0, w = 100, hh = 20] = at.split(",").map((v) => Number(v) || 0);
  return { left: x, top: y, right: x + w, bottom: y + hh, width: w, height: hh, x, y, toJSON() {} } as DOMRect;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  reloadGuideState();
  Object.assign(caps, { pause: true, hold: true, session: null });
  overlay.dialog = false;
  binding.sessionId = "s1";
  Element.prototype.getClientRects = function () {
    return (boxOf(this) ? [boxOf(this)] : []) as unknown as DOMRectList;
  };
  Element.prototype.getBoundingClientRect = function () {
    return boxOf(this) ?? realBox.call(this);
  };
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => setTimeout(() => f(0), 0) as unknown as number);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => closePanelGuide());
  act(() => root.unmount());
  document.body.innerHTML = "";
  Element.prototype.getClientRects = realRects;
  Element.prototype.getBoundingClientRect = realBox;
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  vi.unstubAllGlobals();
});

/** Two conversation panes (p1 / p2), each with a header, queue header and composer mode button. */
function twoPanes(): void {
  const pane = (id: string, y: number) => `
    <div data-conv-pane="${id}" data-box="0,${y}">
      <div data-conv-header="${id}" data-box="0,${y}"><button data-opener="${id}" data-box="0,${y}">⋯</button></div>
      <div data-testid="queue-header" data-box="10,${y + 20}">q-${id}</div>
      <div data-composer-block data-box="0,${y + 40}"><button data-box="20,${y + 40}"><span data-guide-target="composer-mode" data-box="20,${y + 40}">mode-${id}</span></button></div>
    </div>`;
  const wrap = document.createElement("div");
  wrap.innerHTML = pane("p1", 0) + pane("p2", 300);
  document.body.append(wrap);
}

describe("the catalogs", () => {
  const keys = (): string[] =>
    PANEL_IDS.flatMap((p) => {
      const d = PANEL_GUIDES[p];
      const all = [d.title, d.text];
      for (const s of d.steps) {
        all.push(s.title, s.body, ...[s.note, s.detail, s.detailLabel, s.tryIt].filter((x): x is NonNullable<typeof x> => !!x));
        for (const c of [
          { steer: false, stopHold: false, agentPause: false, runtime: "claude" as const, mod: "Ctrl" },
          { steer: true, stopHold: true, agentPause: true, runtime: "codex" as const, mod: "Ctrl" },
        ]) {
          const v = stepText(s, c);
          all.push(v.title, v.body, ...[v.note, v.detail].filter((x): x is NonNullable<typeof x> => !!x));
        }
      }
      return all;
    });

  it("every key a guide uses is in zh-CN, en and each locale", () => {
    const tables: Record<string, Record<string, string>> = { zh: panelGuidesZhCN, en: panelGuidesEn, ...(locales as unknown as Record<string, Record<string, string>>) };
    for (const [name, table] of Object.entries(tables)) {
      const gone = [...new Set(keys())].filter((k) => !table[k]);
      expect(gone, name).toEqual([]);
    }
  });

  it("the zh text says agent / Shelf only through the terms, and no locale has an unfilled label slot", () => {
    for (const v of Object.values(panelGuidesZhCN)) expect(v).not.toMatch(/智能体|Shelf/);
    for (const table of Object.values(locales as unknown as Record<string, Record<string, string>>)) for (const v of Object.values(table)) expect(v).not.toMatch(/⟦|⟧/);
  });
});

describe("state", () => {
  it("opens at the asked step (clamped), one at a time, and records a finished guide for 帮助 only", () => {
    openPanelGuide({ panel: "conversation", step: 1 });
    expect(panelGuideNow()?.step).toBe(1);
    openPanelGuide({ panel: "tray", step: 99 });
    expect(panelGuideNow()?.request.panel).toBe("tray");
    expect(panelGuideNow()?.step).toBe(PANEL_GUIDES.tray.steps.length - 1);
    closePanelGuide();
    expect(panelGuideDone("tray")).toBe(false); // closed early: nothing recorded
    openPanelGuide({ panel: "tray" });
    setPanelGuideStep(-3);
    expect(panelGuideNow()?.step).toBe(0);
    finishPanelGuide();
    expect(panelGuideNow()).toBeNull();
    expect(getGuides().seen).toContain(panelSeenId("tray"));
    expect(panelGuideDone("tray")).toBe(true);
    expect(getGuides().asked).toBe(false);
  });

  it("全部跳过 does not mark panel guides; 重置所有提示 keeps their 已看过", () => {
    skipAllGuides("0.2.0");
    expect(getGuides().seen.some((id) => id.startsWith("panel."))).toBe(false);
    expect(liveGuides("0.2.0").filter((g) => g.kind === "panel").map((g) => g.id).sort()).toEqual(["panel.conversation", "panel.shelf", "panel.sidebar", "panel.tray"]);
    openPanelGuide({ panel: "shelf" });
    finishPanelGuide();
    resetGuides();
    expect(panelGuideDone("shelf")).toBe(true);
  });

  it("reads the agent's capabilities: no steer, no stop hold, no pause, Claude", () => {
    caps.session = { cutexSessionId: "s1", runtime: "claude", unsupported: ["turnSteer"] };
    Object.assign(caps, { pause: false, hold: false });
    const ctx = guideContext({ panel: "conversation", hostId: "h1", sessionId: "s1" });
    expect(ctx).toEqual({ steer: false, stopHold: false, agentPause: false, runtime: "claude", mod: "Ctrl" });
    const steer = PANEL_GUIDES.conversation.steps.find((s) => s.id === "steer")!;
    expect(stepText(steer, ctx).body).toBe("onboarding.panel.conversation.steer.bodyNoSteer");
    const rules = PANEL_GUIDES.conversation.steps.find((s) => s.id === "rules")!;
    expect(stepText(rules, ctx).detail).toBe("onboarding.panel.conversation.rules.detailClaude");
  });
});

describe("placement", () => {
  const view = { width: 1200, height: 800 };
  const card = { width: 340, height: 200 };
  it("beside the target where there is room, else the bottom sheet", () => {
    expect(placeCard({ left: 100, top: 50, width: 200, height: 40 }, card, view)).toEqual({ left: 310, top: 50 });
    expect(placeCard({ left: 800, top: 50, width: 390, height: 40 }, card, view)).toEqual({ left: 450, top: 50 });
    expect(placeCard({ left: 0, top: 50, width: 1200, height: 40 }, card, view)).toEqual({ left: 8, top: 100 });
    expect(placeCard({ left: 0, top: 0, width: 1200, height: 800 }, card, view)).toBeNull();
    expect(placeCard({ left: 100, top: 50, width: 200, height: 40 }, card, { width: 600, height: 800 })).toBeNull();
  });
});

describe("the card", () => {
  const render = () => act(() => root.render(h(PanelGuideHost)));
  const card = () => document.querySelector<HTMLElement>("[data-panel-guide]");

  it("is a non-modal dialog on the pane it was asked from, its title focused, Esc closes and the focus goes back", async () => {
    twoPanes();
    render();
    const opener = document.querySelector<HTMLButtonElement>('[data-opener="p2"]')!;
    act(() => openPanelGuide({ panel: "conversation", paneId: "p2", hostId: "h1", sessionId: "s1", opener, step: 5 }));
    const c = card()!;
    expect(c.getAttribute("role")).toBe("dialog");
    expect(c.hasAttribute("aria-modal")).toBe(false);
    expect(c.getAttribute("data-panel-guide-step")).toBe("mode");
    expect(document.activeElement?.tagName).toBe("H2");
    expect(panelScope({ panel: "conversation", paneId: "p2" })?.getAttribute("data-conv-pane")).toBe("p2");
    // The frame outlines p2's mode button (y 340), not p1's.
    const frame = document.querySelector<HTMLElement>("[data-panel-guide-frame]")!;
    expect(frame.style.top).toBe("337px");
    expect(c.querySelector("[data-panel-guide-missing]")).toBeNull();
    // A menu on top has Esc first.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(card()).not.toBeNull();
    menu.remove();
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("says when a step's control is not on screen, and never on its own opens anything", () => {
    twoPanes();
    render();
    act(() => openPanelGuide({ panel: "conversation", paneId: "p1", step: 6 })); // rules: no rules chip here
    expect(card()!.querySelector("[data-panel-guide-missing]")).not.toBeNull();
    expect(document.querySelector("[data-panel-guide-frame]")).toBeNull();
  });

  it("steps through with 下一步 / 上一步 and records 知道了 on the last step", () => {
    const tray = document.createElement("div");
    tray.setAttribute("data-tray-frame", "");
    tray.setAttribute("data-box", "0,700");
    document.body.append(tray);
    render();
    act(() => openPanelGuide({ panel: "tray" }));
    expect(card()!.querySelector("[data-panel-guide-back]")).toBeNull();
    act(() => card()!.querySelector<HTMLButtonElement>("[data-panel-guide-next]")!.click());
    expect(card()!.getAttribute("data-panel-guide-step")).toBe("minimize");
    act(() => card()!.querySelector<HTMLButtonElement>("[data-panel-guide-back]")!.click());
    expect(card()!.getAttribute("data-panel-guide-step")).toBe("back");
    act(() => setPanelGuideStep(PANEL_GUIDES.tray.steps.length - 1));
    expect(card()!.querySelector("[data-panel-guide-next]")!.textContent).toBe("onboarding.panel.done");
    act(() => card()!.querySelector<HTMLButtonElement>("[data-panel-guide-next]")!.click());
    expect(card()).toBeNull();
    expect(panelGuideDone("tray")).toBe(true);
  });

  it("closes when its pane shows another agent or the panel is gone; hides behind a confirm dialog", async () => {
    twoPanes();
    render();
    act(() => openPanelGuide({ panel: "conversation", paneId: "p1", sessionId: "s1" }));
    overlay.dialog = true;
    render();
    expect(card()).toBeNull();
    expect(panelGuideNow()).not.toBeNull();
    overlay.dialog = false;
    render();
    expect(card()).not.toBeNull();
    binding.sessionId = "s2";
    await act(async () => void (await new Promise((r) => setTimeout(r, 450))));
    expect(panelGuideNow()).toBeNull();
    binding.sessionId = "s1";
    act(() => openPanelGuide({ panel: "conversation", paneId: "p2", sessionId: "s1" }));
    document.querySelector('[data-conv-pane="p2"]')!.remove();
    await act(async () => void (await new Promise((r) => setTimeout(r, 450))));
    expect(panelGuideNow()).toBeNull();
  });

  it("「试一试」 shrinks the card and hands the focus to the control", async () => {
    twoPanes();
    render();
    act(() => openPanelGuide({ panel: "conversation", paneId: "p1" }));
    act(() => card()!.querySelector<HTMLButtonElement>("[data-panel-guide-try]")!.click());
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    expect(card()!.hasAttribute("data-panel-guide-trying")).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[data-opener="p1"]'));
    act(() => card()!.querySelector<HTMLButtonElement>("[data-panel-guide-resume]")!.click());
    expect(card()!.hasAttribute("data-panel-guide-trying")).toBe(false);
  });
});

// Owner 2026-10-27: the sidebar guide's 「放在旁边一起看」 frame sat over the blank strip under the toolbar, above the search
// box — the first agent row, scrolled out of the sidebar's list, still has a box inside the window.
describe("the frame is on what can be seen", () => {
  const render = () => act(() => root.render(h(PanelGuideHost)));
  const card = () => document.querySelector<HTMLElement>("[data-panel-guide]");
  const frame = () => document.querySelector<HTMLElement>("[data-panel-guide-frame]");
  const missing = () => !!document.querySelector("[data-panel-guide-missing]");
  /** The sidebar (y 40–840) with its list scrolled: a clipping list from y 100 to 400 holding `rows` ("y" or "y,h"). */
  function sidebar(...rows: string[]): HTMLElement[] {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <aside data-sidebar-mode="open" data-box="0,40,260,800">
        <input data-sidebar-search data-box="10,50,240,30" />
        <div data-list style="overflow-y: auto" data-box="0,100,260,300">
          ${rows.map((r, i) => `<div data-row-selectable data-row="${i}" data-box="20,${r.split(",")[0]},220,${r.split(",")[1] ?? 40}"><button data-open-beside data-box="200,${r.split(",")[0]},14,14"></button></div>`).join("")}
        </div>
      </aside>`;
    document.body.append(wrap);
    return [...wrap.querySelectorAll<HTMLElement>("[data-row-selectable]")];
  }

  it("skips a row scrolled out of the list (above it, under the toolbar) for the first row in view", () => {
    sidebar("50", "130", "180");
    render();
    act(() => openPanelGuide({ panel: "sidebar", step: 1 })); // 放在旁边一起看
    expect(card()!.getAttribute("data-panel-guide-step")).toBe("beside");
    expect(frame()!.style.top).toBe("127px"); // row 1 (y 130), not row 0 (y 50: above the list's top at 100)
    expect(frame()!.style.height).toBe("46px");
    expect(missing()).toBe(false);
  });

  it("outlines the row, not its hover-only 「在旁边打开」 button", () => {
    sidebar("130");
    render();
    act(() => openPanelGuide({ panel: "sidebar", step: 1 }));
    expect(frame()!.style.left).toBe("17px");
    expect(frame()!.style.width).toBe("226px");
  });

  it("a row only partly in view: the frame covers its visible part, inside the list", () => {
    sidebar("380,60"); // y 380–440, the list ends at 400
    render();
    act(() => openPanelGuide({ panel: "sidebar", step: 2 }));
    expect(frame()!.style.top).toBe("377px");
    expect(frame()!.style.height).toBe("26px"); // 380–400, ±3
  });

  it("no row in view: scrolls the first one in once, and says it is not on screen while it is out", async () => {
    const [row] = sidebar("20");
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render();
    act(() => openPanelGuide({ panel: "sidebar", step: 1 }));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0]).toBe(row);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    // jsdom does not move it: still out, no frame anywhere (not over the toolbar), the card says so, no second scroll.
    expect(frame()).toBeNull();
    expect(missing()).toBe(true);
    await act(async () => void (await new Promise((r) => setTimeout(r, 450))));
    expect(scroll).toHaveBeenCalledTimes(1);
    // The next step may scroll again.
    act(() => setPanelGuideStep(2));
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("a control under something else (the Shelf over the conversation in a narrow window) is not framed", () => {
    twoPanes();
    const drawer = document.createElement("div");
    drawer.setAttribute("data-drawer", "");
    document.body.append(drawer);
    const under = vi.fn((x: number, y: number) => (y >= 300 ? [drawer, document.body] : []));
    (document as { elementsFromPoint?: unknown }).elementsFromPoint = under;
    render();
    act(() => openPanelGuide({ panel: "conversation", paneId: "p2", step: 5 })); // mode, y 340: covered
    expect(frame()).toBeNull();
    expect(missing()).toBe(true);
    act(() => openPanelGuide({ panel: "conversation", paneId: "p1", step: 5 })); // y 40: not covered
    expect(frame()!.style.top).toBe("37px");
    expect(missing()).toBe(false);
  });

  it("a row half under the Shelf drawer: the frame covers the part that shows", () => {
    sidebar("130"); // x 20–240: grid cells 44 px wide, middles at 42 / 86 / 130 / 174 / 218
    const drawer = document.createElement("div");
    document.body.append(drawer);
    (document as { elementsFromPoint?: unknown }).elementsFromPoint = (x: number) => (x >= 150 ? [drawer] : []);
    render();
    act(() => openPanelGuide({ panel: "sidebar", step: 1 }));
    expect(frame()!.style.left).toBe("17px");
    expect(frame()!.style.width).toBe("138px"); // 20–152 (three cells), ±3
    expect(missing()).toBe(false);
  });

  it("a layer the pointer goes through (the queue's insert slot) is not hidden by what it lies on", () => {
    twoPanes();
    const header = document.querySelector('[data-conv-pane="p1"] [data-testid=queue-header]')!;
    header.insertAdjacentHTML("beforeend", '<button data-own data-box="80,20,20,20"></button><span data-insert-slot style="pointer-events: none" data-box="10,20,200,20"></span>');
    const own = header.querySelector("[data-own]")!;
    (document as { elementsFromPoint?: unknown }).elementsFromPoint = () => [own, header];
    render();
    act(() => openPanelGuide({ panel: "conversation", paneId: "p1", step: 3 })); // order
    expect(frame()!.style.width).toBe("206px");
    expect(missing()).toBe(false);
  });

  it("a dimming scrim (empty, aria-hidden) does not hide what is under it", () => {
    twoPanes();
    const scrim = document.createElement("div");
    scrim.setAttribute("data-drawer-scrim", "");
    scrim.setAttribute("aria-hidden", "true");
    document.body.append(scrim);
    const mode = document.querySelector('[data-conv-pane="p2"] [data-guide-target]')!;
    (document as { elementsFromPoint?: unknown }).elementsFromPoint = () => [scrim, mode];
    render();
    act(() => openPanelGuide({ panel: "conversation", paneId: "p2", step: 5 }));
    expect(frame()!.style.top).toBe("337px");
    expect(missing()).toBe(false);
  });

  it("a covered match gives way to the next one in view; the guide's own card does not count", () => {
    const rows = sidebar("130", "200");
    render();
    act(() => openPanelGuide({ panel: "sidebar", step: 1 }));
    const card0 = card()!;
    (document as { elementsFromPoint?: unknown }).elementsFromPoint = (_x: number, y: number) =>
      y < 180 ? [document.createElement("div"), rows[0]] : [card0, rows[1]];
    act(() => setPanelGuideStep(2));
    expect(frame()!.style.top).toBe("197px"); // row 1: its middle is under the card only
  });
});
