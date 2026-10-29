// @vitest-environment jsdom
// Settings card headers (owner 2026-10-25): the title never truncates. Since the revamp a header can hold the
// title, its card-level markers, 「只看你修改过的设置 (N)」 and a preset switch; on 通知 → 事件分级 the title was cut
// to 「事...」 at 1440 px (0 px wide at 1024). The shared Section header now wraps: the title group (title + its
// markers + tag) never shrinks, the controls move to a line of their own when they don't fit.
// jsdom has no layout: this pins the structure; scripts/settings-header-audit.mjs measures every Settings page
// in Chrome (title scrollWidth <= clientWidth, no overlap, no overflow) at 1440 / 1280 / 1024.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { I18nProvider } = await import("../src/renderer/src/i18n");
const { Section, Segmented } = await import("../src/renderer/src/components/settings/Form");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const preset = h(Segmented, { value: "a" as string, options: [{ value: "a", label: "推荐" }, { value: "b", label: "自定义" }], onChange: () => {} });

describe("settings card header", () => {
  it("the title can wrap but never truncates; title group and controls are separate wrapping groups", () => {
    act(() => root.render(h(I18nProvider, null, h(Section, { title: "事件分级", hint: "调整不同事件的通知等级", tag: { label: "旧版" }, actions: preset, children: h("div", null, "rows") }))));
    const head = host.querySelector<HTMLElement>("[data-settings-card-head]")!;
    expect(head).not.toBeNull();
    const h3 = head.querySelector("h3")!;
    expect(h3.textContent).toBe("事件分级");
    expect(h3.className).not.toMatch(/\b(truncate|text-ellipsis|overflow-hidden|whitespace-nowrap|line-clamp-\d)\b/);
    // The header wraps and has no fixed height (a second line must fit).
    expect(head.className).toMatch(/\bflex-wrap\b/);
    expect(head.className).not.toMatch(/(^|\s)h-\d/);
    // Title, its markers and tag: one group that does not shrink (it wraps inside, up to the full width).
    const title = head.querySelector<HTMLElement>("[data-settings-card-title]")!;
    expect(title.contains(h3)).toBe(true);
    expect(title.className).toMatch(/\bshrink-0\b/);
    expect(title.className).toMatch(/\bmax-w-full\b/);
    expect(title.className).toMatch(/\bflex-wrap\b/);
    expect(title.textContent).toContain("旧版");
    // Controls: their own group, right-aligned, wrapping (they go below the title when they don't fit).
    const controls = head.querySelector<HTMLElement>("[data-settings-card-controls]")!;
    expect(controls.contains(title)).toBe(false);
    expect(title.contains(controls)).toBe(false);
    expect(controls.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(controls.className).toMatch(/\bml-auto\b/);
    expect(controls.className).toMatch(/\bflex-wrap\b/);
    expect(controls.className).not.toMatch(/\bshrink-0\b/);
  });

  it("no source keeps a truncating card title in the shared header", () => {
    const form = readFileSync(resolve(__dirname, "../src/renderer/src/components/settings/Form.tsx"), "utf8");
    const head = form.slice(form.indexOf("data-settings-card-head"), form.indexOf("data-settings-card-controls"));
    expect(head).toContain("<h3");
    expect(head).not.toMatch(/<h3[^>]*\btruncate\b/);
  });
});
