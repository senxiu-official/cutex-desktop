import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ module: true, display: true }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en" }) }));
vi.mock("../src/renderer/src/lib/terms", () => ({
  useTermOverrides: () => ({}),
  resolveTerms: () => ({ owner: { one: "owner" } }),
}));
vi.mock("../src/renderer/src/modules/react", () => ({ useModuleEnabled: () => state.module }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ timelineIntro: state.display }) }));
vi.mock("../src/renderer/src/lib/providerGreetings", () => ({ providerGreetings: () => ["Provider welcome, {name}"] }));
vi.mock("../src/renderer/src/lib/launchArt", () => ({ useLaunchArtView: () => ({ art: {}, imported: {}, ready: true }) }));
vi.mock("../src/renderer/src/components/LaunchPortraits", () => ({ LaunchPortraits: () => null }));

import { LaunchIntro } from "../src/renderer/src/components/LaunchPage";

beforeEach(() => { state.module = true; state.display = true; });

it.each([
  { module: false, display: true },
  { module: true, display: false },
  { module: false, display: false },
])("uses the plain icon and page title when opening is disabled: %j", (flags) => {
  Object.assign(state, flags);
  for (const title of ["New agent", "Quick launch"]) {
    for (const greeting of [undefined, { messages: "Custom welcome, {name}" }]) {
      const html = renderToStaticMarkup(createElement(LaunchIntro, {
        icon: "icon", title, hint: "Page help", provider: "codex", greeting,
        // Off must also work before profiles have loaded.
        portraits: { profiles: null, selected: false, disabled: false, onSelect: () => {} },
      }));
      expect(html).toContain("launch-intro-icon");
      expect(html).toContain(`title="${title}">${title}</h1>`);
      expect(html).toContain("Page help");
      expect(html).not.toContain("welcome");
      expect(html).not.toContain("launch-intro-title-long");
      expect(html).not.toContain("launch-intro-with-art");
      expect(html).not.toContain("launch-art-greeting");
    }
  }
});

it("retains provider and custom greetings with opening enabled even without installed art", () => {
  const props = { icon: "icon", title: "New agent", hint: "Page help", provider: "codex" as const };
  expect(renderToStaticMarkup(createElement(LaunchIntro, props))).toContain("Provider welcome, owner");
  expect(renderToStaticMarkup(createElement(LaunchIntro, { ...props, greeting: { messages: "Custom welcome, {name}" } }))).toContain("Custom welcome, owner");
});
