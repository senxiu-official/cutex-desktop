import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { currentDoc, renderDoc } from "../scripts/generate-docs.mjs";

const slotsSource = readFileSync(new URL("../src/slots.ts", import.meta.url), "utf8");
const slotIds = [...slotsSource.slice(slotsSource.indexOf("export interface SlotMap")).matchAll(/^ {2}"([a-zA-Z.]+)":/gm)].map((m) => m[1]!);

it("has its generated sections up to date (node scripts/generate-docs.mjs)", () => {
  expect(currentDoc()).toBe(renderDoc());
});

it("catalogues every stable slot, with its default from the app", () => {
  const doc = currentDoc();
  expect(slotIds.length).toBeGreaterThan(5);
  for (const id of slotIds) {
    expect(slotsSource, id).toContain(`/** @slot ${id} `);
    expect(doc, id).toMatch(new RegExp(`### \`${id.replace(".", "\\.")}\`[\\s\\S]*?it is \`(hide|disable|notice)\``));
  }
});

it("documents the commands the tool has and only those", () => {
  const usage = readFileSync(new URL("../bin/cutex-module.mjs", import.meta.url), "utf8");
  const doc = currentDoc();
  for (const command of ["new", "build", "dev", "pack"]) {
    expect(usage).toContain(`case "${command}"`);
    expect(doc).toContain(`cutex-module ${command}`);
  }
});
