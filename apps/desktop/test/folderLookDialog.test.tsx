// @vitest-environment jsdom
// Folder menu 外观… (owner 2026-11-06): the dialog previews the folder header, offers 自动 plus the palette and the
// icon set, saves only on 保存, and 恢复自动 saves `look: null`.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}${JSON.stringify(vars)}` : key) }) }));

import { FolderLookDialog } from "../src/renderer/src/components/FolderLookDialog";
import { FOLDER_COLORS, FOLDER_EXTRA_COLORS } from "../src/renderer/src/lib/folderLook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (initial?: { color?: string; icon?: string }) => {
  const resolve = vi.fn();
  act(() => root.render(h(FolderLookDialog, { id: "s-1", name: "Work", initial, resolve })));
  return resolve;
};
const button = (pred: (b: HTMLButtonElement) => boolean) => [...host.querySelectorAll("button")].find(pred)!;
const click = (b: HTMLButtonElement) => act(() => b.click());

describe("FolderLookDialog", () => {
  it("starts automatic, previews a picked colour and icon, and saves them", () => {
    const resolve = render();
    const autos = [...host.querySelectorAll("button")].filter((b) => b.textContent === "section.lookAuto");
    expect(autos.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "true"]);
    click(button((b) => b.getAttribute("aria-label") === "section.color.violet"));
    click(button((b) => b.getAttribute("aria-label") === "music"));
    const preview = host.querySelector<HTMLElement>("[data-folder-look-preview]")!;
    expect(preview.style.getPropertyValue("--folder-color")).toBe(FOLDER_COLORS[3]);
    expect(resolve).not.toHaveBeenCalled();
    click(button((b) => b.textContent === "settings.save"));
    expect(resolve).toHaveBeenCalledWith({ look: { color: FOLDER_COLORS[3], icon: "music" } });
  });
  it("恢复自动 clears both and saves null; 取消 saves nothing", () => {
    const resolve = render({ color: FOLDER_COLORS[0], icon: "flag" });
    click(button((b) => b.textContent === "section.lookReset"));
    expect(host.textContent).not.toContain("section.lookReset");
    click(button((b) => b.textContent === "settings.save"));
    expect(resolve).toHaveBeenCalledWith({ look: null });
    const cancelled = render({ icon: "flag" });
    click(button((b) => b.textContent === "dialog.cancel"));
    expect(cancelled).toHaveBeenCalledWith(null);
  });
  it("offers the palette, the extra swatches and a custom colour (native picker or hex); a custom pick saves as #RRGGBB", () => {
    const resolve = render();
    const swatches = host.querySelectorAll("button[aria-label^='section.color.']");
    expect(swatches.length).toBe(FOLDER_COLORS.length + FOLDER_EXTRA_COLORS.length);
    const picker = host.querySelector<HTMLInputElement>("input[type=color]")!;
    expect(picker).not.toBeNull();
    const hex = host.querySelector<HTMLInputElement>("[data-folder-custom-color] input[type=text]")!;
    const type = (value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(hex, value);
      hex.dispatchEvent(new Event("input", { bubbles: true }));
    });
    type("#12");
    expect(host.querySelector("[aria-invalid=true]")).not.toBeNull();
    type("#1a2");
    expect(host.querySelector<HTMLElement>("[data-folder-look-preview]")!.style.getPropertyValue("--folder-ink-light")).not.toBe("");
    expect(host.querySelector("[data-folder-ink-hint]")).not.toBeNull();
    click(button((b) => b.textContent === "settings.save"));
    expect(resolve).toHaveBeenCalledWith({ look: { color: "#11AA22" } });
  });

  it("icons come in groups, filtered by the search; the grid keeps a fixed height", () => {
    render();
    const grid = host.querySelector<HTMLElement>("[data-folder-icon-grid]")!;
    expect(grid.className).toContain("h-[208px]");
    expect(grid.querySelectorAll("[data-icon-group]").length).toBeGreaterThan(8);
    const search = host.querySelector<HTMLInputElement>("input[aria-label='section.lookIconSearch']")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "plane");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...grid.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["plane"]);
  });
});
