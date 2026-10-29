// @vitest-environment jsdom
// The composer footer's profile chip shows the profile's avatar. It reads the profile list of the COMPOSER'S host (an agent of
// host02 viewed while another host has focus names a Profile the focus host does not have) and, with the name known but
// the look missing, still shows the initial on the name's colour — never nothing.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lists: Record<string, { profiles: unknown[] } | null> = {
  focus: { profiles: [{ id: "profileCedar", name: "profileCedar", authKind: "chatgpt", cliKind: "codex", baseUrl: null, appearance: null }] },
  eva: { profiles: [{ id: "ceobe", name: "Ceobe", authKind: "claude", cliKind: "claude", baseUrl: null, appearance: { color: "#336699" } }] },
  fresh: null,
};
const loaded: string[] = [];
let composerHost = "eva";
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "zh-CN" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/profileSnapshot", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cachedProfileList: (host = "focus") => lists[host] ?? null,
  loadProfileList: async (host = "focus") => {
    loaded.push(host);
    return lists[host] ?? null;
  },
}));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useComposerHost: () => composerHost,
  useHostQuotas: () => ({}),
  useHostLoadQuota: () => async () => {},
}));
// 同一账号 · X 也在用 (042 profile-link) would show as this marker wherever the badge is drawn.
vi.mock("../src/renderer/src/components/ProfileAccountBadge", async () => {
  const { createElement } = await import("react");
  return { ProfileAccountBadge: () => createElement("span", { "data-profile-account-link": "" }, "+host02") };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ProfileQuota } = await import("../src/renderer/src/components/Composer");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  loaded.length = 0;
  composerHost = "eva";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (profile: string | null) => {
  await act(async () => root.render(h(ProfileQuota, { profile, rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false })));
};

describe("composer profile chip avatar", () => {
  it("a Profile that exists only on the composer's host (not the focus host's) still has its avatar", async () => {
    await render("Ceobe");
    expect(host.textContent).toContain("Ceobe");
    expect(host.textContent).toContain("C"); // the initial
    const bg = [...host.querySelectorAll<HTMLElement>("span")].find((s) => s.style.background.includes("51, 102, 153") || s.style.background.includes("#336699"));
    expect(bg, "its own colour from the composer host's list").toBeTruthy();
  });

  it("a name the host's list does not have (not loaded / a new agent) falls back to the initial on the name's colour", async () => {
    composerHost = "fresh";
    await render("Zed");
    const initial = [...host.querySelectorAll<HTMLElement>("span")].find((s) => s.textContent === "Z" && s.className.includes("trim-cap"));
    expect(initial, "an initial avatar even though no list exists").toBeTruthy();
    expect(loaded).toContain("fresh"); // the composer host's list was asked for, not the focus host's
    expect(loaded).not.toContain("focus");
  });

  it("no profile name: no avatar", async () => {
    await render(null);
    expect([...host.querySelectorAll<HTMLElement>("span")].some((s) => s.className.includes("trim-cap") && s.textContent !== "composer.quota.noProfile" && s.parentElement?.style.background)).toBe(false);
  });

  it("no 同一账号也在用 in the input area: neither on the chip nor in its popover (owner 2026-10-25)", async () => {
    await render("Ceobe");
    expect(host.querySelector("[data-profile-account-link]")).toBeNull();
    expect(host.textContent).not.toContain("+host02");
    const trigger = [...host.querySelectorAll<HTMLElement>("button")].find((b) => (b.title ?? "").includes("composer.quota.title"))!;
    await act(async () => trigger.click());
    expect(document.body.textContent).toContain("composer.quota.title");
    expect(document.querySelector("[data-profile-account-link]")).toBeNull();
  });
});
