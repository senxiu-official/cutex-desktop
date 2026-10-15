import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
export function emitDeclarations() {
  const output = mkdtempSync(join(tmpdir(), "cutex-module-api-"));
  try {
    execFileSync(process.execPath, [join(dirname(require.resolve("typescript/package.json")), "bin", "tsc"), "-p", join(root, "tsconfig.json"),
      "--noEmit", "false", "--declaration", "--emitDeclarationOnly", "--rootDir", join(root, "src"), "--outDir", output],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const files = [];
    const walk = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path); else if (entry.name.endsWith(".d.ts")) files.push(path);
      }
    };
    walk(output);
    return files.sort().map(path => `// ${relative(output, path).replaceAll("\\", "/")}\n${readFileSync(path, "utf8")}`).join("\n");
  } finally { rmSync(output, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const version = process.argv[2];
  if (!/^\d+\.\d+$/.test(version ?? "")) throw new Error("Pass the reviewed MODULE_API_VERSION, e.g. 1.1");
  writeFileSync(join(root, "test", "fixtures", `module-api-${version}.d.ts`), emitDeclarations());
}
