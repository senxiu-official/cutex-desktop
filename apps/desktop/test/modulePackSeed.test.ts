import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MODULE_API_VERSION } from "@cutex-desktop/plugin-sdk";
import { ModulePackService, modulePackSource, type LocalPacksOptions } from "../src/main/modulePacks";
import { signMinisig } from "../scripts/module-packs/minisign.mjs";
import { writeTarGz } from "../scripts/module-packs/tar.mjs";
import { parseModulePacksRequest, type UpgradePackId } from "../src/shared/modulePacks";

const file = (path: string, data: Buffer) => ({ path, size: data.length, sha256: createHash("sha256").update(data).digest("hex") });

function fixture(id: UpgradePackId) {
  const temp = mkdtempSync(join(tmpdir(), "cutex-module-seed-"));
  const root = join(temp, "userData", "modules");
  const archive = `${id}-1.1.0.tar.gz`;
  const payload = join(temp, "replaced-portable", "resources", "app", "module-upgrade");
  const data = Buffer.from(`export const moduleApi="^1.16";export const module={id:"${id}",titleKey:"${id}.title",defaultEnabled:false};`);
  const bytes = writeTarGz([{ path: "index.js", data }]) as Buffer;
  const index = Buffer.from(JSON.stringify({ schema: 1, serial: 1, generatedAt: "2026-11-26T00:00:00Z", packs: [{
    id, version: "1.1.0", moduleApi: "^1.16", entry: "index.js", styles: [], host: {},
    files: [file("index.js", data)], archive: { size: bytes.length, sha256: file(archive, bytes).sha256, name: archive, url: `https://github.com/senxiu-official/cutex-desktop/releases/download/modules-release/${archive}` },
  }] }));
  const setup = () => {
    mkdirSync(payload, { recursive: true });
    writeFileSync(join(payload, archive), bytes);
    writeFileSync(join(payload, "modules.json"), index);
    writeFileSync(join(payload, "modules.json.minisig"), signMinisig(index, "modules.json"));
  };
  const service = (packaged = false, local?: LocalPacksOptions) => new ModulePackService({
    root, upgradePayload: payload, appModuleApi: MODULE_API_VERSION,
    source: modulePackSource({ releasePage: null, packaged }),
    transport: async () => { throw Error("upgrade should not touch the network"); },
    local,
  });
  return { temp, root, payload, archive, setup, service, clean: () => rmSync(temp, { recursive: true, force: true }) };
}

const ids = ["claude-science", "nci", "baidu-pan"] as const;

it.each(ids)("%s direct old-release skip and manual replacement seed a signed pack with no network", async id => {
  const f = fixture(id);
  try {
    // The old profile had the bundled module only: the new app can be in a completely different install directory.
    expect(f.service().seedBundled(id).migrations?.[id]).toBe("seed_missing");
    f.setup();
    const first = f.service();
    const seeded = first.seedBundled(id);
    expect(seeded.migrations?.[id]).toBe("installed");
    expect(seeded.installed[0]).toMatchObject({ id, version: "1.1.0" });
    const reopened = f.service();
    expect(reopened.seedBundled(id).migrations?.[id]).toBe("complete");
    await reopened.remove({ id });
    expect(f.service().seedBundled(id).installed).toEqual([]);
  } finally { f.clean(); }
});

it.each(ids)("%s rejects the test key in production and refuses corrupted upgrade bytes", id => {
  const f = fixture(id);
  try {
    f.setup();
    expect(f.service(true).seedBundled(id)).toMatchObject({ migrations: { [id]: "seed_invalid" }, installed: [] });
    writeFileSync(join(f.payload, f.archive), "corrupted");
    expect(f.service().seedBundled(id)).toMatchObject({ migrations: { [id]: "seed_invalid" }, installed: [] });
  } finally { f.clean(); }
});

it.each(ids)("%s keeps an owner-confirmed pack and its trust entry through seeding and safe start", async id => {
  const f = fixture(id);
  try {
    f.setup();
    const path = join(f.temp, "local.tar.gz");
    const version = "1.0.0";
    const entry = `export const moduleApi="^1.16";export const module={id:"${id}",titleKey:"${id}.title"};`;
    writeFileSync(path, writeTarGz([
      { path: "pack.json", data: JSON.stringify({ id, version, moduleApi: "^1.16", entry: "index.js", styles: [], host: {} }) },
      { path: "index.js", data: entry },
    ]));
    const local: LocalPacksOptions = {
      defaultAllowed: true,
      reservedIds: [],
      prompts: { pickFile: async () => path, confirmInstall: async () => true, confirmAllow: async () => true },
    };
    const first = f.service(false, local);
    expect((await first.installLocal()).installed[0]).toMatchObject({ id, version, local: true });
    const trust = () => JSON.parse(readFileSync(join(f.root, "local.json"), "utf8")).trust;
    const confirmed = trust();
    expect(confirmed[id]).toMatchObject({ version });
    expect(first.seedBundled(id)).toMatchObject({ migrations: { [id]: "kept" }, installed: [{ id, version, local: true }] });
    const safeStart = f.service(false, { ...local, skip: true });
    expect(safeStart.seedBundled(id)).toMatchObject({ migrations: { [id]: "kept" }, installed: [] });
    expect(safeStart.view().local.held).toEqual([{ id, version, reason: "safeStart" }]);
    expect(trust()).toEqual(confirmed);
    expect(readFileSync(join(f.root, id, version, "index.js"), "utf8")).toBe(entry);
  } finally { f.clean(); }
});

it("admits only the fixed seed ids and refuses renderer paths", () => {
  for (const id of ids) expect(parseModulePacksRequest({ op: "seedBundled", id })).toEqual({ op: "seedBundled", id });
  expect(() => parseModulePacksRequest({ op: "seedBundled", id: "jobs" })).toThrow();
  expect(() => parseModulePacksRequest({ op: "seedBundled", id: "nci", path: "fixture" })).toThrow();
});
