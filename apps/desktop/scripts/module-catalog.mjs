#!/usr/bin/env node
// Rewrites docs/module-catalog.{zh-CN,en}.md from the module metadata (modules/registry.ts, shared/moduleGroups.ts,
// shared/moduleMetadata.ts, modules/moduleCatalog.ts). The same file, test/moduleCatalog.test.ts, checks it in the
// normal test run; this only runs it in write mode.
//   node apps/desktop/scripts/module-catalog.mjs
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("pnpm", ["exec", "vitest", "run", "test/moduleCatalog.test.ts"], {
  cwd: desktop,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, MODULE_CATALOG_WRITE: "1" },
});
process.exit(result.status ?? 1);
