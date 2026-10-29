// @vitest-environment jsdom
// 头像风格 (owner 2026-10-24): components/settings/AvatarStylePicker — one controlled picker for 拟人 / emoji / 字母
// (and 跟随应用 on a Profile) — and Settings → 外观 → 头像风格 (PortraitSettings PortraitPackSection): the app style
// through lib/avatarStyle, batch 「都换成当前风格」 / 「重新分配」 through lib/avatarStyleAssign with an in-place confirm.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  reassignOnly: false,
  plan: [] as { seed: string; hostId: string; before: unknown; after: unknown }[],
  planCalls: [] as { kind: string; nonce: string | undefined }[],
  applied: [] as { kind: string; n: number }[],
  agents: [] as { seed: string; hostId: string; projectId: string | null; family: string | null; avatar: unknown }[],
}));

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "zh-CN" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/avatarStyleAssign", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  planStyleChanges: (_index: unknown, _agents: unknown, _resolve: unknown, kind = "replace", nonce?: string) => {
    fx.planCalls.push({ kind, nonce });
    return kind === "replace" && fx.reassignOnly ? [] : fx.plan;
  },
}));
vi.mock("../src/renderer/src/lib/portraitAssign", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentsForPortraits: () => fx.agents,
  applyPortraitChanges: async (kind: string, changes: readonly unknown[]) => {
    fx.applied.push({ kind, n: changes.length });
    return { written: changes.length, failed: 0 };
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { AvatarStyle } from "../src/renderer/src/lib/avatarStyle";
import { getAppAvatarStyle, setAppAvatarStyle } from "../src/renderer/src/lib/avatarStyle";
import { AvatarStylePicker } from "../src/renderer/src/components/settings/AvatarStylePicker";
import { PortraitPackSection } from "../src/renderer/src/components/settings/PortraitSettings";
import { getUiPrefs } from "../src/renderer/src/lib/prefs";
import { packOf, resetPortraitPacksForTest } from "../src/renderer/src/lib/portraitPacks";
import { parsePackManifest } from "../src/shared/portraitPacks";
import { zhCN, en } from "../src/renderer/src/lib/avatarStyleMessages";

const entries = (theme: string) => ["claude", "gpt", "kimi"].flatMap((model) => [1, 2].map((v) => ({ theme, themeName: theme.toUpperCase(), model, avatarPath: `avatars/${theme}/${model}-v${v}.webp` })));
const PACK = packOf("p", parsePackManifest({ schemaVersion: 1, name: "测试包", entries: [...entries("beach"), ...entries("office")] })!, "bundled", (path) => `/p/${path}`);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetPortraitPacksForTest([PACK]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fx.plan = [];
  fx.reassignOnly = false;
  fx.planCalls = [];
  fx.applied = [];
  fx.agents = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => setAppAvatarStyle({ kind: "emoji", emojiThemes: null }));
  resetPortraitPacksForTest();
});

const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const box = (key: string) => q(`[data-portrait-theme='${key}'] input[type=checkbox]`) as HTMLInputElement;
const radio = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")].find((b) => b.textContent === label)!;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;

/** Renders a controlled picker that applies its own changes, recording each value. */
function controlled(initial: AvatarStyle | null, props: { allowInherit?: boolean; inherited?: AvatarStyle | null } = {}) {
  const seen: (AvatarStyle | null)[] = [];
  let value = initial;
  const draw = () => act(() => root.render(h(AvatarStylePicker, { value, onChange: (v: AvatarStyle | null) => { seen.push(v); value = v; draw(); }, ...props })));
  draw();
  return seen;
}

