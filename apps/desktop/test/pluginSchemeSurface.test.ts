// Acceptance §4: the parent page frames only opaque frame documents (agent pages, HTML files); their scheme is not a fetch target.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

it("renderer CSP allows only cutex-plugin: frames", () => {
  const csp = /content="([^"]+)"/.exec(read("src/renderer/index.html"))![1]!;
  expect(csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("frame-src"))).toBe("frame-src cutex-plugin:");
});

it("cutex-plugin: is registered without Fetch API support", () => {
  const line = read("src/main/index.ts").split("\n").find((text) => text.includes("{ scheme: FRAME_SCHEME"))!;
  expect(line).toContain("standard: true, secure: true");
  expect(line).not.toContain("supportFetchAPI");
  expect(line).not.toContain("bypassCSP");
});

// §23.5: signed module packs — script / style only, CORS for module scripts, never fetch or a CSP bypass.
it("cutex-module: is registered without Fetch API support or CSP bypass, and the CSP adds it only for scripts and styles", () => {
  const main = read("src/main/index.ts");
  const registered = main.split("\n").filter((text) => /\{ scheme: [A-Z_]+, privileges/.test(text));
  expect(registered).toHaveLength(3);
  const line = registered.find((text) => text.includes("MODULE_PACK_SCHEME"))!;
  expect(line).toContain("standard: true, secure: true, corsEnabled: true");
  expect(line).not.toContain("supportFetchAPI");
  expect(line).not.toContain("bypassCSP");
  const csp = /content="([^"]+)"/.exec(read("src/renderer/index.html"))![1]!.split(";").map((part) => part.trim());
  expect(csp.filter((part) => part.includes("cutex-module:"))).toEqual(["script-src 'self' cutex-module:", "style-src 'self' 'unsafe-inline' cutex-module:"]);
});

// 中文字体包 (main/fontPack.ts): fonts only — CORS for the font loads, never fetch or a CSP bypass, CSP font-src only.
it("cutex-font: is registered without Fetch API support or CSP bypass, and the CSP adds it only for fonts", () => {
  const line = read("src/main/index.ts").split("\n").find((text) => text.includes("{ scheme: FONT_SCHEME"))!;
  expect(line).toContain("standard: true, secure: true, corsEnabled: true");
  expect(line).not.toContain("supportFetchAPI");
  expect(line).not.toContain("bypassCSP");
  for (const page of ["src/renderer/index.html", "src/renderer/owner-alert.html"]) {
    const csp = /content="([^"]+)"/.exec(read(page))![1]!.split(";").map((part) => part.trim());
    expect(csp.filter((part) => part.includes("cutex-font:"))).toEqual(["font-src 'self' cutex-font:"]);
  }
});
