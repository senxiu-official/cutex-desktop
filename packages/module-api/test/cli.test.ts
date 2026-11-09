// The command itself, from the template: `new`, then build and pack run against this checkout's package.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const BIN = fileURLToPath(new URL("../bin/cutex-module.mjs", import.meta.url));
const PACKAGE = resolve(dirname(BIN), "..");
const API = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")).version.split(".").slice(0, 2).join(".");
const REACT = dirname(fileURLToPath(import.meta.resolve("react/package.json")));

let tmp: string;
let dir: string;
const links: string[] = [];
const run = (args: string[], cwd = tmp) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "cutex-module-cli-"));
  dir = join(tmp, "my-thing");
  const started = run(["new", "my-thing"]);
  expect(started.status, started.stderr).toBe(0);
  // What `npm install` gives the folder, without the network.
  const modules = join(dir, "node_modules");
  mkdirSync(join(modules, "@cutex-desktop"), { recursive: true });
  const link = (target: string, name: string) => {
    symlinkSync(target, join(modules, name), "junction");
    links.push(join(modules, name));
  };
  link(PACKAGE, "@cutex-desktop/module-api");
  link(REACT, "react");
  link(resolve(PACKAGE, "../../apps/desktop/node_modules/lucide-react"), "lucide-react");
}, 60_000);

afterAll(() => {
  // The links first: they point at the checkout's own packages.
  for (const link of links) unlinkSync(link);
  rmSync(tmp, { recursive: true, force: true });
});

it("new names everything after the folder and points at this checkout", () => {
  const pack = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
  expect(pack).toEqual({ id: "my-thing", version: "0.1.0", moduleApi: `^${API}`, author: "Your name" });
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  expect(manifest.devDependencies["@cutex-desktop/module-api"]).toBe(`file:${PACKAGE.replaceAll("\\", "/")}`);
  expect(readFileSync(join(dir, "src/index.tsx"), "utf8")).not.toContain("my-module");
  expect(readFileSync(join(dir, ".npmrc"), "utf8")).toContain("install-links");
  expect(existsSync(join(dir, ".gitignore"))).toBe(true);
  expect(existsSync(join(dir, "gitignore"))).toBe(false);
});

it("new refuses a folder that exists and a name that cannot be an id", { timeout: 60_000 }, () => {
  expect(run(["new", "my-thing"]).stderr).toMatch(/already exists/);
  expect(run(["new", "Not An Id"]).stderr).toMatch(/lower-case/);
});

it("the template's pack range is this package's version", () => {
  const template = JSON.parse(readFileSync(join(PACKAGE, "template/pack.json"), "utf8"));
  expect(template.moduleApi).toBe(`^${API}`);
});

it("no command prints the usage and fails", { timeout: 60_000 }, () => {
  const none = run([]);
  expect(none.status).toBe(2);
  expect(none.stderr).toMatch(/usage: cutex-module/);
});

it("builds and packs the template", () => {
  const built = run(["build"], dir);
  expect(built.status, built.stderr).toBe(0);
  const manifest = JSON.parse(readFileSync(join(dir, "dist/pack.json"), "utf8"));
  expect(manifest.id).toBe("my-thing");
  expect(Object.keys(manifest.host)).toContain("@cutex-desktop/module-api");
  const packed = run(["pack"], dir);
  expect(packed.status, packed.stderr).toBe(0);
  expect(packed.stderr).toMatch(/author in pack\.json is still "Your name"/);
  expect(existsSync(join(dir, "dist/my-thing-0.1.0.tar.gz"))).toBe(true);
}, 90_000);