describe("AvatarStylePicker", () => {
  it("拟人: cards per pack with family counts; ticking keeps pack order; the last ticked theme cannot be unticked", () => {
    const seen = controlled({ kind: "portrait", portraitThemes: ["p/office"] });
    expect(q("[data-avatar-style-picker]")!.getAttribute("data-avatar-style")).toBe("portrait");
    expect(q("[data-portrait-counts]")!.textContent).toBe("Claude 4 · GPT 4 · Kimi 4");
    expect(box("p/office").disabled).toBe(true);
    act(() => box("p/beach").click());
    expect(seen.at(-1)).toEqual({ kind: "portrait", portraitThemes: ["p/beach", "p/office"] });
    act(() => box("p/office").click());
    expect(seen.at(-1)).toEqual({ kind: "portrait", portraitThemes: ["p/beach"] });
  });

  it("each theme card shows one face (its cover), whole, next to the checkbox, name and count", () => {
    controlled({ kind: "portrait", portraitThemes: ["p/beach"] });
    const cards = [...host.querySelectorAll<HTMLElement>("[data-portrait-theme]")];
    expect(cards.length).toBe(2);
    for (const card of cards) {
      const imgs = card.querySelectorAll("img");
      expect(imgs.length).toBe(1);
      expect(imgs[0]!.className).toContain("object-contain");
      expect(card.querySelectorAll("[data-portrait-face]").length).toBe(1);
      expect(card.querySelector("[data-portrait-face]")!.getAttribute("data-portrait-face")).toBe(`${card.getAttribute("data-portrait-theme")}/claude-v1`);
      expect(card.querySelector("input[type=checkbox]")).not.toBeNull();
      expect(card.textContent).toBe(`${card.getAttribute("data-portrait-theme")!.slice(2).toUpperCase()}6`);
    }
  });

  it("the sr-only checkbox sits in a positioned label (else focusing it scrolls the Settings card away)", () => {
    controlled({ kind: "portrait", portraitThemes: ["p/beach"] });
    for (const input of host.querySelectorAll<HTMLInputElement>("[data-portrait-theme] input[type=checkbox]")) {
      expect(input.className).toContain("sr-only");
      expect(input.closest("[data-portrait-theme]")!.className.split(" ")).toContain("relative");
    }
  });

  it("全选 / 只留第一个 per pack", () => {
    const seen = controlled({ kind: "portrait", portraitThemes: ["p/office"] });
    act(() => q("[data-pack-all]")!.click());
    expect(seen.at(-1)).toEqual({ kind: "portrait", portraitThemes: ["p/beach", "p/office"] });
    act(() => q("[data-pack-first]")!.click());
    expect(seen.at(-1)).toEqual({ kind: "portrait", portraitThemes: ["p/beach"] });
  });

  it("emoji: 按模型 (null) or ticked themes, at least one; 字母 has nothing to choose", () => {
    const seen = controlled({ kind: "emoji", emojiThemes: null });
    expect(q("[data-emoji-theme]")).toBeNull();
    act(() => radio("avatarStyle.emoji.pick").click());
    expect(seen.at(-1)).toEqual({ kind: "emoji", emojiThemes: ["animals"] });
    expect((q("[data-emoji-theme='animals']") as HTMLButtonElement).disabled).toBe(true);
    act(() => q("[data-emoji-theme='sky']")!.click());
    act(() => q("[data-emoji-theme='sea']")!.click());
    expect(seen.at(-1)).toEqual({ kind: "emoji", emojiThemes: ["animals", "sea", "sky"] });
    act(() => radio("avatarStyle.kind.letter").click());
    expect(seen.at(-1)).toEqual({ kind: "letter" });
    expect(q("[data-style-letter]")).not.toBeNull();
    // Back to emoji: the themes ticked a moment ago, not 按模型.
    act(() => radio("avatarStyle.kind.emoji").click());
    expect(seen.at(-1)).toEqual({ kind: "emoji", emojiThemes: ["animals", "sea", "sky"] });
  });

  it("Profile level: 跟随应用 = null with what it means now; 拟人 starts from the inherited themes", () => {
    const seen = controlled(null, { allowInherit: true, inherited: { kind: "portrait", portraitThemes: ["p/office"] } });
    expect(q("[data-avatar-style-picker]")!.getAttribute("data-avatar-style")).toBe("inherit");
    expect(q("[data-style-inherited]")!.textContent).toContain("OFFICE");
    act(() => radio("avatarStyle.kind.portrait").click());
    expect(seen.at(-1)).toEqual({ kind: "portrait", portraitThemes: ["p/office"] });
    act(() => radio("avatarStyle.kind.inherit").click());
    expect(seen.at(-1)).toBeNull();
  });

  it("the app level offers no 跟随应用", () => {
    controlled({ kind: "letter" });
    expect([...host.querySelectorAll("[role=radio]")].map((b) => b.textContent)).toEqual(["avatarStyle.kind.portrait", "avatarStyle.kind.emoji", "avatarStyle.kind.letter"]);
  });
});

