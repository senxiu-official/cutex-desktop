// syncShortcutsIn (main/winShortcuts.ts) against a temp folder standing in for %APPDATA% and the desktop: the
// 外观 → 应用图标 style reaches the Start-menu, desktop and pinned shortcuts that launch this install, and nothing else.
// The fake ShortcutIo keeps each "shortcut" as JSON so the test runs on every OS without touching real .lnk files.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLayout, type InstallLayout } from "../src/shared/update";
import { launcherSpec, startMenuShortcutPath, taskbarPinDir, type ShortcutSpec } from "../src/shared/winShortcuts";

vi.mock("electron", () => ({ app: {}, shell: {} }));
vi.mock("../src/main/errorLog", () => ({ logError: () => {}, errorFields: (e: unknown) => ({ message: String(e) }) }));
vi.mock("../src/main/updater", () => ({ realExecPath: () => "" }));

const { syncShortcutsIn } = await import("../src/main/winShortcuts");

const layout = installLayout("D:\\Apps\\cutex-desktop-app\\releases\\7422695\\cutex.exe", "\\") as InstallLayout;
const STYLE_ICO = "C:\\Users\\u\\AppData\\Roaming\\cutex-desktop\\app-icons\\butterflies-03.ico";

let root: string;
let writes: { path: string; mode: string }[];
const fsPath = (p: string) => p.replace(/\\/g, "/");

const io = {
  read: (p: string) => (existsSync(fsPath(p)) ? (JSON.parse(readFileSync(fsPath(p), "utf8")) as Partial<ShortcutSpec>) : null),
  write(p: string, mode: "create" | "update", spec: ShortcutSpec) {
    writes.push({ path: p, mode });
    if (mode === "update" && !existsSync(fsPath(p))) return false;
    mkdirSync(join(fsPath(p), ".."), { recursive: true });
    writeFileSync(fsPath(p), JSON.stringify(spec));
    return true;
  },
  links: (d: string) => (existsSync(fsPath(d)) ? readdirSync(fsPath(d)).filter((n) => n.toLowerCase().endsWith(".lnk")) : []),
  exists: (p: string) => existsSync(fsPath(p)),
  log: () => {},
};

function put(p: string, spec: Partial<ShortcutSpec>): void {
  mkdirSync(join(fsPath(p), ".."), { recursive: true });
  writeFileSync(fsPath(p), JSON.stringify(spec));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cutex-shortcuts-"));
  writes = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("syncShortcutsIn", () => {
  it("creates the Start-menu shortcut with the style's icon and never creates desktop shortcuts or pins", () => {
    const appData = `${root}\\AppData`;
    const desktop = `${root}\\Desktop`;
    const spec = launcherSpec(layout, STYLE_ICO);
    expect(syncShortcutsIn(io, { appData, desktop }, layout, spec)).toBe(1);
    expect(io.read(startMenuShortcutPath(appData))).toEqual(spec);
    expect(io.links(desktop)).toEqual([]);
    expect(io.links(taskbarPinDir(appData))).toEqual([]);
  });

  it("updates this install's desktop shortcuts and pins (any name), leaves other programs and installs alone", () => {
    const appData = `${root}\\AppData`;
    const desktop = `${root}\\Desktop`;
    const pins = taskbarPinDir(appData);
    const old = launcherSpec(layout);
    put(startMenuShortcutPath(appData), old);
    put(`${desktop}\\My Cutex.lnk`, { ...old, target: "D:\\Apps\\cutex-desktop-app\\releases\\c20812e\\cutex.exe" });
    put(`${pins}\\Cutex.lnk`, old);
    const foreign = { target: "C:\\Program Files\\Other\\other.exe", icon: "C:\\other.ico", iconIndex: 0 };
    const otherInstall = { ...old, target: "E:\\Elsewhere\\current\\cutex.exe" };
    put(`${desktop}\\Other.lnk`, foreign);
    put(`${pins}\\Cutex (2).lnk`, otherInstall);
    writeFileSync(join(fsPath(desktop), "notes.txt"), "x");

    const spec = launcherSpec(layout, STYLE_ICO);
    expect(syncShortcutsIn(io, { appData, desktop }, layout, spec)).toBe(3);
    expect(io.read(startMenuShortcutPath(appData))?.icon).toBe(STYLE_ICO);
    expect(io.read(`${desktop}\\My Cutex.lnk`)).toEqual(spec);
    expect(io.read(`${pins}\\Cutex.lnk`)?.icon).toBe(STYLE_ICO);
    expect(io.read(`${desktop}\\Other.lnk`)).toEqual(foreign);
    expect(io.read(`${pins}\\Cutex (2).lnk`)).toEqual(otherInstall);

    // Already in step: counted, not rewritten.
    writes = [];
    expect(syncShortcutsIn(io, { appData, desktop }, layout, spec)).toBe(3);
    expect(writes).toEqual([]);

    // Back to the classic logo.
    expect(syncShortcutsIn(io, { appData, desktop }, layout, launcherSpec(layout))).toBe(3);
    expect(io.read(`${pins}\\Cutex.lnk`)?.icon).toBe(old.icon);
  });

  it("never takes over a Start-menu Cutex.lnk of another install", () => {
    const appData = `${root}\\AppData`;
    const otherInstall = { ...launcherSpec(layout), target: "E:\\Elsewhere\\current\\cutex.exe" };
    put(startMenuShortcutPath(appData), otherInstall);
    expect(syncShortcutsIn(io, { appData, desktop: null }, layout, launcherSpec(layout, STYLE_ICO))).toBe(0);
    expect(io.read(startMenuShortcutPath(appData))).toEqual(otherInstall);
  });

  it("counts only shortcuts that were written", () => {
    const appData = `${root}\\AppData`;
    const failing = { ...io, write: () => false };
    expect(syncShortcutsIn(failing, { appData, desktop: null }, layout, launcherSpec(layout, STYLE_ICO))).toBe(0);
  });
});

describe("launcherSpec icon", () => {
  it("uses the style's .ico when given, the release's classic one otherwise", () => {
    expect(launcherSpec(layout, STYLE_ICO).icon).toBe(STYLE_ICO);
    expect(launcherSpec(layout).icon).toBe("D:\\Apps\\cutex-desktop-app\\current\\resources\\app\\resources\\icons\\icon.ico");
  });
});
