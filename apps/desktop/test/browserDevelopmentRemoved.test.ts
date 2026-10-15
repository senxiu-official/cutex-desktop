import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
describe("removed product development MCP boundary", () => {
  it.each(["development.ts", "devBridge.ts", "devBridgeFiles.ts", "devAdapter.ts"])("has no buildable %s entry", name => {
    expect(existsSync(path("../src/main/browser/" + name))).toBe(false);
  });
  it("install has neither a discovery flag branch nor a public provider getter", () => {
    const source = readFileSync(path("../src/main/browser/install.ts"), "utf8");
    expect(source).not.toMatch(/CUTEX_DESKTOP_BROWSER_DEV_MCP|startBrowserDevelopment|developmentProvider|getBrowserDevelopmentProvider|devBridge/);
    expect(source).toContain("createBrowserModelAdapter");
    expect(source).toContain("BrowserRelay");
  });
  it("preload and typed renderer contract cannot request the removed grant", () => {
    for (const file of ["../src/preload/browser.ts", "../src/shared/browser.ts", "../src/main/browser/channel.ts"]) {
      const source = readFileSync(path(file), "utf8");
      expect(source).not.toMatch(/development-mcp|op:\s*["']grant["']|case\s+["']grant["']|\bgrant\s*:/);
    }
    expect(existsSync(path("../src/renderer/src/modules/browser/controlActions.ts"))).toBe(false);
  });
});
