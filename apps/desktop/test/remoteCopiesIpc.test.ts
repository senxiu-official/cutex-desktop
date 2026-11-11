import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteCopies } from "../src/main/remoteCopiesIpc";
import type { HostManager } from "../src/main/hosts";
import type { CopySource } from "../src/shared/remoteCopies";
import { canOpenCopy, type PreparedCopy } from "../src/shared/remoteCopyRequests";

const base = join(tmpdir(), "remote-copies-ipc-");
const roots: string[] = [], services: ReturnType<typeof createRemoteCopies>[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.dispose(); for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(base))) throw Error("unsafe fixture cleanup"); await rm(root, { recursive: true, force: true }); } });
async function fixture(pick: () => Promise<string | null> = async () => null) {
  const root = await mkdtemp(base); roots.push(root);
  const meta = { path: "/project/test.bin", name: "test.bin", size: 3, modifiedAt: "2026-10-28T00:00:00Z", revision: "a".repeat(64), maxChunkBytes: 1024 };
  const daemon = { generation: 1, currentState: { kind: "connected", hostId: "real-host", baseUrl: "http://127.0.0.1:1" }, copyTransport: vi.fn(async (_source, check) => ({ metadata: async () => { check(); return meta; }, chunk: async () => { check(); return { bytes: new Uint8Array([0, 255, 7]), offset: 0, next: 3, total: 3, eof: true, revision: meta.revision }; } })) };
  const conn = { daemon, routingEpoch: "epoch-a" };
  const hosts = { connection: (id: string) => id === "remote" || id === "local" ? conn : undefined, focus: () => "remote", state: () => ({ hosts: [{ id: "remote", kind: "ssh", label: "Main-controlled label" }, { id: "local", kind: "local", label: "This computer" }] }) };
  const shell = { openPath: vi.fn(async () => ""), showItemInFolder: vi.fn() };
  const service = createRemoteCopies(root, () => hosts as unknown as HostManager, shell, pick); services.push(service);
  const source: CopySource = { hostId: "remote", hostLabel: "renderer label", hostIdentity: "", path: "test.bin", scope: { kind: "project", id: "project-a" } };
  const binding = { hostId: "remote", epoch: "epoch-a" };
  await service.request({ kind: "list" });
  return { service, daemon, conn, source, binding, shell, meta, root };
}
async function download(f: Awaited<ReturnType<typeof fixture>>, source = f.source, binding = f.binding) {
  const prepared = await f.service.request({ kind: "inspect", source, binding }) as PreparedCopy;
  const id = await f.service.request({ kind: "start", source: prepared.source, binding, expected: prepared.meta }) as string;
  for (let n = 0; n < 100; n++) {
    const state = await f.service.request({ kind: "list" }) as import("../src/shared/remoteCopies").CopyState;
    if (state.copies.find(c => c.id === id)?.status !== "downloading") break;
    await new Promise(r => setTimeout(r, 5));
  }
  return id;
}

describe("downloads: local artifacts and the download folder", () => {
  it("saves a pinned artifact version from the local host, never a plain local file", async () => {
    const f = await fixture();
    const local = { hostId: "local", hostLabel: "", hostIdentity: "", path: "af-1@2", artifact: { id: "af-".padEnd(35, "0"), version: 2 } };
    const id = await download(f, local, { hostId: "local", epoch: "epoch-a" });
    const state = await f.service.request({ kind: "list" }) as import("../src/shared/remoteCopies").CopyState;
    expect(state.copies.find(c => c.id === id)).toMatchObject({ status: "complete", source: { hostId: "local", hostLabel: "This computer" } });
    await expect(f.service.request({ kind: "inspect", source: { ...local, artifact: undefined }, binding: { hostId: "local", epoch: "epoch-a" } })).rejects.toThrow("unavailable");
  });

  it("opens the default folder, moves the store into a picked folder and back, and keeps the copies", async () => {
    const pickedDir = await mkdtemp(base); roots.push(pickedDir);
    const f = await fixture(async () => pickedDir);
    const before = await f.service.request({ kind: "folder" }) as { path: string; isDefault: boolean };
    expect(before).toEqual({ path: join(f.root, "remote-copies"), isDefault: true });
    await f.service.request({ kind: "openFolder" });
    expect(f.shell.openPath).toHaveBeenLastCalledWith(before.path);
    f.meta.name = "report.pdf";
    const id = await download(f);
    const moved = await f.service.request({ kind: "chooseFolder" }) as { path: string; isDefault: boolean };
    expect(moved).toEqual({ path: join(pickedDir, "Cutex Downloads"), isDefault: false });
    await expect(stat(before.path)).rejects.toThrow();
    expect(JSON.parse(await readFile(join(f.root, "download-folder.json"), "utf8")).root).toBe(moved.path);
    await f.service.request({ kind: "open", id });
    expect(f.shell.openPath).toHaveBeenLastCalledWith(join(moved.path, id, "report.pdf"));
    const back = await f.service.request({ kind: "defaultFolder" }) as { path: string; isDefault: boolean };
    expect(back).toEqual(before);
    expect(await readdir(pickedDir)).toEqual([]);
    await expect(stat(join(f.root, "download-folder.json"))).rejects.toThrow();
    expect((await f.service.request({ kind: "list" }) as import("../src/shared/remoteCopies").CopyState).copies.map(c => c.id)).toEqual([id]);
  });

  it("refuses to move into the current folder, and a cancelled pick changes nothing", async () => {
    let pick: string | null = null;
    const f = await fixture(async () => pick);
    const folder = await f.service.request({ kind: "folder" }) as { path: string };
    expect(await f.service.request({ kind: "chooseFolder" })).toEqual({ path: folder.path, isDefault: true });
    pick = folder.path;
    await expect(f.service.request({ kind: "chooseFolder" })).rejects.toThrow("outside the current download folder");
    expect(await f.service.request({ kind: "folder" })).toEqual({ path: folder.path, isDefault: true });
  });
});

