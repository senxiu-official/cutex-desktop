import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MODULE_API_VERSION } from "../../plugin-sdk/src/index";
import { currentVersion, emitReport, reportPath } from "../scripts/api-report.mjs";
import { generated, generatedPaths } from "../scripts/generate-host.mjs";

const read = (path: string | URL) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

it("keeps one version with the app: the package's major.minor is MODULE_API_VERSION", () => {
  expect(currentVersion()).toBe(MODULE_API_VERSION);
});

it("matches the reviewed API report of this version", { timeout: 60_000 }, () => {
  expect(emitReport()).toBe(read(reportPath()));
});

it("has its generated files up to date (node scripts/generate-host.mjs)", () => {
  const { exportsJson, table } = generated();
  expect(read(generatedPaths.exportsJson)).toBe(exportsJson);
  expect(read(generatedPaths.table)).toBe(table);
});

it("lists the stable, the UI and the experimental entries", () => {
  const entries = JSON.parse(generated().exportsJson).entries as Record<string, string[]>;
  expect(Object.keys(entries)).toEqual(["@cutex-desktop/module-api", "@cutex-desktop/module-api/ui", "@cutex-desktop/module-api/experimental"]);
  expect(entries["@cutex-desktop/module-api"]).toContain("defineModule");
  expect(entries["@cutex-desktop/module-api/ui"]).toEqual(expect.arrayContaining(["Page", "SettingRow", "Button", "openMenu", "StatusIcon", "HostPicker"]));
  // The daemon stays out of the stable part: a module has to ask for it by importing the entry that says it may break.
  expect(entries["@cutex-desktop/module-api"]).not.toContain("daemonFor");
  expect(entries["@cutex-desktop/module-api/experimental"]).toContain("daemonFor");
});

it("imports nothing but React types", () => {
  for (const file of ["index", "types", "slots", "services", "ui", "experimental"]) {
    const text = read(new URL(`../src/${file}.ts`, import.meta.url));
    for (const m of text.matchAll(/\bfrom\s+"([^"]+)"/g)) expect([m[1], m[1]!.startsWith("./") || m[1] === "react"]).toEqual([m[1], true]);
  }
});
