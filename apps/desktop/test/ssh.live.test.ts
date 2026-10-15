// Live checks of the main-process ssh plumbing with the real OpenSSH client, against throwaway
// local listeners only (a closed port, a TCP server that is not sshd, an unresolvable .invalid
// host) — never a real ssh server. Skipped unless CUTEX_SSH_IT=1.
//   $env:CUTEX_SSH_IT=1; pnpm exec vitest run test/ssh.live.test.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { parseSshTarget, type TunnelView } from "../src/shared/hosts";
import { SshFailure, SshTunnel, TunnelPidFile, freeLocalPort, openTemporaryTunnel, portListening, runSsh } from "../src/main/ssh";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(!process.env.CUTEX_SSH_IT)("ssh plumbing (throwaway listeners)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cutex-ssh-it-"));
  const servers: Server[] = [];
  afterAll(() => servers.forEach((s) => s.close()));

  it("detects a listening port and a free one", async () => {
    const http = createHttpServer((_req, res) => res.end("ok"));
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    const port = (http.address() as { port: number }).port;
    expect(await portListening(port)).toBe(true);
    http.close();
    expect(await portListening(await freeLocalPort())).toBe(false);
  });

  it("one-shot: unresolvable host → resolve (and `--` ends the options)", async () => {
    const r = await runSsh(parseSshTarget("cutex-desktop-test.invalid")!, "cutex management client-token issue --label desktop-test", 20_000);
    expect(r.code).toBe(255);
    const { classifySshFailure } = await import("../src/shared/hosts");
    expect(classifySshFailure(r.code, r.stderr, "exec").code).toBe("resolve");
  }, 30_000);

  it("temporary tunnel to a closed port fails with refused", async () => {
    const port = await freeLocalPort();
    const pids = new TunnelPidFile(join(dir, "tmp-pids.json"));
    const error = await openTemporaryTunnel(parseSshTarget(`127.0.0.1:${port}`)!, 24270, pids, 15_000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SshFailure);
    expect((error as SshFailure).view.code).toBe("refused");
  }, 30_000);

  it("tunnel against a non-ssh listener retries with backoff on a stable local port, and stop() kills ssh", async () => {
    // Speaks garbage instead of an SSH banner, then hangs up.
    const fake = createServer((socket) => {
      socket.on("error", () => {}); // ssh resets the connection
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    });
    servers.push(fake);
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    const port = (fake.address() as { port: number }).port;
    const views: TunnelView[] = [];
    const pidFile = join(dir, "pids.json");
    const tunnel = new SshTunnel({ target: parseSshTarget(`127.0.0.1:${port}`)!, remotePort: 24270, pids: new TunnelPidFile(pidFile), onChange: (v) => views.push(v), readyTimeoutMs: 10_000 });
    tunnel.start();
    await vi.waitFor(() => expect(views.filter((v) => v.status === "retrying").length).toBeGreaterThanOrEqual(2), { timeout: 20_000, interval: 100 });
    const retries = views.filter((v) => v.status === "retrying");
    expect(retries[0]!.attempt).toBe(1);
    expect(retries[1]!.attempt).toBe(2);
    // The local port is kept across attempts (daemon client / feed cursors survive a drop).
    const ports = new Set(views.map((v) => v.localPort));
    expect(ports.size).toBe(1);
    // Catch a live ssh process, then stop: it must be gone.
    let recorded: { pids: number[] } = { pids: [] };
    await vi.waitFor(
      () => {
        expect(views.at(-1)!.status).toBe("starting");
        recorded = JSON.parse(readFileSync(pidFile, "utf8")) as { pids: number[] };
        expect(recorded.pids.length).toBe(1);
        expect(alive(recorded.pids[0]!)).toBe(true);
      },
      { timeout: 15_000, interval: 20 },
    );
    tunnel.stop();
    expect(views.at(-1)!.status).toBe("idle");
    for (const pid of recorded.pids) await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000, interval: 100 });
  }, 60_000);
});