describe("Settings → 外观 → 头像风格", () => {
  it("the picker edits the app style (and the legacy portraitPacks key older desktops read)", () => {
    act(() => setAppAvatarStyle({ kind: "portrait", portraitThemes: ["p/beach"] }));
    act(() => root.render(h(PortraitPackSection)));
    act(() => box("p/office").click());
    expect(getAppAvatarStyle()).toEqual({ kind: "portrait", portraitThemes: ["p/beach", "p/office"] });
    expect(getUiPrefs().portraitPacks).toEqual(["p/beach", "p/office"]);
    act(() => radio("avatarStyle.kind.letter").click());
    expect(getAppAvatarStyle()).toEqual({ kind: "letter" });
    expect(getUiPrefs().portraitPacks).toEqual([]);
  });

  it("都换成当前风格 / 重新分配: hosts and count in place, written only after the confirm; each 重新分配 a new nonce", async () => {
    fx.plan = [{ seed: "a", hostId: "local", before: null, after: { kind: "emoji", value: "🦊" } }, { seed: "b", hostId: "local", before: { kind: "emoji", value: "🐼" }, after: null }];
    act(() => root.render(h(PortraitPackSection)));
    expect(q("[data-portrait-bulk-scope]")!.textContent).toContain('"n":2');
    act(() => button("avatarStyle.bulk.replaceAll").click());
    expect(fx.applied).toEqual([]);
    expect(q("[data-style-bulk-confirm='replace']")!.textContent).toContain("avatarStyle.bulk.confirmReplace");
    act(() => [...host.querySelectorAll<HTMLButtonElement>("[data-settings-risk-confirm] button")].at(-1)!.click());
    expect(q("[data-style-bulk-confirm]")).toBeNull();
    expect(fx.applied).toEqual([]);

    act(() => button("avatarStyle.bulk.reassign").click());
    const first = fx.planCalls.filter((c) => c.kind === "reassign").at(-1)!.nonce;
    expect(q("[data-style-bulk-confirm='reassign']")).not.toBeNull();
    await act(async () => q("[data-settings-risk-confirm] button")!.click());
    expect(fx.applied).toEqual([{ kind: "reassign", n: 2 }]);
    act(() => button("avatarStyle.bulk.reassign").click());
    expect(fx.planCalls.filter((c) => c.kind === "reassign").at(-1)!.nonce).not.toBe(first);
  });

  it("nothing to change: both buttons off", () => {
    act(() => root.render(h(PortraitPackSection)));
    expect(button("avatarStyle.bulk.replaceAll").disabled).toBe(true);
    expect(button("avatarStyle.bulk.reassign").disabled).toBe(true);
  });

  it("reassign remains available when current-style replacement is already complete", () => {
    fx.reassignOnly = true;
    fx.plan = [{ seed: "a", hostId: "local", before: { kind: "emoji", value: "🦊" }, after: { kind: "emoji", value: "🐼" } }];
    act(() => root.render(h(PortraitPackSection)));
    expect(button("avatarStyle.bulk.replaceAll").disabled).toBe(true);
    expect(button("avatarStyle.bulk.reassign").disabled).toBe(false);
  });

  it("pictures of a retired pack: a calm info line (not a warning) and 修复缺图 swaps them in one click", async () => {
    fx.agents = [{ seed: "a", hostId: "local", projectId: null, family: "claude", avatar: { kind: "icon", value: "portrait:overnight-test-v1/lolita/claude-v1" } }];
    act(() => root.render(h(PortraitPackSection)));
    const row = q("[data-portrait-fallen]")!;
    expect(row.getAttribute("data-portrait-fallen")).toBe("1");
    const notice = [...row.querySelectorAll("p")].find((p) => p.textContent!.startsWith("appearance.portraits.fallen"))!;
    expect(notice.className).toContain("text-subtle");
    expect(notice.className).not.toContain("text-warn");
    await act(async () => button("avatarStyle.bulk.repair").click());
    expect(fx.applied).toEqual([{ kind: "reassign", n: 1 }]);
  });

  it("same-count target changes cannot reuse a bulk confirmation", async () => {
    fx.plan = [{ seed: "a", hostId: "local", before: null, after: { kind: "emoji", value: "🦊" } }];
    act(() => root.render(h(PortraitPackSection)));
    act(() => button("avatarStyle.bulk.replaceAll").click());
    fx.plan = [{ seed: "another", hostId: "local", before: null, after: { kind: "emoji", value: "🦊" } }];
    await act(async () => q("[data-settings-risk-confirm] button")!.click());
    expect(fx.applied).toEqual([]);
  });
});

describe("avatarStyleMessages", () => {
  it("en has every zh-CN key and keeps their {vars}", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
    // {vars} only: {{agent}}-style terms differ in case and number between the languages.
    const vars = (s: string) => s.match(/(?<!\{)\{\w+\}(?!\})/g)?.sort() ?? [];
    for (const [k, v] of Object.entries(zhCN)) expect(vars((en as Record<string, string>)[k]!), k).toEqual(vars(v));
  });
});
