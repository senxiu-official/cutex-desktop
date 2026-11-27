// @vitest-environment jsdom
// Owner 2026-11-28 (delegation a04979 v2): the 状态显示 page is gone. Which items show in the status row is a group of
// checkboxes on 会话 → 输入 (all on by default); the capsule's items and geometry are its module page (模块 → 状态胶囊);
// 允许 3 个工作区 moved from 托盘 to 会话 → 布局. Saved choices keep their meaning: 胶囊 / 两者 show in the row while the
// capsule is off, 不显示 stays off.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusPlace, StatusSurfaceId } from "../src/renderer/src/modules/slots";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  capsule: "disabled" as "on" | "disabled" | "failed",
  places: {} as Record<string, StatusPlace>,
  set: vi.fn(),
}));

const ITEMS: { id: string; titleKey: string; supported: StatusSurfaceId[] }[] = [
  { id: "goal", titleKey: "goal.title", supported: ["bar"] },
  { id: "plan", titleKey: "plan.title", supported: ["bar", "capsule"] },
  { id: "alarms", titleKey: "alarms.title", supported: ["bar", "capsule"] },
  { id: "jobs", titleKey: "jobs.title", supported: ["bar", "capsule"] },
];

vi.mock("../src/renderer/src/lib/statusItemsView", async () => {
  const { resolvePlacement } = await import("../src/renderer/src/lib/statusSurfaces");
  const providers = () => ({
    bar: { surface: "bar", available: true, moduleId: "shell", item: { id: "bar", surface: "bar", intents: ["view"] } },
    capsule: m.capsule === "on"
      ? { surface: "capsule", available: true, moduleId: "status-capsule", item: { id: "capsule", surface: "capsule", intents: ["view"] } }
      : { surface: "capsule", available: false, moduleId: "status-capsule", reason: m.capsule },
  });
  return {
    useSurfaceProviders: providers,
    useStatusItems: () =>
      ITEMS.map((i) => {
        const place = m.places[i.id] ?? "both";
        return { item: { id: i.id, titleKey: i.titleKey }, moduleId: i.id, place, supported: i.supported, resolved: resolvePlacement(place, i.supported, providers() as never) };
      }),
    setStatusPlace: (item: { id: string }, place: StatusPlace) => m.set(item.id, place),
  };
});

import { I18nProvider } from "../src/renderer/src/i18n";
import { StatusRowChecks } from "../src/renderer/src/components/settings/StatusItemChecks";
import { ThreeWorkspacesRow } from "../src/renderer/src/components/TraySettings";
import { rowPlace } from "../src/renderer/src/lib/statusItems";
import { movedSettingsRoute, settingsTab, STATUS_ROW_ANCHOR, WORKSPACES_ANCHOR } from "../src/renderer/src/lib/settingsNav";
import { useTrayPrefs } from "../src/renderer/src/lib/trayPrefs";

const src = (p: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/renderer/src", p), "utf8");

describe("rowPlace: ticking an item in the status row keeps the capsule side", () => {
  it("capsule on: the row and the capsule are separate choices", () => {
    expect(rowPlace("off", true, false)).toBe("bar");
    expect(rowPlace("capsule", true, false)).toBe("both");
    expect(rowPlace("both", false, false)).toBe("capsule");
    expect(rowPlace("bar", false, false)).toBe("off");
  });
  it("capsule off: 胶囊 / 两者 already show in the row; unticking turns the item off", () => {
    expect(rowPlace("capsule", true, true)).toBe("capsule");
    expect(rowPlace("both", true, true)).toBe("both");
    expect(rowPlace("off", true, true)).toBe("bar");
    expect(rowPlace("both", false, true)).toBe("off");
    expect(rowPlace("capsule", false, true)).toBe("off");
  });
});

describe("old links to 状态显示", () => {
  it("land on 会话 → 输入 → 输入框上方", () => {
    expect(settingsTab({ tab: "status" })).toBe("conversation");
    expect(movedSettingsRoute("status" as never, undefined)).toEqual({ tab: "conversation", focus: { anchor: STATUS_ROW_ANCHOR } });
  });
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  m.capsule = "disabled";
  m.places = {};
  m.set.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (el: Parameters<typeof h>[0]) => act(() => root.render(h(I18nProvider, null, h(el as never))));
const box = (id: string) => host.querySelector<HTMLButtonElement>(`[data-status-check="${id}"] [role=checkbox]`)!;

describe("会话 → 输入: 状态行里显示", () => {
  it("every item is ticked by default (defaults are 两者 / 状态行), capsule off", () => {
    m.places = { goal: "bar" };
    render(StatusRowChecks);
    expect(host.querySelector('[data-status-checks="row"]')).not.toBeNull();
    for (const i of ITEMS) expect(box(i.id).getAttribute("aria-checked"), i.id).toBe("true");
  });

  it("capsule off: a saved 胶囊 shows ticked; 不显示 stays unticked; unticking writes 不显示", () => {
    m.places = { plan: "capsule", alarms: "off" };
    render(StatusRowChecks);
    expect(box("plan").getAttribute("aria-checked")).toBe("true");
    expect(box("alarms").getAttribute("aria-checked")).toBe("false");
    act(() => box("plan").click());
    expect(m.set).toHaveBeenLastCalledWith("plan", "off");
    act(() => box("alarms").click());
    expect(m.set).toHaveBeenLastCalledWith("alarms", "bar");
  });

  it("capsule on: 胶囊-only items are unticked in the row; ticking adds the row, unticking keeps the capsule", () => {
    m.capsule = "on";
    m.places = { plan: "capsule", jobs: "both" };
    render(StatusRowChecks);
    expect(box("plan").getAttribute("aria-checked")).toBe("false");
    act(() => box("plan").click());
    expect(m.set).toHaveBeenLastCalledWith("plan", "both");
    act(() => box("jobs").click());
    expect(m.set).toHaveBeenLastCalledWith("jobs", "capsule");
  });
});

describe("并排工作区 moved from 托盘 to 会话 → 布局", () => {
  it("the tray page no longer has it; the width section does, with the same pref", () => {
    const tray = src("components/TraySettings.tsx");
    const rows = tray.slice(tray.indexOf("export function TraySettingRows"), tray.indexOf("export function ThreeWorkspacesRow"));
    expect(rows).not.toContain("setTrayPrefs({ allowThreeColumns");
    expect(src("components/WorkSurfaceSettings.tsx")).toMatch(/<Section id=\{settingsAnchorId\(WORKSPACES_ANCHOR\)\} title=\{t\("workspace\.sideBySide"\)\}>\s*<ThreeWorkspacesRow \/>\s*<\/Section>/);
    expect(WORKSPACES_ANCHOR).toBe("workspaces");
  });

  it("the row toggles allowThreeColumns", () => {
    const before = useTrayPrefs.getState().allowThreeColumns;
    render(ThreeWorkspacesRow);
    act(() => host.querySelector<HTMLButtonElement>("[role=switch]")!.click());
    expect(useTrayPrefs.getState().allowThreeColumns).toBe(!before);
  });
});

describe("the capsule's module page", () => {
  it("lists the items for the capsule, then its position and size", () => {
    const page = src("modules/status-capsule/CapsuleSettings.tsx");
    const items = page.indexOf('<StatusItemChecks kind="capsule" surface="capsule"');
    expect(items).toBeGreaterThan(0);
    expect(items).toBeLessThan(page.indexOf("<CapsuleSettingsSection />"));
    expect(src("modules/status-capsule/StatusCapsule.tsx")).not.toContain("panelSettingsForetell");
  });
});
