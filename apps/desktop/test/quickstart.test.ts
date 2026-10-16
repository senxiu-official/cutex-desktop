import { describe, expect, it } from "vitest";
import { packageRootOf, QUICKSTART_URL, quickstartRoots, resolveQuickstart } from "../src/shared/quickstart";

const posixJoin = (...parts: string[]) => parts.join("/");
const winJoin = (...parts: string[]) => parts.join("\\");

describe("quickstart", () => {
  it("finds the package root around resources/app", () => {
    expect(packageRootOf("/home/u/Applications/cutex-desktop/releases/0.1.1/resources/app")).toBe("/home/u/Applications/cutex-desktop/releases/0.1.1");
    expect(packageRootOf("C:\\Users\\u\\AppData\\Local\\Programs\\cutex-desktop-app\\releases\\0.1.1\\resources\\app")).toBe("C:\\Users\\u\\AppData\\Local\\Programs\\cutex-desktop-app\\releases\\0.1.1");
    expect(packageRootOf("/Users/u/Applications/cutex-desktop/releases/0.1.1.noindex/Cutex.app/Contents/Resources/app")).toBe("/Users/u/Applications/cutex-desktop/releases/0.1.1.noindex");
    expect(packageRootOf("/opt/elsewhere/app.asar")).toBeNull();
  });

  it("orders source checkout, release dir, package root; dev runs use the repository", () => {
    expect(quickstartRoots({ sourceDir: "/b/src", releaseDir: "/b/releases/abc", appPath: "/b/releases/abc/resources/app", packaged: true })).toEqual(["/b/src", "/b/releases/abc"]);
    expect(quickstartRoots({ sourceDir: null, releaseDir: null, appPath: "/repo/apps/desktop", packaged: false })).toEqual(["/repo"]);
  });

  it("opens the bundled copy of a release package", () => {
    const appPath = "/b/releases/0.1.1/resources/app";
    const target = resolveQuickstart({ sourceDir: null, releaseDir: null, appPath, packaged: true }, (p) => p === "/b/releases/0.1.1/docs/QUICKSTART.md", posixJoin);
    expect(target).toEqual({ kind: "file", path: "/b/releases/0.1.1/docs/QUICKSTART.md" });
    const win = resolveQuickstart({ sourceDir: null, releaseDir: "C:\\b\\releases\\0.1.1", appPath: "C:\\b\\releases\\0.1.1\\resources\\app", packaged: true }, (p) => p.endsWith("QUICKSTART.md"), winJoin);
    expect(win).toEqual({ kind: "file", path: "C:\\b\\releases\\0.1.1\\docs\\QUICKSTART.md" });
  });

  it("falls back to the published page only on a packaged app", () => {
    expect(resolveQuickstart({ sourceDir: null, releaseDir: null, appPath: "/Applications/Cutex.app/Contents/Resources/app", packaged: true }, () => false, posixJoin)).toEqual({ kind: "url", url: QUICKSTART_URL });
    expect(resolveQuickstart({ sourceDir: null, releaseDir: null, appPath: "/repo/apps/desktop", packaged: false }, () => false, posixJoin)).toBeNull();
    expect(QUICKSTART_URL).toMatch(/^https:\/\/github\.com\/.+\/blob\/release\/docs\/QUICKSTART\.md$/);
  });
});
