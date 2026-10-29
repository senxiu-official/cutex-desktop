// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { zhCN, en } from "../src/renderer/src/lib/newProfileMessages";
import type { ProviderCard, ProviderCardId } from "../src/renderer/src/lib/newProfileModel";

const language = vi.hoisted(() => ({ locale: "zh-CN" }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: language.locale, t: (key: string) =>
  (language.locale === "en" ? en : zhCN)[key as keyof typeof zhCN] ?? key }) }));
import { ProviderCards, ProviderHeader } from "../src/renderer/src/components/settings/newProfile/ProviderCards";

const ids: ProviderCardId[] = ["openai", "anthropic", "deepseek", "kimi", "glm", "gemini", "more", "custom"];
const cards: ProviderCard[] = ids.map(id => ({ id,
  options: [{ id: "apiKey", auth: "apiKey", runtime: "codex", groups: [] }],
  runtimes: id === "kimi" ? ["codex", "kimi"] : id === "anthropic" ? ["claude"] : ["codex"],
}));
const brands = { openai: "Codex", anthropic: "Claude", deepseek: "DeepSeek", kimi: "Kimi", glm: "GLM", gemini: "Gemini" };
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; language.locale = "zh-CN"; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it.each(["zh-CN", "en"])("shows bundled brand marks and renamed labels in %s without changing card identities", locale => {
  language.locale = locale;
  const pick = vi.fn();
  act(() => root.render(h(ProviderCards, { cards, onPick: pick })));
  expect([...host.querySelectorAll("[data-provider-card]")].map(node => node.getAttribute("data-provider-card"))).toEqual(ids);
  for (const [id, label] of Object.entries(brands)) {
    const card = host.querySelector<HTMLButtonElement>(`[data-provider-card="${id}"]`)!;
    expect(card.textContent).toContain(id === "glm" && locale === "zh-CN" ? "智谱 GLM" : label);
    expect(card.querySelector(`[data-provider-mark] [title="${label}"] svg`)).not.toBeNull();
    const mark = card.querySelector("[data-provider-mark]")!.cloneNode(true) as HTMLElement;
    mark.querySelectorAll("svg").forEach(svg => svg.remove());
    expect(mark.textContent).toBe("");
    act(() => card.click());
    expect(pick.mock.lastCall![0]).toBe(cards.find(card => card.id === id));
  }
  expect(host.textContent).not.toMatch(/Moonshot|OpenAI|Anthropic/);
  for (const id of ["more", "custom"]) expect(host.querySelector(`[data-provider-mark="${id}"] > svg`)).not.toBeNull();
  const kimi = host.querySelector('[data-provider-card="kimi"]')!;
  expect(kimi.querySelector('[data-experimental-runtime="kimi"]')).not.toBeNull();
  expect(kimi.textContent).toContain("cute-codex · Kimi");
  expect(kimi.textContent).toContain("API key");
});

it("uses the same mark and label in the chosen header and preserves disabled actions", () => {
  for (const id of ["openai", "anthropic", "kimi"] as const) {
    const change = vi.fn(), card = cards.find(card => card.id === id)!;
    act(() => root.render(h(ProviderHeader, { card, onChange: change, disabled: true })));
    expect(host.querySelector(`[data-provider-chosen="${id}"]`)!.textContent).toContain(brands[id]);
    expect(host.querySelector(`[data-provider-mark] [title="${brands[id]}"] svg`)).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(change).not.toHaveBeenCalled();
  }
  const pick = vi.fn();
  act(() => root.render(h(ProviderCards, { cards, onPick: pick, disabled: true })));
  act(() => host.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.click()));
  expect(pick).not.toHaveBeenCalled();
});
