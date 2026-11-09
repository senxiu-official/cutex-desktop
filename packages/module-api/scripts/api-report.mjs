#!/usr/bin/env node
// The API report: this package's declarations as one file, kept under api/ per version. A change to the public surface
// shows up there in review. `node scripts/api-report.mjs` rewrites the current version's report.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

export function emitReport() {
  const output = mkdtempSync(join(tmpdir(), "cutex-module-api-report-"));
  try {
    execFileSync(process.execPath, [join(dirname(require.resolve("typescript/package.json")), "bin", "tsc"), "-p", join(root, "tsconfig.json"),
      "--noEmit", "false", "--declaration", "--emitDeclarationOnly", "--rootDir", join(root, "src"), "--outDir", output],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const files = readdirSync(output).filter((name) => name.endsWith(".d.ts")).sort();
    return files.map((name) => `// ${relative(output, join(output, name)).replaceAll("\\", "/")}\n${readFileSync(join(output, name), "utf8").replaceAll("\r\n", "\n")}`).join("\n");
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

export const currentVersion = () => {
  const [major, minor] = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version.split(".");
  return `${major}.${minor}`;
};
export const reportPath = (version = currentVersion()) => join(root, "api", `module-api-${version}.d.ts`);

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) writeFileSync(reportPath(), emitReport());
