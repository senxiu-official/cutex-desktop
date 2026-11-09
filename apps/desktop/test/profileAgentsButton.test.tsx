// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/renderer/src/i18n";
import { ProfileAgentsButton, PROFILE_AGENTS_MENU_MAX } from "../src/renderer/src/components/settings/ProfileAgentsButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const agents = (n: number) => Array.from({ length: n }, (_, i) => ({ cutexSessionId: `s${i}`, displayName: `Agent ${i}` }));

describe("ProfileAgentsButton (owner 2026-11-09: searchable above ~8 agents)", () => {
  it(`up to ${PROFILE_AGENTS_MENU_MAX} agents: the plain menu`, () => {
    const pick = vi.fn();
    act(() => root.render(h(I18nProvider, null, h(ProfileAgentsButton, { agents: agents(PROFILE_AGENTS_MENU_MAX), onPick: pick, title: "8 在用", className: "", children: "8" }))));
    act(() => host.querySelector("button")!.click());
    expect(document.querySelector("[data-menu-search]")).toBeNull();
  });
  it("more: a searchable picker; picking calls onPick with the session id", () => {
    const pick = vi.fn();
    act(() => root.render(h(I18nProvider, null, h(ProfileAgentsButton, { agents: agents(PROFILE_AGENTS_MENU_MAX + 1), onPick: pick, title: "9 在用", className: "", children: "9" }))));
    act(() => host.querySelector("button")!.click());
    const input = document.querySelector<HTMLInputElement>("[data-menu-search]")!;
    expect(input).toBeTruthy();
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Agent 7"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const rows = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(rows.map((r) => r.textContent)).toEqual(["Agent 7"]);
    act(() => rows[0]!.click());
    expect(pick).toHaveBeenCalledWith("s7");
  });
});
