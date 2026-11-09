// The public module builder (packages/module-api/tools, docs/desktop-modules.md §30): a module built from a folder of its
// own, with only the public package, and what it refuses.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODULE_API_VERSION, moduleApiSatisfies } from "@cutex-desktop/plugin-sdk";
import { buildModule, checkModuleApiRange, LOCALES, packModule } from "../../../packages/module-api/tools/builder.mjs";
import { isAppLocale } from "../src/shared/locales";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "cutex-module-build-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function project(name: string, files: Record<string, string>): string {
  const dir = join(tmp, name);
  const all = { "pack.json": JSON.stringify({ id: "sample", version: "1.2.3", moduleApi: `^${MODULE_API_VERSION}` }), ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const GOOD = `import { useState } from "react";
import { defineModule, useI18n } from "@cutex-desktop/module-api";
import { Button } from "@cutex-desktop/module-api/ui";
function Count() {
  const { t } = useI18n();
  const [n, setN] = useState(0);
  return <Button onClick={() => setN(n + 1)}>{t("sample.title")} {n}</Button>;
}
export default defineModule({ id: "sample", titleKey: "sample.title", contributes: { "tray.entry": [{ id: "sample.tray", Button: Count }] } });
`;

const build = (dir: string) => buildModule(dir, { logLevel: "silent" });

describe("a module project", { timeout: 60_000 }, () => {
  it("builds into dist/ with its host list, messages and titles, and no app code", async () => {
    const dir = project("good", { "src/index.tsx": GOOD, "i18n/en.json": '{"sample.title":"Sample"}', "i18n/zh-CN.json": '{"sample.title":"示例"}' });
    const { manifest } = await build(dir);
    expect(manifest).toEqual({
      id: "sample",
      version: "1.2.3",
      moduleApi: `^${MODULE_API_VERSION}`,
      title: { en: "Sample", "zh-CN": "示例" },
      entry: "index.js",
      styles: [],
      host: { "@cutex-desktop/module-api": ["defineModule", "useI18n"], "@cutex-desktop/module-api/ui": ["Button"], react: ["useState"], "react/jsx-runtime": ["jsxs"] },
    });
    const code = readFileSync(join(dir, "dist/index.js"), "utf8");
    expect(code).toContain("__CUTEX_MODULE_HOST__");
    expect(code).toContain('"sample.title":"示例"');
    expect(JSON.parse(readFileSync(join(dir, "dist/pack.json"), "utf8"))).toEqual(manifest);
  });

  it("wraps its own CSS in the pack layer", async () => {
    const dir = project("css", { "src/index.tsx": `import "./style.css";\n${GOOD}`, "src/style.css": ".sample-box { color: red; }\n", "i18n/en.json": '{"sample.title":"Sample"}' });
    const { manifest } = await build(dir);
    expect(manifest.styles).toEqual(["index.css"]);
    expect(readFileSync(join(dir, "dist/index.css"), "utf8")).toMatch(/^@layer cutex-pack\{.*sample-box.*\}/s);
  });

  it("packs a tar.gz with the same bytes each time, in the format install-from-file reads", async () => {
    const dir = project("pack", { "src/index.tsx": GOOD, "i18n/en.json": '{"sample.title":"Sample"}' });
    const first = await packModule(dir, { logLevel: "silent" });
    const second = await packModule(dir, { logLevel: "silent" });
    expect(first.sha256).toBe(second.sha256);
    expect(first.archivePath.endsWith("sample-1.2.3.tar.gz")).toBe(true);
    expect(gunzipSync(readFileSync(first.archivePath)).toString("latin1")).toContain("pack.json");
  });

  const refused: [string, Record<string, string>, RegExp][] = [
    ["an app file by name", { "src/index.tsx": `import { useApp } from "@cutex-desktop/app/store";\nexport default useApp;` }, /imports @cutex-desktop\/app\/store: a module may import only/],
    ["another private package", { "src/index.tsx": `import { MODULE_API_VERSION } from "@cutex-desktop/plugin-sdk";\nexport default MODULE_API_VERSION;` }, /imports @cutex-desktop\/plugin-sdk: a module may import only/],
    ["a file outside the folder", { "src/index.tsx": `import x from "../../outside";\nexport default x;`, "../outside.ts": "export default 1;" }, /outside this module's folder/],
    ["a part of React that is not shared", { "src/index.tsx": `import { createRoot } from "react-dom/client";\nexport default createRoot;` }, /only react, react\/jsx-runtime, react-dom are shared/],
    ["a name the API does not have", { "src/index.tsx": `import { nothingLikeThis } from "@cutex-desktop/module-api";\nexport default nothingLikeThis;` }, /@cutex-desktop\/module-api has no nothingLikeThis/],
    ["another module's message", { "src/index.tsx": GOOD, "i18n/en.json": '{"other.title":"x"}' }, /must start with "sample\."/],
    ["a language the app does not have", { "src/index.tsx": GOOD, "i18n/xx.json": "{}" }, /unknown locale/],
    ["an unknown pack.json field", { "src/index.tsx": GOOD, "pack.json": JSON.stringify({ id: "sample", version: "1.0.0", moduleApi: `^${MODULE_API_VERSION}`, packOnly: true }) }, /unknown field packOnly/],
    ["a too new range", { "src/index.tsx": GOOD, "pack.json": JSON.stringify({ id: "sample", version: "1.0.0", moduleApi: "^99.0" }) }, /does not accept/],
    ["no entry", { "src/other.ts": "" }, /no src\/index/],
  ];
  it.each(refused)("refuses %s", async (name, files, error) => {
    await expect(build(project(`refused-${name.replace(/\W/g, "-")}`, files))).rejects.toThrow(error);
  });
});

describe("the builder agrees with the app", () => {
  it("on which ranges load", () => {
    const [major, minor] = MODULE_API_VERSION.split(".").map(Number) as [number, number];
    for (const range of [`^${major}.${minor}`, `^${major}.0`]) {
      expect(() => checkModuleApiRange(range, MODULE_API_VERSION)).not.toThrow();
      expect(moduleApiSatisfies(range, MODULE_API_VERSION)).toBe(true);
    }
    for (const range of [`^${major}.${minor + 1}`, `^${major + 1}.0`]) {
      expect(() => checkModuleApiRange(range, MODULE_API_VERSION)).toThrow();
      expect(moduleApiSatisfies(range, MODULE_API_VERSION)).toBe(false);
    }
  });

  it("on the languages", () => {
    for (const locale of LOCALES) expect(isAppLocale(locale), locale).toBe(true);
  });

  it("says when the definition does not match pack.json, in the guide's words", { timeout: 60_000 }, async () => {
    const def = (id: string, item: string) => `import { defineModule } from "@cutex-desktop/module-api";
export default defineModule({ id: "${id}", titleKey: "sample.title", contributes: { "tray.entry": [{ id: "${item}", Button: () => null }] } });`;
    await expect(buildModule(project("mismatch-id", { "src/index.ts": def("other", "other.tray") }), { logLevel: "silent" })).rejects.toThrow(/pack\.json says the id is "sample".*defineModule.*"other"/);
    await expect(buildModule(project("mismatch-item", { "src/index.ts": def("sample", "tray") }), { logLevel: "silent" })).rejects.toThrow(/the item "tray" in the slot tray\.entry.*must start with "sample\."/);
    await expect(buildModule(project("match", { "src/index.ts": def("sample", "sample.tray") }), { logLevel: "silent" })).resolves.toBeTruthy();
  });

  it("says what to write when there is no default export", { timeout: 60_000 }, async () => {
    await expect(buildModule(project("no-default", { "src/index.ts": `export const x = 1;` }), { logLevel: "silent" })).rejects.toThrow(/src\/index\.ts has no default export[\s\S]*export default defineModule\(\{ id: "sample"/);
  });

  it("still builds a module whose file needs a real window at the top level", { timeout: 60_000 }, async () => {
    const dir = project("needs-window", { "src/index.ts": `import { defineModule } from "@cutex-desktop/module-api";
const here = document.title;
export default defineModule({ id: "sample", titleKey: "sample.title", displayName: here } as never);` });
    await expect(buildModule(dir, { logLevel: "silent" })).resolves.toBeTruthy();
  });

  it("does not hang on a timer at the top level", { timeout: 60_000 }, async () => {
    const dir = project("has-timer", { "src/index.ts": `import { defineModule } from "@cutex-desktop/module-api";
setInterval(() => console.log("tick"), 10);
export default defineModule({ id: "sample", titleKey: "sample.title" });` });
    await expect(buildModule(dir, { logLevel: "silent" })).resolves.toBeTruthy();
  });

  it("leaves no build behind on refusal", async () => {
    const dir = project("no-dist", { "src/index.tsx": `import x from "@cutex-desktop/app/store";\nexport default x;` });
    await expect(build(dir)).rejects.toThrow();
    expect(existsSync(join(dir, "dist"))).toBe(false);
  });
});
