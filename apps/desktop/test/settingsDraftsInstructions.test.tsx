// @vitest-environment jsdom
// Review 2026-11-18 (night-review): with the real 指令 page, edits typed while 保存并前往 was saving were lost — the entry
// went once the older text was saved. Typing while it saves now keeps Settings open with the newer text (lib/settingsDrafts).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ api: {} as Record<string, unknown> }));
vi.mock("../src/renderer/src/bridge", () => ({ api: env.api, apiFor: () => env.api, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ locale: "en", t: (s: string) => s }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (original) => ({ ...(await original<object>()), useTargetApi: () => env.api, useTargetFeatures: () => new Set(), useTargetHostId: () => "local" }));
const { InstructionsPage } = await import("../src/renderer/src/components/settings/GlobalSettings");
const { useSettingsShelf, openSettingsShelf, setSettingsShelfMaximized, resetSettingsShelfForTest } = await import("../src/renderer/src/lib/settingsShelf");
const { useOverlayState, runAction, closeMenu } = await import("../src/renderer/src/lib/contextMenu");
const { runBarEntry } = await import("../src/renderer/src/lib/navEntries");
const { resetSettingsDrafts, hasSettingsDrafts } = await import("../src/renderer/src/lib/settingsDrafts");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
let menu: ReturnType<typeof useOverlayState>["menu"] = null;
function Shelf() {
  const open = useSettingsShelf((s) => s.open);
  menu = useOverlayState().menu;
  return open ? h(InstructionsPage) : null;
}
const type = (value: string) =>
  act(() => {
    const e = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(e, value);
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
async function start() {
  let finish!: (doc: unknown) => void;
  const pending = new Promise((resolve) => (finish = resolve));
  env.api.userInstructions = async () => ({ content: "saved", revision: "r1", path: "review" });
  env.api.putUserInstructions = vi.fn(() => pending);
  resetSettingsDrafts();
  resetSettingsShelfForTest();
  openSettingsShelf({ tab: "instructions" as never });
  setSettingsShelfMaximized(true);
  await act(async () => root.render(h(Shelf)));
  type("first edit");
  const go = vi.fn();
  act(() => runBarEntry({ id: "review", target: { run: go } } as never));
  const save = menu!.items[1];
  if (!save || save === "separator") throw new Error("no save row");
  let action!: Promise<void>;
  await act(async () => {
    action = runAction(save);
    await Promise.resolve();
  });
  return { go, finish: (doc: unknown) => act(async () => { finish(doc); await action; }) };
}
afterEach(() => act(() => { root.render(null); closeMenu(); resetSettingsShelfForTest(); resetSettingsDrafts(); }));

it("typing while 保存并前往 saves: the older text is saved, Settings stays open with the newer one", async () => {
  const { go, finish } = await start();
  type("second edit while saving");
  expect(hasSettingsDrafts()).toBe(true);
  await finish({ content: "first edit", revision: "r2", path: "review" });
  expect(env.api.putUserInstructions).toHaveBeenCalledExactlyOnceWith("first edit", "r1");
  expect(go).not.toHaveBeenCalled();
  expect(useSettingsShelf.getState().open).toBe(true);
  expect(host.querySelector("textarea")!.value).toBe("second edit while saving");
});

it("nothing typed meanwhile: saved, Settings closes, the entry runs", async () => {
  const { go, finish } = await start();
  await finish({ content: "first edit", revision: "r2", path: "review" });
  expect(go).toHaveBeenCalledTimes(1);
  expect(useSettingsShelf.getState().open).toBe(false);
});
