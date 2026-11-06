// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
import { BadgeTintPicker } from "../src/renderer/src/components/BadgeTintPicker";
import { badgeColor } from "../src/renderer/src/lib/sessionBadge";
import { projectColor } from "../src/renderer/src/lib/sidebar";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const change = vi.fn();
const draw = (value: "blue" | "green" | "amber" | "pink" | "violet") => act(() => root.render(h(BadgeTintPicker, { value, onChange: change })));
beforeEach(() => { change.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const radios = () => [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")];

it("shows the five tints as swatches in the badge's own colours, named for screen readers and tips", () => {
  draw("pink");
  expect(host.querySelector("[role=radiogroup]")!.getAttribute("aria-label")).toBe("info.badgeTint");
  expect(radios().map((r) => r.getAttribute("aria-label"))).toEqual(["blue", "green", "amber", "pink", "violet"].map((c) => `info.badgeTint.${c}`));
  expect(radios().map((r) => r.dataset.tip)).toEqual(radios().map((r) => r.getAttribute("aria-label")));
  const probe = document.createElement("div");
  for (const r of radios()) { probe.style.background = projectColor(badgeColor(r.dataset.tint as "blue")); expect(r.style.background).toBe(probe.style.background); }
  expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true", "false"]);
  expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
});

it("picks by click and by arrow keys, wrapping at the ends", () => {
  draw("blue");
  act(() => radios()[2]!.click());
  expect(change).toHaveBeenLastCalledWith("amber");
  act(() => radios()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(change).toHaveBeenLastCalledWith("violet");
  act(() => radios()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(change).toHaveBeenLastCalledWith("green");
});
