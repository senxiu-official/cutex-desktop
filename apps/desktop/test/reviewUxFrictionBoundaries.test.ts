import { createServer } from "node:http";
import { createConnection } from "node:net";
import { mkdtemp, rename, rm, writeFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { startBrowserEgressProxy, type BrowserEgressDial } from "../src/main/browser/egressProxy";
import { localFileAction } from "../src/main/localFiles";

it("a fake-IP answer cannot conceal a protected control port", async () => {
  const origin = createServer((_req, res) => res.end("synthetic control endpoint"));
  await new Promise<void>(resolve => origin.listen(0, "127.0.0.1", resolve));
  const fixturePort = (origin.address() as { port: number }).port;
  const dial = vi.fn<BrowserEgressDial>((_target, signal) => createConnection({ host: "127.0.0.1", port: fixturePort, signal }));
  const proxy = await startBrowserEgressProxy({
    lookup: async () => [{ address: "198.18.0.7", family: 4 }], dial,
    protectedAddress: (address, port) => port === 24270 && (address === "127.0.0.1" || address === "::1"),
  });
  const socket = createConnection({ host: "127.0.0.1", port: proxy.port });
  let body = "";
  try {
    const response = new Promise<string>((resolve, reject) => {
      socket.on("data", chunk => { body += chunk.toString(); });
      socket.on("error", reject); socket.on("close", () => resolve(body));
    });
    const credentials = Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64");
    socket.write(`GET http://public.example.com:24270/ HTTP/1.1\r\nHost: public.example.com:24270\r\nProxy-Authorization: Basic ${credentials}\r\nConnection: close\r\n\r\n`);
    expect(await response).toMatch(/^HTTP\/1.1 403 /);
    expect(dial).not.toHaveBeenCalled();
  } finally {
    socket.destroy(); await proxy.close(); await new Promise<void>(resolve => origin.close(() => resolve()));
  }
});

it("does not run a script changed during native confirmation with size and mtime preserved", async () => {
  // No real process or shell is launched.
  const root = await mkdtemp(join(tmpdir(), "review-run-identity-"));
  const script = join(root, "build.ps1");
  await writeFile(script, "Write-Output 'A'");
  const stamp = new Date("2026-11-18T00:00:00Z");
  await utimes(script, stamp, stamp);
  const before = await stat(script);
  const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(async () => "") };
  const run = localFileAction("local", script, "run", shell, async () => {
    await writeFile(script, "Write-Output 'B'");
    await utimes(script, before.atime, before.mtime);
    return true;
  });
  try {
    await expect(run).rejects.toThrow("changed");
    expect(shell.openPath).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("does not run a script atomically replaced during confirmation; an unchanged one runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-run-replace-"));
  const script = join(root, "build.ps1"), next = join(root, "next.ps1");
  try {
    await writeFile(script, "Write-Output 'A'");
    const before = await stat(script);
    await writeFile(next, "Write-Output 'A'");
    await utimes(next, before.atime, before.mtime);
    const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(async () => "") };
    // The dialog opens while main is still hashing build.ps1 (a handle open for the few ms of the read). Windows
    // refuses to replace a file any handle has open (EPERM/EBUSY), so the swap waits for the read to finish, as an
    // editor saving the file would; the swap itself is what the check must catch.
    const swap = async () => {
      for (let i = 0; ; i++) {
        try { return await rename(next, script); } catch (error) {
          if (i >= 100 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    };
    await expect(localFileAction("local", script, "run", shell, async () => { await swap(); return true; })).rejects.toThrow("changed");
    expect(shell.openPath).not.toHaveBeenCalled();
    await localFileAction("local", script, "run", shell, async () => true);
    expect(shell.openPath).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("no handle is left on the file once 运行… returns: run, cancel, refusal (it can be replaced at once)", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-run-handle-"));
  const script = join(root, "build.ps1");
  const replace = async () => { const other = join(root, "other.ps1"); await writeFile(other, "Write-Output 'C'"); await rename(other, script); };
  try {
    await writeFile(script, "Write-Output 'A'");
    const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(async () => "") };
    await localFileAction("local", script, "run", shell, async () => true);
    await replace();
    await localFileAction("local", script, "run", shell, async () => false);
    await replace();
    await expect(localFileAction("local", script, "run", shell, async () => { throw new Error("dialog failed"); })).rejects.toThrow("dialog failed");
    await replace();
    expect(shell.openPath).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
