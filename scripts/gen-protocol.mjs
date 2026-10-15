// Regenerates packages/protocol/src/codex from the cute-codex binary we run against.
// Usage: node scripts/gen-protocol.mjs [path-to-cute-codex]
// Defaults to $CUTE_CODEX_BIN, then `cute-codex` on PATH.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "packages", "protocol", "src", "codex");

const candidates = [
  process.argv[2],
  process.env.CUTE_CODEX_BIN,
].filter(Boolean);
const bin = candidates.find((c) => existsSync(c)) ?? "cute-codex";

const version = execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
execFileSync(bin, ["app-server", "generate-ts", "--out", outDir, "--experimental"], {
  stdio: "inherit",
});
writeFileSync(
  join(outDir, "VERSION.json"),
  JSON.stringify({ generator: version, experimental: true }, null, 2) + "\n",
);
console.log(`generated protocol types from ${version} -> ${outDir}`);
