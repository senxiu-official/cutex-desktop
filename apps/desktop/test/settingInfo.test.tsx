// @vitest-environment jsdom
// Settings hints (owner 2026-10-23): a short "what this is" line is an ⓘ next to the label (`SettingRow info`): a button
// the keyboard reaches, the text as its tooltip and the row control's description; consequences stay visible (`hint`).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { SettingRow } = await import("../src/renderer/src/components/settings/Form");

let root: ReturnType<typeof createRoot> | null = null;
const render = (el: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
};
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

it("`info`: an ⓘ button after the label, the text only in the tooltip (also the description of the row)", () => {
  const host = render(h(SettingRow, { label: "行距", agents: "none", source: "local", info: "侧栏每行的松紧" }, h("input", { id: "c" })));
  const btn = host.querySelector<HTMLButtonElement>("[data-setting-info]")!;
  expect(btn.tagName).toBe("BUTTON");
  expect(btn.getAttribute("type")).toBe("button");
  const tip = host.querySelector("[data-setting-info-tip]")!;
  expect(tip.textContent).toBe("侧栏每行的松紧");
  expect(tip.getAttribute("role")).toBe("tooltip");
  expect(btn.getAttribute("aria-describedby")).toBe(tip.id);
  expect(tip.className).toContain("hidden");
  act(() => void btn.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(tip.className).toContain("block");
  expect(["above", "side", "below"]).toContain(tip.getAttribute("data-placed")); // measured in a browser (jsdom has no layout)
  act(() => void btn.parentElement!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
  expect(tip.className).toContain("hidden");
  expect(host.textContent).toContain("行距");
  expect(host.querySelector("[data-setting-row] > div > div.text-xs.text-subtle")).toBeNull(); // no hint line under the row label
});

it("`hint` stays a visible line under the row, with no ⓘ", () => {
  const host = render(h(SettingRow, { label: "清除", agents: "none", source: "local", hint: "会删除全部历史，不能撤销" }, null));
  expect(host.querySelector("[data-setting-info]")).toBeNull();
  expect(host.textContent).toContain("会删除全部历史，不能撤销");
});

it("no room above (the first row of a dialog such as 编辑信息…): the note sits level with the ⓘ, not over the field below", () => {
  const host = render(h("div", { style: { overflowY: "auto" }, id: "scroller" }, h(SettingRow, { label: "名字", agents: "none", source: "local", info: "显示在侧栏和会话里" }, h("input", { id: "name" }))));
  const rect = (top: number, left: number, w: number, hgt: number) => () => ({ top, left, right: left + w, bottom: top + hgt, width: w, height: hgt, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  host.querySelector<HTMLElement>("#scroller")!.getBoundingClientRect = rect(100, 0, 600, 400);
  const btn = host.querySelector<HTMLButtonElement>("[data-setting-info]")!;
  btn.parentElement!.getBoundingClientRect = rect(102, 80, 16, 16);
  act(() => void btn.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  const tip = host.querySelector("[data-setting-info-tip]")!;
  expect(tip.getAttribute("data-placed")).toBe("side");
  expect(tip.className).toContain("left-full");
  expect(tip.className).not.toContain("top-full");
});

it("in a dialog with no room above, the note goes outside the dialog's edge, level with the ⓘ (fixed, never clipped)", () => {
  const host = render(h("div", { role: "dialog", id: "dlg", style: { overflowY: "auto" } }, h(SettingRow, { label: "显示名称", agents: "none", source: "local", info: "只有你在桌面上看到这个名字" }, h("input", { id: "name" }))));
  const rect = (top: number, left: number, w: number, hgt: number) => () => ({ top, left, right: left + w, bottom: top + hgt, width: w, height: hgt, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  host.querySelector<HTMLElement>("#dlg")!.getBoundingClientRect = rect(100, 300, 400, 500);
  const btn = host.querySelector<HTMLButtonElement>("[data-setting-info]")!;
  btn.parentElement!.getBoundingClientRect = rect(102, 380, 16, 16);
  act(() => void btn.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  const tip = host.querySelector<HTMLElement>("[data-setting-info-tip]")!;
  expect(tip.getAttribute("data-placed")).toBe("outside");
  expect(tip.style.position).toBe("fixed");
  expect(parseFloat(tip.style.left)).toBeGreaterThanOrEqual(700);
  expect(parseFloat(tip.style.top)).toBe(102);
});
