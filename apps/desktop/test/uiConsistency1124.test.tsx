// @vitest-environment jsdom
// UI consistency audit 2026-11-24 (.claude/reports/audit-20261124-ui.md) #1, #2, #4, #5:
// 1. every permanent delete of an agent (agent menu, 设置 → 归档, Profile references one / all) uses the same
//    high-risk dialog that states the consequences (batch: count, scope, names); 取消 has the focus, Enter alone
//    does not confirm.
// 2. modifier + click hints read 「Ctrl + 左键点击」 everywhere (one plus).
// 4. 全部智能体's 下线 button says it opens the picker.
// 5. row-end ⋯ buttons share one look / tip / menu affordance; Linux drawn window buttons have names.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fx = vi.hoisted(() => ({
  asks: [] as { message: string; ok: string }[],
  answers: [] as boolean[],
  deleteResult: vi.fn(async () => ({ ok: true })),
  control: vi.fn(),
}));
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  apiFor: () => ({}),
  bridge: { window: { nativeControls: null, control: (...a: unknown[]) => fx.control(...a) } },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/lib/targetHost", async (orig) => ({
  ...(await orig<object>()),
  useTargetFeatures: () => new Set(["session-delete"]),
  useTargetHostId: () => "local",
  useTargetSelect: () => () => {},
  useTargetSidebar: () => null,
}));
vi.mock("../src/renderer/src/lib/menus", async (orig) => ({
  ...(await orig<object>()),
  deleteAgentResult: (...a: unknown[]) => fx.deleteResult(...(a as [])),
}));

const SRC = join(__dirname, "../src/renderer/src");
const source = (path: string) => readFileSync(join(SRC, path), "utf8");

const { confirmDialog, confirmPermanentDelete, closeDialog } = await import("../src/renderer/src/lib/contextMenu");
const contextMenu = await import("../src/renderer/src/lib/contextMenu");
const { Overlays } = await import("../src/renderer/src/components/Overlays");
const { I18nProvider, translate } = await import("../src/renderer/src/i18n");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");
const { newInstanceKey } = await import("../src/renderer/src/lib/openModifiers");
const { RowMoreButton } = await import("../src/renderer/src/components/RowMoreButton");
const { LinuxControls } = await import("../src/renderer/src/components/WindowControls");
const { ProfileInUse } = await import("../src/renderer/src/components/settings/ProfileInUse");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fx.asks = [];
  fx.answers = [];
  fx.deleteResult.mockClear();
});
afterEach(() => {
  act(() => {
    closeDialog();
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});
const render = (node: React.ReactNode) => act(() => root.render(h(I18nProvider, null, node)));
const key = (k: string) => act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
const settle = async () => { for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); }); };

