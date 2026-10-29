// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ menus: vi.fn(() => []), loaded: false }));
vi.mock("../src/renderer/src/lib/fileActions", () => ({ fileActions: fx.menus }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/terms", () => ({ useTermOverrides: () => ({}), resolveTerms: () => ({ owner: { one: "owner" } }) }));
vi.mock("../src/renderer/src/modules/react", () => ({ useModuleEnabled: () => true }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ timelineIntro: true }) }));
vi.mock("../src/renderer/src/lib/providerGreetings", () => ({ providerGreetings: () => [] }));
vi.mock("../src/renderer/src/lib/launchArt", () => ({ useLaunchArtView: () => ({ art: {}, imported: {}, ready: true }) }));
vi.mock("../src/renderer/src/components/LaunchPortraits", () => ({ LaunchPortraits: () => null }));
vi.mock("../src/renderer/src/lib/fileThumbnails", () => ({ useThumbnail: () => ({ ref: () => {}, state: fx.loaded ? { status: "ok", src: "data:image/png;base64,YQ==" } : { status: "error" } }) }));
vi.mock("../src/renderer/src/lib/historyMedia", () => ({ parseMediaRef: () => null, useMediaAuthority: () => "", captureMediaAuthority: () => () => true }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (s: object) => unknown) => select({}), featuresOf: () => new Set(), hostApi: () => ({}) }));
const { MessageImages } = await import("../src/renderer/src/components/ImageThumbs");
const { LaunchAttachments } = await import("../src/renderer/src/components/LaunchPage");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { fx.menus.mockClear(); fx.loaded = false; element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); });

it.each([false, true])("message attachment %s keeps the file's own host even when its thumbnail is unavailable", async (loaded) => {
  fx.loaded = loaded;
  act(() => root.render(h(MessageImages, { hostId: "ssh", images: [{ kind: "path", path: "/same-as-local/image.png" }] })));
  const target = element.querySelector(loaded ? "button" : '[data-testid="message-image-chip"]')!;
  act(() => target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(fx.menus).toHaveBeenCalledWith({ hostId: "ssh", path: "/same-as-local/image.png" }, expect.any(Function));
});

it("draft launcher attachments carry the selected remote host rather than assuming the picker path is local", async () => {
  act(() => root.render(h(LaunchAttachments, { hostId: "ssh", images: [{ id: "picked", name: "image.png", preview: "", source: { kind: "path", path: "/remote-upload/image.png" } }], onRemove: () => {} })));
  await act(async () => { element.querySelector('[title="image.png"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  expect(fx.menus).toHaveBeenCalledWith({ hostId: "ssh", path: "/remote-upload/image.png", knownLocal: undefined }, expect.any(Function));
});

it("picker-proven local files retain their local provenance in a remote launcher", async () => {
  act(() => root.render(h(LaunchAttachments, { hostId: "ssh", images: [{ id: "picked", name: "local.png", preview: "", pickedLocally: true, source: { kind: "path", path: "C:/Picked/local.png" } }], onRemove: () => {} })));
  await act(async () => { element.querySelector('[title="local.png"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  expect(fx.menus).toHaveBeenCalledWith({ hostId: "local", path: "C:/Picked/local.png", knownLocal: true }, expect.any(Function));
});
