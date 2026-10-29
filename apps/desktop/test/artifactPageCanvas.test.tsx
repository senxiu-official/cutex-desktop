// @vitest-environment jsdom
// An HTML artifact is our page (owner 2026-10-23): its frame takes the app's light / dark, with that scheme's Canvas
// behind it. A page that follows the scheme shows its own colours; a light-only page differs from a dark frame, so
// Chromium paints its own white canvas — never dark on dark, never white on white (Electron repro:
// docs/research/browser-canvas-repro/frame.js).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({
  bridge: { frames: { prepareArtifactPage: async () => ({ ok: true, frame: { id: "f1", url: "about:blank" } }), release: async () => {}, page: async () => ({}) } },
  api: {},
  onEvent: () => () => {},
}));
vi.mock("../src/renderer/src/modules/artifacts/pageBroker", () => ({ attachPageBroker: () => () => {}, frameGestureActive: () => false }));
const { PageFrame } = await import("../src/renderer/src/modules/artifacts/PageFrame");
const { I18nProvider } = await import("../src/renderer/src/i18n");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("the artifact page frame takes the app's light / dark, on its own Canvas, and follows a theme change", async () => {
  document.documentElement.dataset.theme = "dark";
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(h(I18nProvider, null, h(PageFrame, { hostId: "local", artifactId: "a", version: 1, title: "t" }))));
  await vi.waitFor(() => expect(host.querySelector("iframe")).not.toBeNull());
  const frame = host.querySelector("iframe")!;
  expect(frame.style.colorScheme).toBe("dark");
  expect(frame.style.background).toMatch(/canvas/i);
  expect(frame.className).not.toContain("bg-white");
  document.documentElement.dataset.theme = "light";
  await vi.waitFor(() => expect(frame.style.colorScheme).toBe("light"));
  act(() => root.unmount());
  delete document.documentElement.dataset.theme;
});