describe("#1 permanent delete: one high-risk dialog", () => {
  it("取消 has the focus, Enter alone does not confirm; the delete button names the action", async () => {
    render(h(Overlays));
    let answer: boolean | null = null;
    act(() => void confirmPermanentDelete("永久删除 A？对话和 cutex 中的记录都会删除，不能恢复。", { ok: "永久删除", cancel: "取消" }).then((ok) => (answer = ok)));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("不能恢复");
    expect(document.activeElement?.hasAttribute("data-dialog-cancel")).toBe(true);
    const ok = dialog.querySelector<HTMLButtonElement>("[data-dialog-ok]")!;
    expect(ok.textContent).toBe("永久删除");
    expect(ok.className).toContain("bg-danger-solid");
    key("Enter");
    await settle();
    expect(answer).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => ok.click());
    await settle();
    expect(answer).toBe(true);
  });

  it("other confirmations keep their keyboard (OK focused, Enter confirms)", async () => {
    render(h(Overlays));
    let answer: boolean | null = null;
    act(() => void confirmDialog("Archive?", true).then((ok) => (answer = ok)));
    expect(document.activeElement?.hasAttribute("data-dialog-ok")).toBe(true);
    key("Enter");
    await settle();
    expect(answer).toBe(true);
  });

  it("every agent delete goes through it: agent menu, 设置 → 归档, Profile references (one and all)", () => {
    const menus = source("lib/menus.tsx");
    expect(menus).toMatch(/export async function deleteAgent\([\s\S]*?confirmPermanentDelete\(t\(busy \? "menu\.deleteConfirmBusy" : "menu\.deleteConfirm"/);
    const archive = source("components/settings/AppSettings.tsx");
    const row = archive.slice(archive.indexOf("function ArchivedRow"), archive.indexOf("export function ArchiveBehaviour"));
    expect(row).toContain("deleteAgent(session, t, hostId)");
    expect(row).not.toMatch(/ArmedRemove|deleteAgentNow/);
    expect(row).toContain("<Trash2");
    const refs = source("components/settings/ProfileInUse.tsx");
    expect(refs).not.toMatch(/ArmedRemove|deleteArchivedArmed|"settings\.profile\.refs\.deleteArmed"/);
    // The menu row says what it is, like the other entries.
    expect(zhCN["menu.delete"]).toBe("永久删除");
    expect(zhCN["settings.profile.refs.delete"]).toBe("永久删除");
  });

  it("Profile references: one row and the batch ask first; the batch states count, Profile and names", async () => {
    vi.spyOn(contextMenu, "confirmPermanentDelete").mockImplementation(async (message, labels) => {
      fx.asks.push({ message, ok: labels.ok });
      return fx.answers.shift() ?? false;
    });
    const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta"];
    const refusal = { code: "profile_in_use", message: "in use", sessions: names.map((n, i) => ({ cutexSessionId: `a${i}`, displayName: n, lifecycle: "retired" as const })) };
    render(h(ProfileInUse, { refusal: refusal as never, profile: "relay", onDeleteProfile: async () => {} }));
    const trash = [...host.querySelectorAll<HTMLButtonElement>(`button[aria-label="${translate("settings.profile.refs.delete")}"]`)];
    expect(trash).toHaveLength(7);
    // One row: cancelled → nothing deleted; confirmed → that agent.
    await act(async () => trash[0]!.click());
    await settle();
    expect(fx.asks[0]!.message).toBe(translate("menu.deleteConfirm", { name: "Alpha" }));
    expect(fx.asks[0]!.ok).toBe(translate("menu.delete"));
    expect(fx.deleteResult).not.toHaveBeenCalled();
    fx.answers = [true];
    await act(async () => trash[0]!.click());
    await settle();
    expect(fx.deleteResult).toHaveBeenCalledTimes(1);
    expect((fx.deleteResult.mock.calls[0] as unknown[])[0]).toMatchObject({ cutexSessionId: "a0" });
    // All: one dialog with the count, the Profile and the names (5, then 「等，另有 N 个」).
    const bulk = [...host.querySelectorAll("button")].find((b) => b.textContent === translate("settings.profile.refs.deleteArchived", { n: 6 }))!;
    expect(bulk).toBeDefined();
    fx.answers = [true];
    await act(async () => bulk.click());
    await settle();
    const ask = fx.asks.at(-1)!;
    const shown = translate("settings.profile.refs.nameSep");
    expect(ask.message).toBe(translate("settings.profile.refs.deleteArchivedConfirm", { n: 6, profile: "relay", names: ["Beta", "Delta", "Epsilon", "Eta", "Gamma"].join(shown) + translate("settings.profile.refs.namesMore", { n: 1 }) }));
    expect(ask.ok).toBe(translate("settings.profile.refs.deleteArchivedOk", { n: 6 }));
    expect(fx.deleteResult).toHaveBeenCalledTimes(7);
  });
});

describe("#2 modifier + click: one way to write it", () => {
  it("the key is the bare modifier; every hint that takes it writes the separator itself", () => {
    expect(newInstanceKey(false)).toBe("Ctrl");
    expect(newInstanceKey(true)).toBe("⌘");
    for (const k of ["pane.openBesideHint", "side.launcherNewHint", "tray.besideTip"] as const) {
      expect(translate(k, { key: newInstanceKey(false), name: "X" })).toMatch(/Ctrl \+ /);
      expect(translate(k, { key: newInstanceKey(false), name: "X" })).not.toMatch(/\+\s*\+/);
    }
    // Every caller passes newInstanceKey(): no hand-written navigator check or trailing plus left.
    expect(source("components/ChipTray.tsx")).toContain(`t("tray.besideTip", { key: newInstanceKey() })`);
    expect(source("lib/workspaceEffects.ts")).toContain("const besideKey = (): string => newInstanceKey();");
    expect(source("lib/panelGuides.ts")).toContain("mod: newInstanceKey(),");
  });
});

describe("#4 下线空闲的: the list button says it opens the picker", () => {
  it("named like the project menu's 选择…", () => {
    expect(zhCN["stopIdle.button"]).toBe("选择要下线的空闲{{agent}}…");
    expect(en["stopIdle.button"]).toBe("Choose idle {{agents}} to take offline…");
    expect(zhCN["stopIdle.review"].startsWith("选择")).toBe(true);
  });
});

describe("#5 row-end ⋯ and window buttons", () => {
  it("RowMoreButton: name, the app's tip, menu affordance, focus ring", () => {
    const open = vi.fn();
    render(h(RowMoreButton, { label: "更多操作", onOpen: open, "data-copy-more": "" }));
    const b = host.querySelector("button")!;
    expect(b.getAttribute("aria-label")).toBe("更多操作");
    expect(b.getAttribute("data-tip")).toBe("更多操作");
    expect(b.getAttribute("aria-haspopup")).toBe("menu");
    expect(b.hasAttribute("title")).toBe(false);
    expect(b.className).toMatch(/press-icon/);
    expect(b.className).toMatch(/reveal-focus/);
    expect(b.hasAttribute("data-copy-more")).toBe(true);
    act(() => b.click());
    expect(open).toHaveBeenCalledOnce();
  });

  it("服务, 作业 and 远程副本 use it (no hand-made ⋯)", () => {
    for (const f of ["modules/services/ServicesPage.tsx", "modules/jobs/JobsPage.tsx", "modules/remote-copies/CopyPage.tsx"]) {
      const s = source(f);
      expect(s, f).toContain("<RowMoreButton");
      expect(s, f).not.toContain("MoreHorizontal");
    }
  });

  it("Linux drawn window buttons have names and tips, and act", () => {
    render(h(LinuxControls, {}));
    const labels = [...host.querySelectorAll("button")].map((b) => [b.getAttribute("aria-label"), b.getAttribute("data-tip")]);
    expect(labels).toEqual(["window.minimize", "window.maximize", "window.close"].map((k) => [translate(k as never), translate(k as never)]));
    act(() => host.querySelectorAll("button")[2]!.click());
    expect(fx.control).toHaveBeenCalledWith("close", undefined);
  });
});
