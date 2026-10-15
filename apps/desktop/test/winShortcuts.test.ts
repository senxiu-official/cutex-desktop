import { describe, expect, it } from "vitest";
import { installLayout, type InstallLayout } from "../src/shared/update";
import { APP_USER_MODEL_ID, appUserModelId, launcherSpec, shortcutNeedsUpdate, startMenuShortcutPath, targetsInstall, taskbarPinDir } from "../src/shared/winShortcuts";

const layout = installLayout("D:\\Apps\\cutex-desktop-app\\releases\\7422695\\cutex.exe", "\\") as InstallLayout;

describe("appUserModelId", () => {
  it("keeps dev runs apart from the installed app", () => {
    expect(appUserModelId(true)).toBe(APP_USER_MODEL_ID);
    expect(appUserModelId(false)).not.toBe(APP_USER_MODEL_ID);
  });
});

describe("launcherSpec", () => {
  it("points through the current link, not the running release", () => {
    expect(launcherSpec(layout)).toEqual({
      target: "D:\\Apps\\cutex-desktop-app\\current\\cutex.exe",
      cwd: "D:\\Apps\\cutex-desktop-app\\current",
      icon: "D:\\Apps\\cutex-desktop-app\\current\\resources\\app\\resources\\icons\\icon.ico",
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
      description: "Cutex",
    });
  });

  it("derives shortcut locations from %APPDATA%", () => {
    const appData = "C:\\Users\\u\\AppData\\Roaming";
    expect(startMenuShortcutPath(appData)).toBe(`${appData}\\Microsoft\\Windows\\Start Menu\\Programs\\Cutex.lnk`);
    expect(taskbarPinDir(appData)).toBe(`${appData}\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar`);
  });
});

describe("targetsInstall", () => {
  it("accepts current and release executables of this install, case-insensitively", () => {
    expect(targetsInstall("d:\\apps\\cutex-desktop-app\\CURRENT\\cutex.exe", layout)).toBe(true);
    expect(targetsInstall("D:/Apps/cutex-desktop-app/releases/c20812e/cutex.exe", layout)).toBe(true);
    expect(targetsInstall('"D:\\Apps\\cutex-desktop-app\\releases\\c20812e-2\\cutex.exe"', layout)).toBe(true);
  });

  it("rejects other installs and other executables", () => {
    expect(targetsInstall(undefined, layout)).toBe(false);
    expect(targetsInstall("D:\\Other\\current\\cutex.exe", layout)).toBe(false);
    expect(targetsInstall("D:\\Apps\\cutex\\bin\\cutex.exe", layout)).toBe(false);
    expect(targetsInstall("D:\\Apps\\cutex-desktop-app\\releases\\c20812e\\sub\\cutex.exe", layout)).toBe(false);
    expect(targetsInstall("D:\\Apps\\cutex-desktop-app\\current\\other.exe", layout)).toBe(false);
  });
});

describe("shortcutNeedsUpdate", () => {
  const spec = launcherSpec(layout);
  it("is idempotent for an up-to-date shortcut", () => {
    expect(shortcutNeedsUpdate({ ...spec, target: spec.target.toUpperCase() }, spec)).toBe(false);
  });

  it("flags missing shortcuts, other targets and a missing AUMID", () => {
    expect(shortcutNeedsUpdate(null, spec)).toBe(true);
    expect(shortcutNeedsUpdate({ ...spec, target: "D:\\Apps\\cutex-desktop-app\\releases\\7422695\\cutex.exe" }, spec)).toBe(true);
    expect(shortcutNeedsUpdate({ ...spec, appUserModelId: undefined }, spec)).toBe(true);
    expect(shortcutNeedsUpdate({ ...spec, icon: undefined }, spec)).toBe(true);
  });
});
