// @vitest-environment jsdom
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileDetail, ProfilePatch } from "../src/shared/ipc";
import { en, zhCN } from "../src/renderer/src/lib/settingsProfileCompatMessages";

const language = vi.hoisted(() => ({ locale: "en" as "en" | "zh-CN" }));
vi.mock("../src/renderer/src/i18n", async () => {
  const messages = await import("../src/renderer/src/lib/settingsProfileCompatMessages");
  return { useI18n: () => ({ locale: language.locale, t: (key: string) => {
    const catalog = language.locale === "en" ? messages.en : messages.zhCN;
    return (catalog as Record<string, string>)[key] ?? key;
  } }) };
});
import { ProfileToolFields } from "../src/renderer/src/components/settings/ProfileToolFields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
const detail = { searchTool: false, detail: { editable: { webSearch: true, searchTool: true, updatePlanEnabled: true } } } as unknown as ProfileDetail;
beforeEach(() => { language.locale = "en"; element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); });

describe("Profile provider compatibility help", () => {
  it.each(["en", "zh-CN"] as const)("shows the existing InfoTips beside all three tool controls in %s without changing a draft", locale => {
    language.locale = locale;
    const set = vi.fn();
    act(() => root.render(h(ProfileToolFields, { detail, cfg: { webSearch: "live" }, set })));
    const info = element.querySelectorAll<HTMLButtonElement>("[data-setting-info]");
    const tips = element.querySelectorAll<HTMLElement>("[data-setting-info-tip]");
    expect(info.length).toBe(3); expect(tips.length).toBe(3);
    const catalog = locale === "en" ? en : zhCN;
    expect(tips[1]!.textContent).toBe(catalog["settings.profileCompat.builtinSearch"]);
    expect(tips[2]!.textContent).toBe(catalog["settings.profileCompat.searchTool"]);
    act(() => info[1]!.focus()); expect(tips[1]!.classList.contains("block")).toBe(true);
    act(() => info[2]!.focus()); expect(tips[1]!.classList.contains("hidden")).toBe(true); expect(tips[2]!.classList.contains("block")).toBe(true);
    act(() => info[2]!.click()); expect(set).not.toHaveBeenCalled();
    expect(element.querySelector("select")!.value).toBe("live");
  });

  it("keeps independent search and built-in search in the same draft, preserving unrelated model values", () => {
    let draft: ProfilePatch = {};
    function Editor() {
      const [patch, setPatch] = useState<ProfilePatch>({ model: "relay-model", webSearch: "live" });
      draft = patch;
      return h(ProfileToolFields, { detail, cfg: patch, searchTool: patch.searchTool, set: value => setPatch(old => ({ ...old, ...value })) });
    }
    act(() => root.render(h(Editor)));
    act(() => element.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1]!.click());
    expect(draft).toEqual({ model: "relay-model", webSearch: "disabled", searchTool: true });
    expect(element.querySelector("[data-search-tool-conflict]")).toBeNull();
    const search = element.querySelector("select")!;
    act(() => { search.value = "cached"; search.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(element.querySelector("[data-search-tool-conflict]")).not.toBeNull();
    expect(draft.model).toBe("relay-model");
    act(() => element.querySelector<HTMLButtonElement>("[data-search-tool-conflict] button")!.click());
    expect(draft).toEqual({ model: "relay-model", webSearch: "disabled", searchTool: true });
  });

  it("turning separate search off does not silently restore built-in search", () => {
    const set = vi.fn();
    act(() => root.render(h(ProfileToolFields, { detail, cfg: { webSearch: "disabled" }, searchTool: true, set })));
    act(() => element.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1]!.click());
    expect(set).toHaveBeenCalledExactlyOnceWith({ searchTool: false });
  });

  it("does not set defaults or apply any compatibility preset just by showing help", () => {
    const set = vi.fn();
    act(() => root.render(h(ProfileToolFields, { detail, cfg: {}, set })));
    expect(element.querySelector("select")!.value).toBe("");
    expect([...element.querySelectorAll('[role="switch"]')].every(node => node.getAttribute("aria-checked") === "false")).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it("keeps stored indexed search selectable, without offering it to new configurations", () => {
    const set = vi.fn();
    act(() => root.render(h(ProfileToolFields, { detail, cfg: { webSearch: "indexed" }, set })));
    expect(element.querySelector("select")!.value).toBe("indexed");
    act(() => root.render(h(ProfileToolFields, { detail, cfg: { webSearch: "cached" }, set })));
    expect(element.querySelector('option[value="indexed"]')).toBeNull(); expect(set).not.toHaveBeenCalled();
  });

  it("hides tools and their compatibility help when the host does not offer the fields", () => {
    const set = vi.fn();
    act(() => root.render(h(ProfileToolFields, { detail: { detail: { editable: { webSearch: false, searchTool: false } } } as unknown as ProfileDetail, cfg: {}, set })));
    expect(element.querySelector("[data-setting-info]")).toBeNull(); expect(element.textContent).toBe(""); expect(set).not.toHaveBeenCalled();
  });
});
