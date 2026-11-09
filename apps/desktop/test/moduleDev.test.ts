// Developer mode, main side (docs/desktop-modules.md §30.5): the switch, reading a folder's build all or nothing, the last
// good build, what the protocol serves.
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleDevService, readDevBuild, type ModuleDevOptions, type ModuleDevPrompts } from "../src/main/moduleDev";
import { parseModuleDevRequest } from "../src/shared/moduleDev";

vi.mock("electron", () => ({ dialog: {} }));

const API = "1.31";
let root: string;

function write(folder: string, id: string, code = "export const module = {};", extra: Record<string, unknown> = {}): void {
  const dist = join(folder, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.js"), code);
  writeFileSync(join(dist, "pack.json"), JSON.stringify({ id, version: "0.1.0", moduleApi: "^1.31", entry: "index.js", styles: [], host: { "@cutex-desktop/module-api": ["defineModule"] }, ...extra }));
}

const prompts = (over: Partial<ModuleDevPrompts> = {}): ModuleDevPrompts => ({
  confirmEnable: async () => true,
  pickFolder: async () => null,
  confirmFolder: async () => true,
  ...over,
});

function service(over: Partial<ModuleDevOptions> = {}): ModuleDevService {
  return new ModuleDevService({ file: join(root, "state", "dev.json"), appModuleApi: API, reservedIds: ["core"], prompts: prompts(), pollMs: 1_000_000, ...over });
}

async function withFolder(folder: string, over: Partial<ModuleDevOptions> = {}): Promise<ModuleDevService> {
  const s = service({ prompts: prompts({ pickFolder: async () => folder }), ...over });
  await s.setEnabled(true);
  await s.addFolder();
  return s;
}

/** The next build in a folder, with a stamp plainly newer than the last one read. */
let clock = Date.now() / 1000 + 100;
function touchPoll(s: ModuleDevService, folder: string, id: string, code: string, extra: Record<string, unknown> = {}): void {
  write(folder, id, code, extra);
  clock += 10;
  utimesSync(join(folder, "dist", "pack.json"), clock, clock);
  s.poll();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "module-dev-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the switch", () => {
  it("starts off, needs the native confirm and remembers the answer", async () => {
    const off = service({ prompts: prompts({ confirmEnable: async () => false }) });
    expect(off.view().enabled).toBe(false);
    expect((await off.setEnabled(true)).enabled).toBe(false);
    expect(existsSync(join(root, "state", "dev.json"))).toBe(false);
    off.dispose();
    const on = service();
    expect((await on.setEnabled(true)).enabled).toBe(true);
    on.dispose();
    const again = service();
    expect(again.view().enabled).toBe(true);
    again.dispose();
  });

  it("adds a folder only after main's own dialogs, and not while off", async () => {
    const folder = join(root, "m");
    write(folder, "my-thing");
    const pick = vi.fn(async () => folder);
    const s = service({ prompts: prompts({ pickFolder: pick, confirmFolder: async () => false }) });
    await s.addFolder();
    expect(pick).not.toHaveBeenCalled();
    await s.setEnabled(true);
    expect((await s.addFolder()).modules).toEqual([]);
    expect(pick).toHaveBeenCalledOnce();
    s.dispose();
  });

  it("loads nothing and serves nothing on a safe start, and says so", async () => {
    const folder = join(root, "m");
    write(folder, "my-thing");
    const first = await withFolder(folder);
    const url = first.view().modules[0]!.entry!;
    first.dispose();
    const safe = service({ skip: true });
    const view = safe.view();
    expect(view.skipped).toBe(true);
    expect(view.modules[0]!.entry).toBeNull();
    expect(safe.respond(new Request(url)).status).toBe(404);
    safe.dispose();
  });
});

describe("a build", () => {
  it("is read whole, and refuses what the app must not load", () => {
    const folder = join(root, "m");
    write(folder, "my-thing");
    expect(readDevBuild(folder, API, []).id).toBe("my-thing");
    write(folder, "core");
    expect(() => readDevBuild(folder, API, ["core"])).toThrow(/built into the app/);
    write(folder, "my-thing", "x", { moduleApi: "^1.99" });
    expect(() => readDevBuild(folder, API, [])).toThrow(/needs a newer app/);
    write(folder, "my-thing", "x", { entry: "../other.js" });
    expect(() => readDevBuild(folder, API, [])).toThrow(/entry/);
    write(folder, "my-thing", "x", { styles: ["../../secret.css"] });
    expect(() => readDevBuild(folder, API, [])).toThrow(/styles/);
    write(folder, "Bad Id");
    expect(() => readDevBuild(folder, API, [])).toThrow(/bad id/);
  });

  it("gets a new rev and URL only when its bytes changed", async () => {
    const folder = join(root, "m");
    write(folder, "my-thing", "one");
    const seen: number[] = [];
    const s = await withFolder(folder, { onChange: (v) => seen.push(v.modules[0]?.rev ?? 0) });
    const first = s.view().modules[0]!;
    expect(first.rev).toBeGreaterThan(0);
    touchPoll(s, folder, "my-thing", "one");
    expect(s.view().modules[0]!.rev).toBe(first.rev);
    touchPoll(s, folder, "my-thing", "two");
    const second = s.view().modules[0]!;
    expect(second.rev).toBeGreaterThan(first.rev);
    expect(second.entry).not.toBe(first.entry);
    expect(seen.length).toBeGreaterThan(0);
    s.dispose();
  });

  it("keeps the last good build when the next cannot be read, and shows why", async () => {
    const folder = join(root, "m");
    write(folder, "my-thing", "good");
    const s = await withFolder(folder);
    const good = s.view().modules[0]!;
    touchPoll(s, folder, "my-thing", "bad", { moduleApi: "^9.0" });
    const after = s.view().modules[0]!;
    expect(after.rev).toBe(good.rev);
    expect(after.entry).toBe(good.entry);
    expect(after.error).toMatch(/newer app/);
    expect(after.errorKey).toBe("modules.dev.err.newerApp");
    expect(after.errorVars).toEqual({ range: "^9.0", app: API });
    expect(await s.respond(new Request(good.entry!)).text()).toBe("good");
    s.dispose();
  });

  it("does not load the same id from two folders", async () => {
    const a = join(root, "a");
    const b = join(root, "b");
    write(a, "my-thing");
    write(b, "my-thing");
    let next = a;
    const s = service({ prompts: prompts({ pickFolder: async () => next }) });
    await s.setEnabled(true);
    await s.addFolder();
    next = b;
    const view = await s.addFolder();
    expect(view.modules[1]!.entry).toBeNull();
    expect(view.modules[1]!.error).toMatch(/already loaded/);
    s.dispose();
  });

  it("holds the renderer's reason for a rev that did not run, until a new one", async () => {
    const folder = join(root, "m");
    write(folder, "my-thing", "one");
    const s = await withFolder(folder);
    const m = s.view().modules[0]!;
    expect(s.report(folder, m.rev, "activate threw").modules[0]!.error).toBe("activate threw");
    expect(s.report(folder, m.rev + 5, "other").modules[0]!.error).toBe("activate threw");
    touchPoll(s, folder, "my-thing", "two");
    expect(s.view().modules[0]!.error).toBeNull();
    s.dispose();
  });

  it("is gone when its folder is removed, and the choice is remembered", async () => {
    const folder = join(root, "m");
    write(folder, "my-thing");
    const s = await withFolder(folder);
    const url = s.view().modules[0]!.entry!;
    expect(s.removeFolder(folder).modules).toEqual([]);
    expect(s.respond(new Request(url)).status).toBe(404);
    s.dispose();
    const next = service();
    expect(next.view().modules).toEqual([]);
    next.dispose();
  });
});

describe("what it serves", () => {
  it("serves the files of the build it read, by id and rev, from memory", async () => {
    const folder = join(root, "m");
    write(folder, "my-thing", "the code");
    const s = await withFolder(folder);
    const m = s.view().modules[0]!;
    write(folder, "my-thing", "changed on disk");
    const ok = s.respond(new Request(m.entry!));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("javascript");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.text()).toBe("the code");
    s.dispose();
  });

  it("answers 404 to everything else", async () => {
    const folder = join(root, "m");
    write(folder, "my-thing");
    writeFileSync(join(folder, "dist", "secret.txt"), "no");
    const s = await withFolder(folder);
    const m = s.view().modules[0]!;
    const base = `cutex-module://dev/my-thing/${m.rev}`;
    for (const url of [`${base}/secret.txt`, `${base}/pack.json`, `${base}/../../index.js`, `${base}/index.js?x=1`, `cutex-module://dev/other/${m.rev}/index.js`, `cutex-module://dev/my-thing/${m.rev + 1}/index.js`, `${base}/a/index.js`]) {
      expect(s.respond(new Request(url)).status, url).toBe(404);
    }
    expect(s.respond(new Request(m.entry!, { method: "POST" })).status).toBe(404);
    await s.setEnabled(false);
    expect(s.respond(new Request(m.entry!)).status).toBe(404);
    s.dispose();
  });
});

describe("the request parser", () => {
  it("takes only exact shapes", () => {
    expect(parseModuleDevRequest({ op: "state" })).toEqual({ op: "state" });
    expect(parseModuleDevRequest({ op: "report", folder: "x", rev: 1, error: null })).toEqual({ op: "report", folder: "x", rev: 1, error: null });
    for (const bad of [null, "state", { op: "nope" }, { op: "addFolder", folder: "D:/x" }, { op: "setEnabled", enabled: "yes" }, { op: "state", extra: 1 }, { op: "report", folder: "x", rev: 1.5, error: null }]) {
      expect(() => parseModuleDevRequest(bad)).toThrow();
    }
  });
});
