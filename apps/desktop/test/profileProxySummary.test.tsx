// @vitest-environment jsdom
// r243 acceptance 5: the Profile overview card shows the proxy mode, the address cutex keeps (under
// 不使用代理 the remembered one) and what is in effect.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PROFILE_PROXY_FEATURE, type ProfileProxyView } from "../src/shared/proxy";
import type { ProfileDetail } from "../src/shared/ipc";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTargetFeatures: () => new Set([PROFILE_PROXY_FEATURE]),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { ProfileProxySummary } = await import("../src/renderer/src/components/settings/ProfileProxy");

const view = (v: Partial<ProfileProxyView>): ProfileProxyView => ({
  mode: "inherit", url: null, urlHasCredentials: false, noProxy: null, editable: true,
  effective: { mode: "system", url: null, source: null }, ...v,
});
const text = (proxy: ProfileProxyView | undefined) => {
  const div = document.createElement("div");
  const root = createRoot(div);
  act(() => root.render(h(ProfileProxySummary, { detail: { id: "p1", name: "p1", proxy } as unknown as ProfileDetail })));
  const out = div.textContent;
  act(() => root.unmount());
  return out;
};

it("shows mode, remembered address and effect", () => {
  expect(text(view({ mode: "none", url: "http://127.0.0.1:18080/", effective: { mode: "none", url: null, source: null } })))
    .toBe("proxy.profile.titleproxy.mode.none · proxy.profile.remembered(http://127.0.0.1:18080/) · proxy.profile.effective(proxy.profile.effectiveNone)");
  expect(text(view({ mode: "manual", url: "http://127.0.0.1:18080/", effective: { mode: "manual", url: "http://127.0.0.1:18080/", source: "manual" } })))
    .toBe("proxy.profile.titleproxy.mode.manual · http://127.0.0.1:18080/");
  expect(text(view({}))).toBe("proxy.profile.titleproxy.mode.inherit · proxy.profile.effective(proxy.profile.effectiveSystemNone)");
  expect(text(undefined)).toBe("");
});
