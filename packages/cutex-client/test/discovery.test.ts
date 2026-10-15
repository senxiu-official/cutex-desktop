import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverLocalDaemon, selectHome } from "../src/discovery";

const homes: string[] = [];
async function fixture(config: unknown = { management_port: 25370, management_api_token: "fixture-token" }) {
  const home = await mkdtemp(join(tmpdir(), "cutex-discovery-"));
  homes.push(home);
  const instance = join(home, ".cutex");
  await mkdir(instance);
  if (config !== undefined) await writeFile(join(instance, "config.json"), JSON.stringify(config));
  return { home, instance };
}
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });

describe("independent instance discovery", () => {
  it("uses CUTEX_HOME as the config directory and derives its management port", async () => {
    const { home, instance } = await fixture();
    const found = await discoverLocalDaemon({ home: join(home, "unrelated"), env: { CUTEX_HOME: instance } });
    expect(found).toEqual({ configPath: join(instance, "config.json"), baseUrl: "http://127.0.0.1:25370", token: "fixture-token" });
  });
  it("also discovers a pinned desktop home whose config declares an instance port", async () => {
    const { home } = await fixture();
    expect((await discoverLocalDaemon({ home, env: {} })).baseUrl).toBe("http://127.0.0.1:25370");
  });
  it.each(["http://127.0.0.1:25370/", "http://localhost:25370", "http://[::1]:25370"])("permits matching loopback override %s", async baseUrl => {
    const { instance } = await fixture();
    expect((await discoverLocalDaemon({ env: { CUTEX_HOME: instance, CUTEX_MANAGEMENT_URL: baseUrl } })).baseUrl).toBe(baseUrl.replace(/\/+$/, ""));
  });
  it.each([
    "http://remote.invalid:25370", "http://127.0.0.1:24270", "http://localhost:25360",
    "http://127.0.0.1:25370@remote.invalid", "http://user:password@127.0.0.1:25370",
    "http://127.0.0.1:25370/path", "http://127.0.0.1:25370?query=1", "file:///tmp/socket",
  ])("rejects unsafe instance URL before exposing the token: %s", async baseUrl => {
    const { instance } = await fixture();
    await expect(discoverLocalDaemon({ baseUrl, env: { CUTEX_HOME: instance } })).rejects.toThrow(/instance/i);
  });
  it.each([null, 0, 65536, "25370", 1.5])("rejects invalid instance port %s", async port => {
    const { instance } = await fixture({ management_port: port, management_api_token: "fixture-token" });
    await expect(discoverLocalDaemon({ env: { CUTEX_HOME: instance } })).rejects.toThrow(/port/i);
  });
  it("does not silently fall back to a live daemon if instance config is missing", async () => {
    const { instance } = await fixture();
    await rm(join(instance, "config.json"));
    await expect(discoverLocalDaemon({ env: { CUTEX_HOME: instance } })).rejects.toThrow();
  });
  it("requires an absolute explicit CUTEX_HOME", async () => {
    await expect(discoverLocalDaemon({ env: { CUTEX_HOME: "relative-instance" } })).rejects.toThrow(/absolute/i);
  });
  it("preserves legacy home config and explicit URL behavior", async () => {
    const { home } = await fixture({ management_api_token: "legacy-fixture" });
    expect(await discoverLocalDaemon({ home, env: {} })).toMatchObject({ baseUrl: "http://127.0.0.1:24270", token: "legacy-fixture" });
    expect(await discoverLocalDaemon({ home, env: { CUTEX_MANAGEMENT_URL: "http://legacy.invalid:1234/" } })).toMatchObject({ baseUrl: "http://legacy.invalid:1234", token: "legacy-fixture" });
  });
});

describe("CUTEX_HOME selection matches cutex select_home", () => {
  it("treats an empty CUTEX_HOME as the default instance", async () => {
    const { home } = await fixture({ management_api_token: "default-token" });
    expect(await selectHome("", home)).toEqual({ kind: "default" });
    expect(await discoverLocalDaemon({ home, env: { CUTEX_HOME: "" } })).toMatchObject({ baseUrl: "http://127.0.0.1:24270", token: "default-token", configPath: join(home, ".cutex", "config.json") });
  });
  it("treats CUTEX_HOME naming the default home itself as the default instance (also via . / trailing separator)", async () => {
    const { home, instance } = await fixture({ management_api_token: "default-token" });
    for (const value of [instance, `${instance}${sep}`, join(home, ".", ".cutex")]) {
      expect(await selectHome(value, home), value).toEqual({ kind: "default" });
      expect(await discoverLocalDaemon({ home, env: { CUTEX_HOME: value } }), value).toMatchObject({ baseUrl: "http://127.0.0.1:24270", token: "default-token" });
    }
  });
  it.skipIf(process.platform !== "win32")("compares case-insensitively on Windows", async () => {
    const { home, instance } = await fixture({ management_api_token: "default-token" });
    expect(await selectHome(instance.toUpperCase(), home)).toEqual({ kind: "default" });
  });
  it("resolves a symlinked alias of the default home to the default instance", async () => {
    const { home, instance } = await fixture({ management_api_token: "default-token" });
    const alias = join(home, "alias");
    try { await symlink(instance, alias, "junction"); } catch { return; }
    expect(await selectHome(alias, home)).toEqual({ kind: "default" });
  });
  it("rejects what cutex rejects: relative, `..`, root, inside / around the default home, protected dirs", async () => {
    const { home, instance } = await fixture();
    await expect(selectHome("relative", home)).rejects.toThrow(/absolute/);
    await expect(selectHome(`${home}${sep}a${sep}..${sep}b`, home)).rejects.toThrow(/\.\./);
    await expect(selectHome(parse(home).root, home)).rejects.toThrow(/root/);
    await expect(selectHome(join(instance, "nested"), home)).rejects.toThrow(/inside the default home/);
    await expect(selectHome(home, home)).rejects.toThrow(/contain the default home/);
    for (const dir of [".codex", ".claude", ".codez-cli", ".codex-codez"]) {
      await expect(selectHome(join(home, dir), home), dir).rejects.toThrow(/must not be inside/);
      await expect(selectHome(join(home, dir, "x"), home), dir).rejects.toThrow(/must not be inside/);
    }
    // The discovery surfaces the same refusal instead of reading some other config.
    await expect(discoverLocalDaemon({ home, env: { CUTEX_HOME: join(instance, "nested") } })).rejects.toThrow(/default home/);
  });
  it("selects an independent instance elsewhere", async () => {
    const { home } = await fixture();
    const other = join(home, "instances", "a");
    expect(await selectHome(other, home)).toEqual({ kind: "custom", path: other });
  });
});
