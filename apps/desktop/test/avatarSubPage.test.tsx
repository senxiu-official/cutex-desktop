// @vitest-environment jsdom
// 外观 → 头像 (owner 2026-11-27): 头像风格 and 完整头像主题 were flat lists on 外观 (far too long), and the avatar settings
// were scattered over it. One sub-page now holds them all (lib/portraitSettingsNav): 头像与身份标记, 头像风格, 完整头像主题,
// 已有智能体的头像, 主管头饰. 外观 keeps one 「头像」 card with a summary row. Old anchors and search land on the sub-page.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortraitCollectionsView } from "../src/shared/portraitCollections";
import type { MessageKey } from "../src/renderer/src/i18n";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/portraitThemes", async (original) => {
  const theme = (id: string) => ({ key: `kit-20261029/${id}`, pack: "kit-20261029", packName: "kit", bundled: true, theme: id, name: id, subtitle: null, cover: { key: id }, count: 6, families: {} });
  return { ...(await original<object>()), usePortraitThemes: () => ({ themes: ["cloud-woven-silks", "great-ming", "tales-of-frills", "ad-astra", "snowy-owl-post", "kindred-creatures"].map(theme), enabled: [] }), useSampleUrl: () => null };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW: PortraitCollectionsView = {
  checked: true,
  themes: [
    { theme: "cloud-woven-silks", available: 2, installed: 2, bytes: 3 },
    { theme: "great-ming", available: 2, installed: 1, bytes: 4 },
    { theme: "tales-of-frills", available: null, installed: 0, bytes: null },
    { theme: "ad-astra", available: 1, installed: null, bytes: 5 },
    { theme: "snowy-owl-post", available: 1, installed: null, bytes: 2 },
  ],
  operation: null,
  error: null,
};
(globalThis as { cutex?: unknown }).cutex = {
  portraitCollections: { state: async () => VIEW, check: async () => VIEW, install: async () => VIEW, retry: async () => VIEW },
  on: () => () => {},
};

const { useApp } = await import("../src/renderer/src/store");
const { I18nProvider, translate } = await import("../src/renderer/src/i18n");
const { AvatarEntrySection } = await import("../src/renderer/src/components/settings/AvatarSettings");
const { AvatarSubPage } = await import("../src/renderer/src/components/settings/AvatarSubPage");
const { subPageOfAnchor } = await import("../src/renderer/src/lib/settingsNav");
const { AVATAR_SUB, AVATAR_SUB_ANCHORS } = await import("../src/renderer/src/lib/portraitSettingsNav");
const { APPEARANCE_SEARCH } = await import("../src/renderer/src/modules/shell/settingsSearch");

let root: Root, box: HTMLDivElement;
const opened: unknown[][] = [];
beforeEach(() => { box = document.body.appendChild(document.createElement("div")); root = createRoot(box); opened.length = 0; useApp.setState({ openSettings: (...a: unknown[]) => void opened.push(a) } as never); });
afterEach(() => { act(() => root.unmount()); box.remove(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("外观 → 头像", () => {
  it("外观: one 「头像」 row with the style, the downloads and the headwear that opens the sub-page; the short settings beside it", async () => {
    await act(async () => root.render(h(I18nProvider, null, h(AvatarEntrySection))));
    await flush();
    const rows = [...box.querySelectorAll<HTMLButtonElement>("[data-settings-subpage]")];
    expect(rows).toHaveLength(1);
    const summary = box.querySelector("[data-avatar-summary]")!.textContent!;
    expect(summary).toContain("Downloaded 3 / 6 · 1 with an update");
    expect(summary).toMatch(/· Headwear: /);
    // The lists and galleries stay on the sub-page (settings-rules §7)…
    for (const sel of ["[data-portrait-library]", "[data-avatar-style-settings]", "[data-headwear-picker]", "[data-portrait-bulk]"]) expect(box.querySelector(sel), sel).toBeNull();
    // …the short settings are on 外观, next to the entry: 默认头像, 头像底色, 下属也戴, 节日头饰.
    const labels = [...box.querySelectorAll("[data-setting-row]")].map((r) => r.textContent ?? "");
    for (const key of ["avatarStyle.important", "appearance.avatarTint", "appearance.headwear.operators", "appearance.headwear.seasonal"] as const) {
      expect(labels.some((l) => l.includes(translate(key as MessageKey))), key).toBe(true);
    }
    expect(box.querySelectorAll("[role=switch]")).toHaveLength(3);
    act(() => rows[0]!.click());
    expect(opened).toEqual([["appearance", { sub: AVATAR_SUB }]]);
  });

  it("the sub-page: every avatar card, in order, each with its old anchor", async () => {
    await act(async () => root.render(h(I18nProvider, null, h(AvatarSubPage))));
    await flush();
    const ids = [...box.querySelectorAll<HTMLElement>("[id^=settings-]")].map((e) => e.id.replace(/^settings-/, "")).filter((id) => (AVATAR_SUB_ANCHORS as readonly string[]).includes(id));
    expect(ids).toEqual([...AVATAR_SUB_ANCHORS]);
    expect(box.querySelector("[data-headwear-picker]")).not.toBeNull();
    expect(box.querySelector("[data-portrait-library]")).not.toBeNull();
    // Short settings are not repeated here.
    expect(box.querySelector("[role=switch]")).toBeNull();
  });

  it("old anchors (links, the missing-portrait hint, the guide's 头像 part) and search results land on the sub-page", async () => {
    const shell = (await import("../src/renderer/src/modules/shell/index")).default;
    const page = shell.contributes!["settings.page"]!.find((p) => p.page === "appearance")!;
    expect(Object.keys(page.subPages ?? {})).toEqual([AVATAR_SUB]);
    for (const anchor of AVATAR_SUB_ANCHORS) expect(subPageOfAnchor(page, anchor), anchor).toBe(AVATAR_SUB);
    for (const anchor of ["colors", "fonts", "layout", "avatar", "work-surface", "launchArt"]) expect(subPageOfAnchor(page, anchor), anchor).toBeUndefined();
    const searched = APPEARANCE_SEARCH.sections!.map((s) => s.anchor);
    for (const anchor of [...AVATAR_SUB_ANCHORS, "avatar"]) expect(searched).toContain(anchor);
  }, 30000);
});