describe("owned-copy main IPC", () => {
  it("does not open executable or script downloads through OS associations", () => {
    for (const name of ["tool.exe", "run.py", "setup.pyw", "file.rb", "task.lua", "task.ahk", "start.sh", "link.lnk", "run.py. "]) expect(canOpenCopy(name)).toBe(false);
    for (const name of ["report.pdf", "photo.png", "notes.txt", "archive.zip"]) expect(canOpenCopy(name)).toBe(true);
  });
  it("uses the main host label/identity, preserves explicit scope and refuses stale/cross-host intents", async () => {
    const f = await fixture();
    const prepared = await f.service.request({ kind: "inspect", source: f.source, binding: f.binding }) as PreparedCopy;
    expect(prepared.source).toMatchObject({ hostLabel: "Main-controlled label", hostIdentity: "real-host", scope: { kind: "project", id: "project-a" } });
    await expect(f.service.request({ kind: "inspect", source: { ...f.source, hostId: "other" }, binding: f.binding })).rejects.toThrow("host mismatch");
    await expect(f.service.request({ kind: "inspect", source: f.source, binding: { ...f.binding, epoch: "stale" } })).rejects.toThrow("binding");
    await expect(f.service.request({ kind: "start", source: { ...prepared.source, hostIdentity: "old-host" }, binding: f.binding, expected: prepared.meta })).rejects.toThrow("identity");
    await expect(f.service.request({ kind: "inspect", source: { ...prepared.source, hostIdentity: "old-host" }, binding: f.binding })).rejects.toThrow("identity");
    expect(f.daemon.copyTransport).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid scopes, replacement source changes and arbitrary local path ids", async () => {
    const f = await fixture();
    await expect(f.service.request({ kind: "inspect", source: { ...f.source, scope: { kind: "project", id: "" } }, binding: f.binding })).rejects.toThrow("scope");
    await expect(f.service.request({ kind: "open", id: "C:/outside/sentinel.exe" })).rejects.toThrow("Unknown copy");
    const prepared = await f.service.request({ kind: "inspect", source: f.source, binding: f.binding }) as PreparedCopy;
    await expect(f.service.request({ kind: "start", source: prepared.source, binding: f.binding, expected: prepared.meta, replaceId: "forged" })).rejects.toThrow("refresh source");
    expect(f.shell.openPath).not.toHaveBeenCalled();
    expect(f.shell.showItemInFolder).not.toHaveBeenCalled();
  });
  it("propagates capability/auth refusal without attempting any alternative transfer", async () => {
    const f = await fixture();
    f.daemon.copyTransport.mockRejectedValueOnce(Error("file transfer is unavailable on this host"));
    await expect(f.service.request({ kind: "inspect", source: f.source, binding: f.binding })).rejects.toThrow("unavailable");
    expect(f.daemon.copyTransport).toHaveBeenCalledTimes(1);
  });
  it("refuses opening a completed Python copy in main while still allowing reveal", async () => {
    const f = await fixture(); f.meta.name = "task.py";
    const prepared = await f.service.request({ kind: "inspect", source: f.source, binding: f.binding }) as PreparedCopy;
    const id = await f.service.request({ kind: "start", source: prepared.source, binding: f.binding, expected: prepared.meta }) as string;
    for (let n = 0; n < 100; n++) {
      const state = await f.service.request({ kind: "list" }) as import("../src/shared/remoteCopies").CopyState;
      if (state.copies.find(c => c.id === id)?.status !== "downloading") break;
      await new Promise(r => setTimeout(r, 5));
    }
    await expect(f.service.request({ kind: "open", id })).rejects.toThrow("scripts cannot be opened");
    await f.service.request({ kind: "reveal", id });
    expect(f.shell.openPath).not.toHaveBeenCalled();
    expect(f.shell.showItemInFolder).toHaveBeenCalledOnce();
  });
});
