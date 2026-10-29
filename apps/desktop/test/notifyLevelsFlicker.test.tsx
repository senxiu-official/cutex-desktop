// @vitest-environment jsdom
// Settings → 通知 → 事件分级 (owner 2026-10-25): changing one option flashed the whole page. Each write set one
// page-wide `busy`, which disabled and dimmed every row (and every ↺, so the section's 「只看你修改过的设置」 switch
// dropped out) until the host answered. Now a change touches only its own control: the new value shows at once,
// nothing else is disabled, the page's nodes stay, unchanged rows are not re-rendered, writes go out in order.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationLevelsPatch, NotificationLevelsView } from "../src/shared/notificationLevels";

const { I18nProvider } = await import("../src/renderer/src/i18n");
const { EventsSection, MatrixSection } = await import("../src/renderer/src/modules/notifications/NotificationsPage");
const { mock } = await import("../src/renderer/src/modules/notifications/mock");
type TargetLevels = import("../src/renderer/src/modules/notifications/targetLevels").TargetLevels;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = mock.api!({ legacy: false } as never) as { notificationLevels(): Promise<NotificationLevelsView>; patchNotificationLevels(p: NotificationLevelsPatch): Promise<NotificationLevelsView> };

/** A host whose PATCH answers when the test says so (`answer()`), like a real round trip. */
function slowHost(view: NotificationLevelsView) {
  const calls: NotificationLevelsPatch[] = [];
  const waiting: { patch: NotificationLevelsPatch; ok: (v: NotificationLevelsView) => void; fail: (e: Error) => void }[] = [];
  let current = view;
  let rerender = () => {};
  const levels = (): TargetLevels => ({
    view: current,
    error: null,
    patch: (patch) =>
      new Promise<NotificationLevelsView>((ok, fail) => {
        calls.push(patch);
        waiting.push({ patch, ok, fail });
      }),
  });
  return {
    calls,
    levels,
    bind: (f: () => void) => (rerender = f),
    async answer() {
      const w = waiting.shift()!;
      current = await api.patchNotificationLevels(w.patch);
      rerender();
      w.ok(current);
    },
    fail() {
      waiting.shift()!.fail(new Error("PATCH failed"));
    },
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const groups = () => [...host.querySelectorAll<HTMLElement>('[role="radiogroup"]')];

async function mount(section: typeof EventsSection) {
  const view = await api.notificationLevels();
  const fake = slowHost(view);
  const draw = () => root.render(h(I18nProvider, null, h(section, { levels: fake.levels() })));
  fake.bind(() => act(draw));
  act(draw);
  await flush();
  return fake;
}

describe("事件分级: a change touches only its own control", () => {
  it("shows the new level at once; no other row is disabled or dimmed; the page's nodes stay; only that row changes", async () => {
    const fake = await mount(EventsSection);
    const before = groups();
    expect(before.length).toBeGreaterThan(5);
    const section = host.querySelector("section")!;
    const target = before[2]!;
    const pick = [...target.querySelectorAll<HTMLElement>('[role="radio"]')].find((b) => b.getAttribute("aria-checked") !== "true")!;
    const touched: Node[] = [];
    const mo = new MutationObserver((ms) => ms.forEach((m) => touched.push(m.target)));
    mo.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });

    act(() => pick.click());
    await flush();
    // In flight: the clicked choice is shown, nothing waits on the host.
    expect(pick.getAttribute("aria-checked")).toBe("true");
    expect(fake.calls).toHaveLength(1);
    for (const g of groups()) {
      expect(g.getAttribute("aria-disabled")).toBeNull();
      expect(g.className).not.toMatch(/opacity-50/);
    }
    const mutatedGroups = new Set(touched.map((n) => (n instanceof Element ? n : n.parentElement)?.closest('[role="radiogroup"]')).filter(Boolean));
    expect([...mutatedGroups]).toEqual([target]);

    touched.length = 0;
    await act(() => fake.answer());
    await flush();
    mo.disconnect();
    // Answered: same nodes everywhere, the value stays, and only the touched row's own nodes changed (its ↺).
    expect(host.querySelector("section")).toBe(section);
    expect(groups()).toEqual(before);
    expect(pick.getAttribute("aria-checked")).toBe("true");
    const others = before.filter((g) => g !== target);
    for (const n of touched) {
      const el = n instanceof Element ? n : n.parentElement!;
      expect(others.some((g) => g.contains(el))).toBe(false);
    }
  });

  it("the ↺ of the other rows stays enabled while a write is on its way (the 「只看你修改过的设置」 count holds)", async () => {
    await mount(EventsSection);
    const resetsBefore = host.querySelectorAll("button:not(:disabled)").length;
    const g = groups()[3]!;
    act(() => [...g.querySelectorAll<HTMLElement>('[role="radio"]')].find((b) => b.getAttribute("aria-checked") !== "true")!.click());
    await flush();
    expect(host.querySelectorAll("button:not(:disabled)").length).toBe(resetsBefore);
  });

  it("two quick changes go out one after another, in order; a failed write puts the old value back", async () => {
    const fake = await mount(EventsSection);
    const [a, b] = [groups()[1]!, groups()[4]!];
    const off = (g: HTMLElement) => [...g.querySelectorAll<HTMLElement>('[role="radio"]')].find((x) => x.getAttribute("aria-checked") !== "true")!;
    const was = (g: HTMLElement) => g.querySelector('[aria-checked="true"]')!;
    const bOld = was(b);
    const [pa, pb] = [off(a), off(b)];
    act(() => pa.click());
    act(() => pb.click());
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(pa.getAttribute("aria-checked")).toBe("true");
    expect(pb.getAttribute("aria-checked")).toBe("true");
    await act(() => fake.answer());
    await flush();
    expect(fake.calls).toHaveLength(2);
    act(() => fake.fail());
    await flush();
    expect(pa.getAttribute("aria-checked")).toBe("true");
    expect(bOld.getAttribute("aria-checked")).toBe("true");
    expect(pb.getAttribute("aria-checked")).toBe("false");
  });
});

describe("等级 → 通知方式: a cell click touches only that cell", () => {
  it("the cell turns at once; no other cell or the preset is disabled meanwhile", async () => {
    const fake = await mount(MatrixSection);
    const cells = [...host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]:not([aria-disabled])')];
    const cell = cells[0]!;
    const was = cell.getAttribute("aria-checked");
    act(() => cell.click());
    await flush();
    expect(cell.getAttribute("aria-checked")).toBe(String(was !== "true"));
    expect(host.querySelectorAll('[role="checkbox"]:disabled')).toHaveLength(0);
    expect(host.querySelector('[role="radiogroup"]')!.getAttribute("aria-disabled")).toBeNull();
    await act(() => fake.answer());
    await flush();
    expect(cell.getAttribute("aria-checked")).toBe(String(was !== "true"));
    expect(host.querySelectorAll('[role="checkbox"]:not([aria-disabled])')[0]).toBe(cell);
  });
});
