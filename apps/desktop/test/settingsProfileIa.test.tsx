// @vitest-environment jsdom
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileDetail, ProfilePatch } from "../src/shared/ipc";
import { en, zhCN } from "../src/renderer/src/lib/settingsProfileIaMessages";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
import { ProfileToolFields } from "../src/renderer/src/components/settings/ProfileToolFields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Profile tool group draft", () => {
  it("keeps the model draft and search mutual exclusion across both search controls", () => {
    const detail = { searchTool: false, detail: { editable: { updatePlanEnabled: true, webSearch: true, searchTool: true } } } as unknown as ProfileDetail;
    let draft: ProfilePatch = {};
    function Editor() {
      const [patch, setPatch] = useState<ProfilePatch>({ model: "my-model", webSearch: "live" });
      draft = patch;
      return h(ProfileToolFields, { detail, cfg: patch, searchTool: patch.searchTool, set: (p) => setPatch((old) => ({ ...old, ...p })) });
    }
    act(() => root.render(h(Editor)));
    const switches = () => host.querySelectorAll<HTMLButtonElement>('[role="switch"]');
    act(() => switches()[1]!.click());
    expect(draft).toEqual({ model: "my-model", webSearch: "disabled", searchTool: true });
    expect(host.querySelector("[data-search-tool-conflict]")).toBeNull();
    const select = host.querySelector("select")!;
    act(() => { select.value = "live"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(draft.webSearch).toBe("live");
    const conflict = host.querySelector("[data-search-tool-conflict]")!;
    expect(conflict).not.toBeNull();
    act(() => conflict.querySelector("button")!.click());
    expect(draft).toEqual({ model: "my-model", webSearch: "disabled", searchTool: true });
    act(() => switches()[0]!.click());
    expect(draft.updatePlanEnabled).toBe(true);
    expect(draft.model).toBe("my-model");
  });

  it("preserves capability gates and existing indexed search values", () => {
    const set = vi.fn();
    const detail = { detail: { editable: { updatePlanEnabled: false, webSearch: true } } } as unknown as ProfileDetail;
    act(() => root.render(h(ProfileToolFields, { detail, cfg: { webSearch: "indexed" }, set })));
    expect(host.querySelector('[role="switch"]')).toBeNull();
    expect(host.querySelector("select")!.value).toBe("indexed");
    expect(set).not.toHaveBeenCalled();
    act(() => root.render(h(ProfileToolFields, { detail: { detail: {} } as ProfileDetail, cfg: {}, set })));
    expect(host.textContent).toBe("");
    expect(set).not.toHaveBeenCalled();
  });
});

it("maintains bilingual scope and inheritance text with matching substitutions", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  for (const key of Object.keys(zhCN) as (keyof typeof zhCN)[]) {
    expect(zhCN[key]).toBeTruthy(); expect(en[key]).toBeTruthy();
    expect(zhCN[key].match(/\{\w+\}/g) ?? []).toEqual(en[key].match(/\{\w+\}/g) ?? []);
  }
});
