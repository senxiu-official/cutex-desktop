#!/usr/bin/env node
// cutex-module: start, build and pack a Cutex desktop module (docs/module-authoring.md).
import { cpSync, existsSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModule, packModule } from "../tools/builder.mjs";

const USAGE = `usage: cutex-module <command> [folder]

  new <folder>      start a module in a new folder, from the template
  build [folder]    build it into <folder>/dist
  dev [folder]      build, then build again whenever a source changes
  pack [folder]     build it and write dist/<id>-<version>.tar.gz, to install from a file

The folder defaults to the current one.`;

function describe(manifest) {
  const reads = Object.keys(manifest.host).filter((spec) => spec.endsWith("/experimental"));
  return `${manifest.id} ${manifest.version}${reads.length ? " (uses the experimental API)" : ""}`;
}

function startModule(folderArg) {
  if (!folderArg) throw new Error(USAGE);
  const dir = resolve(folderArg);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  const id = basename(dir);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error(`the folder's name is the module's id: lower-case letters, digits and "-", starting with a letter (not ${JSON.stringify(id)})`);
  const here = fileURLToPath(new URL("..", import.meta.url));
  cpSync(join(here, "template"), dir, { recursive: true });
  renameSync(join(dir, "gitignore"), join(dir, ".gitignore"));
  renameSync(join(dir, "npmrc"), join(dir, ".npmrc"));
  // The template's id is `my-module`, and its package points at this copy of the API.
  for (const file of ["pack.json", "package.json", "README.md", "src/index.tsx", "i18n/en.json", "i18n/zh-CN.json"]) {
    const path = join(dir, file);
    writeFileSync(path, readFileSync(path, "utf8").replaceAll("my-module", id).replaceAll("MODULE_API_PATH", here.replaceAll("\\", "/").replace(/\/$/, "")));
  }
  console.log(`${dir}\nNext: cd there, install the dependencies (npm install), then npm run build.`);
}

/** Builds now, then again after a change settles. A failed build leaves the last good dist/ in place. */
async function dev(dir) {
  let timer = null;
  let running = false;
  let again = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const { manifest } = await buildModule(dir);
      console.log(`[${new Date().toLocaleTimeString()}] built ${describe(manifest)}`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ${error instanceof Error ? error.message : error}`);
    }
    running = false;
    if (again) {
      again = false;
      void run();
    }
  };
  await run();
  const changed = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 100);
  };
  for (const name of ["src", "i18n"]) if (existsSync(join(dir, name))) watch(join(dir, name), { recursive: true }, changed);
  watch(dir, (_event, file) => {
    if (file === "pack.json") changed();
  });
  console.log("Watching src/, i18n/ and pack.json. Ctrl+C stops.");
}

async function main(argv) {
  const [command, folder] = argv;
  const dir = resolve(folder ?? ".");
  switch (command) {
    case "new":
      startModule(folder);
      return;
    case "build": {
      const { manifest, dist } = await buildModule(dir);
      console.log(`${describe(manifest)} → ${dist}`);
      return;
    }
    case "dev":
      await dev(dir);
      return;
    case "pack": {
      const { archivePath, manifest, size, sha256 } = await packModule(dir);
      console.log(`${describe(manifest)} → ${archivePath}\n${size} bytes, sha256 ${sha256}`);
      if (manifest.author === "Your name") console.warn(`Warning: author in pack.json is still "Your name", and the install dialog will show that. Change it or remove it, then pack again.`);
      return;
    }
    default:
      console.error(USAGE);
      process.exitCode = 2;
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
