#!/usr/bin/env node
// Regenerates src/renderer/src/modules/about/changelog.bundled.json from the repository's CHANGELOG.md
// (Settings → 关于 → 更新记录; parser and format: src/shared/changelog.ts). Run after editing a released
// section or cutting a release:  node apps/desktop/scripts/bundle-changelog.mjs   (Node 24, type stripping)
// `--check` only compares and exits 1 when the bundled file is stale (test/changelog.test.ts does the same).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { changelogJson, parseChangelog } from "../src/shared/changelog.ts";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(app, "../../CHANGELOG.md");
const target = join(app, "src/renderer/src/modules/about/changelog.bundled.json");
const next = changelogJson(parseChangelog(readFileSync(source, "utf8")));
let prev = null;
try {
  prev = readFileSync(target, "utf8");
} catch {}
if (process.argv.includes("--check")) {
  if (prev !== next) {
    console.error(`stale: ${target}\nrun: node apps/desktop/scripts/bundle-changelog.mjs`);
    process.exit(1);
  }
  console.log("changelog bundle is current");
} else if (prev === next) {
  console.log("changelog bundle already current");
} else {
  writeFileSync(target, next);
  console.log(`wrote ${target}`);
}
