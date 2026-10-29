// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ host: "local", enabled: false, patch: vi.fn(), supported: true }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (original) => {
  const actual = await original<typeof import("../src/renderer/src/i18n")>();
  return { ...actual, useI18n: () => ({ t: actual.translate, locale: "en" }) };
});
vi.mock("../src/renderer/src/lib/globalSettings", async (original) => ({ ...(await original<object>()), useGlobalSettings: () => ({ settings: { archiveDeleteEmpty: fx.enabled }, error: null, patch: fx.patch }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (original) => ({ ...(await original<object>()), useTargetHostId: () => fx.host, useTargetFeatures: () => new Set(fx.supported ? ["session-delete-empty-on-archive"] : []) }));

import { ArchiveBehaviour } from "../src/renderer/src/components/settings/AppSettings";
import { AvatarSettings } from "../src/renderer/src/components/settings/AvatarSettings";
import { getUiPrefs } from "../src/renderer/src/lib/prefs";
import { translate } from "../src/renderer/src/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fx.host = "local"; fx.enabled = false; fx.supported = true; fx.patch.mockReset();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (key: Parameters<typeof translate>[0]) => [...host.querySelectorAll("button")].find((b) => b.textContent === translate(key))!;

describe("empty archive retention policy", () => {
  it("does not enable deletion on first click, supports cancellation, and confirms exactly once", () => {
    act(() => root.render(h(ArchiveBehaviour)));
    act(() => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(fx.patch).not.toHaveBeenCalled();
    expect(host.textContent).toContain(translate("settings.ia.emptyConfirm", { host: "local" }));
    act(() => button("settings.ia.emptyCancel").click());
    expect(fx.patch).not.toHaveBeenCalled();
    act(() => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    act(() => button("settings.ia.emptyEnable").click());
    expect(fx.patch).toHaveBeenCalledExactlyOnceWith({ archiveDeleteEmpty: true });
    expect(button("settings.ia.emptyEnable")).toBeUndefined();
  });
  it("allows narrowing without confirmation and rejects a pending confirmation after host change", () => {
    fx.enabled = true;
    act(() => root.render(h(ArchiveBehaviour)));
    act(() => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(fx.patch).toHaveBeenCalledExactlyOnceWith({ archiveDeleteEmpty: false });
    fx.patch.mockClear(); fx.enabled = false;
    act(() => root.render(h(ArchiveBehaviour)));
    act(() => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    fx.host = "remote";
    act(() => root.render(h(ArchiveBehaviour)));
    expect(button("settings.ia.emptyEnable")).toBeUndefined();
    expect(fx.patch).not.toHaveBeenCalled();
  });
  it("keeps the legacy capability gate", () => {
    fx.supported = false;
    act(() => root.render(h(ArchiveBehaviour)));
    expect(host.textContent).toBe("");
    expect(fx.patch).not.toHaveBeenCalled();
  });
});

it("avatar settings keep their existing stored preference keys after the move", () => {
  act(() => root.render(h(AvatarSettings)));
  expect(host.querySelector("#settings-avatars")).not.toBeNull();
  const row = [...host.querySelectorAll('[data-setting-row]')].find((e) => e.textContent?.includes(translate("appearance.avatarTint")));
  const scope = row ?? host;
  const target = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === translate("appearance.avatarTint.provider"))!;
  act(() => target.click());
  expect(getUiPrefs().avatarTint).toBe("provider");
  expect(JSON.parse(localStorage.getItem("cutex-desktop.ui")!)).toMatchObject({ avatarTint: "provider" });
});
