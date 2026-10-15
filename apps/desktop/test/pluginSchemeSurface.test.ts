// Acceptance §4: the parent page frames only plugin documents; the plugin scheme is not a fetch target.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

it("renderer CSP allows only cutex-plugin: frames", () => {
  const csp = /content="([^"]+)"/.exec(read("src/renderer/index.html"))![1]!;
  expect(csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("frame-src"))).toBe("frame-src cutex-plugin:");
});

it("cutex-plugin: is registered without Fetch API support", () => {
  const line = read("src/main/index.ts").split("\n").find((text) => text.includes("registerSchemesAsPrivileged"))!;
  expect(line).toContain("standard: true, secure: true");
  expect(line).not.toContain("supportFetchAPI");
  expect(line).not.toContain("bypassCSP");
});
