// System OpenSSH client for remote hosts: one-shot remote commands (pairing / revoke) and the
// management port forward (`ssh -N -L`). BatchMode only — never an interactive prompt; the user's
// keys / agent / ~/.ssh/config do the authentication. Pure argument building and error
// classification live in shared/hosts.ts.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import {
  classifySshFailure,
  execArgs,
  initialTunnel,
  tunnelArgs,
  tunnelReduce,
  type SshErrorView,
  type SshTarget,
  type TunnelEvent,
  type TunnelView,
} from "../shared/hosts";

/** Windows: prefer the inbox OpenSSH (PATH may hold Git's ssh, which ignores the Windows agent). */
export function resolveSshBinary(): string {
  if (process.platform === "win32") {
    const inbox = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe");
    if (existsSync(inbox)) return inbox;
  }
  return "ssh";
}

export class SshFailure extends Error {
  constructor(readonly view: SshErrorView) {
    super(`ssh ${view.code}${view.detail ? `: ${view.detail}` : ""}`);
  }
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run `ssh … <destination> <command>`; stdout is returned to the caller only (never logged). */
export function runSsh(target: SshTarget, command: string, timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(resolveSshBinary(), execArgs(target, command), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      reject(new SshFailure({ code: "noSsh", detail: String(error) }));
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d: Buffer) => {
      if (stdout.length < 256 * 1024) stdout += d.toString("utf8");
    });
    child.stderr!.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString("utf8")).slice(-8192);
    });
    const timer = setTimeout(() => {
      killTree(child);
      reject(new SshFailure({ code: "timeout", detail: `no answer within ${Math.round(timeoutMs / 1000)} s` }));
    }, timeoutMs);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new SshFailure({ code: error.code === "ENOENT" ? "noSsh" : "exited", detail: error.message }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** A free loopback port (bind :0, read it, close). */
export function freeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/** Something accepts TCP connections on 127.0.0.1:port (ssh listens once the session is up). */
export function portListening(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Kill ssh and anything it started (ProxyJump / ProxyCommand children). Windows: `taskkill /T`
 * (synchronous, so it also works from before-quit); POSIX: the process group (spawned detached).
 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return;
  killPidTree(pid);
  try {
    child.kill();
  } catch {
    // already gone
  }
}

function killPidTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5000 });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // gone
      }
    }
  }
}

/**
 * Tunnel pids on disk, so a crash never leaves a forward behind: the next start kills recorded
 * pids that are still our ssh tunnels (checked by command line, against pid reuse).
 */
export class TunnelPidFile {
  private pids = new Set<number>();
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  /** Kill leftovers from a previous run (call once at startup). */
  reapStale(): void {
    let stored: number[] = [];
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as { pids?: unknown };
      stored = Array.isArray(data.pids) ? data.pids.filter((p): p is number => Number.isInteger(p) && p > 0) : [];
    } catch {
      return;
    }
    for (const pid of stored) if (isOurTunnel(pid)) killPidTree(pid);
    this.save();
  }

  add(pid: number | undefined): void {
    if (!pid) return;
    this.pids.add(pid);
    this.save();
  }

  remove(pid: number | undefined): void {
    if (!pid || !this.pids.delete(pid)) return;
    this.save();
  }

  private save(): void {
    const body = `${JSON.stringify({ pids: [...this.pids] })}\n`;
    const file = this.file;
    this.saving = this.saving
      .then(async () => {
        await writeFile(`${file}.tmp`, body, "utf8");
        await rename(`${file}.tmp`, file);
      })
      .catch(() => {});
  }
}

function isOurTunnel(pid: number): boolean {
  let cmdline = "";
  try {
    if (process.platform === "win32") {
      const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`], { encoding: "utf8", windowsHide: true, timeout: 8000 });
      cmdline = r.stdout ?? "";
    } else {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    }
  } catch {
    return false;
  }
  return /ssh/i.test(cmdline) && cmdline.includes("ExitOnForwardFailure=yes") && cmdline.includes("ServerAliveCountMax=3") && /-L\s+127\.0\.0\.1:\d+:127\.0\.0\.1:\d+/.test(cmdline);
}

export interface SshTunnelOptions {
  target: SshTarget;
  remotePort: number;
  pids: TunnelPidFile;
  onChange(view: TunnelView): void;
  /** How long one attempt may take to come up before it is killed and retried. */
  readyTimeoutMs?: number;
}

/**
 * `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remote>` with readiness detection (the local port starts
 * accepting) and automatic reconnect with backoff (shared/hosts `tunnelReduce`). The local port is
 * kept across reconnects so the daemon client — and its event-feed cursors — survive a drop.
 */
export class SshTunnel {
  private view: TunnelView = initialTunnel();
  private child: ChildProcess | null = null;
  private stopped = true;
  private retryTimer: NodeJS.Timeout | null = null;
  private stderr = "";

  constructor(private readonly options: SshTunnelOptions) {}

  get state(): TunnelView {
    return this.view;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.attempt();
  }

  /** Retry now (manual "reconnect", or the daemon noticed the drop first). */
  reconnectNow(): void {
    if (this.stopped || this.child) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.attempt();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const child = this.child;
    this.child = null;
    if (child) {
      killTree(child);
      this.options.pids.remove(child.pid);
    }
    this.dispatch({ type: "stop" });
  }

  private dispatch(event: TunnelEvent): void {
    this.view = tunnelReduce(this.view, event);
    this.options.onChange(this.view);
  }

  private async attempt(): Promise<void> {
    if (this.stopped || this.child) return;
    const previous = this.view.localPort;
    const port = previous !== null && (await portFree(previous)) ? previous : await freeLocalPort().catch(() => 0);
    if (this.stopped || this.child) return;
    if (!port) {
      this.fail({ code: "forward", detail: "no free local port" });
      return;
    }
    this.stderr = "";
    let child: ChildProcess;
    try {
      child = spawn(resolveSshBinary(), tunnelArgs(this.options.target, port, this.options.remotePort), {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      this.fail({ code: "noSsh", detail: String(error) });
      return;
    }
    this.child = child;
    this.options.pids.add(child.pid);
    this.dispatch({ type: "spawn", localPort: port });
    child.stderr!.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString("utf8")).slice(-8192);
    });
    let spawnError: NodeJS.ErrnoException | null = null;
    child.on("error", (error: NodeJS.ErrnoException) => (spawnError = error));
    child.on("close", (code) => {
      this.options.pids.remove(child.pid);
      if (this.child !== child) return;
      this.child = null;
      if (this.stopped) return;
      const err = spawnError as NodeJS.ErrnoException | null;
      this.fail(err?.code === "ENOENT" ? { code: "noSsh", detail: err.message } : classifySshFailure(code, this.stderr, "tunnel"));
    });
    // Ready = ssh accepts on the local port (it binds only after authentication).
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 30_000);
    while (this.child === child && !this.stopped) {
      if (await portListening(port, 800)) {
        if (this.child === child && !this.stopped) this.dispatch({ type: "ready", now: Date.now() });
        return;
      }
      if (Date.now() > deadline) {
        this.stderr += "\ntimed out waiting for the port forward";
        killTree(child);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private fail(error: SshErrorView): void {
    this.dispatch({ type: "exit", error, now: Date.now() });
    if (this.view.status === "retrying" && this.view.retryAt !== null) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.attempt();
      }, Math.max(0, this.view.retryAt - Date.now()));
    }
  }
}

/**
 * A short-lived forward for one-off checks (test connection / revoke on a host that is not
 * active). Resolves once the port accepts; `close()` kills it.
 */
export async function openTemporaryTunnel(target: SshTarget, remotePort: number, pids: TunnelPidFile, timeoutMs = 25_000): Promise<{ port: number; close(): void }> {
  const port = await freeLocalPort();
  let child: ChildProcess;
  try {
    child = spawn(resolveSshBinary(), tunnelArgs(target, port, remotePort), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
  } catch (error) {
    throw new SshFailure({ code: "noSsh", detail: String(error) });
  }
  pids.add(child.pid);
  const close = () => {
    killTree(child);
    pids.remove(child.pid);
  };
  let stderr = "";
  child.stderr!.on("data", (d: Buffer) => (stderr = (stderr + d.toString("utf8")).slice(-8192)));
  let exited: { code: number | null; error: NodeJS.ErrnoException | null } | null = null;
  child.on("error", (error: NodeJS.ErrnoException) => (exited = { code: null, error }));
  child.on("close", (code) => {
    exited ??= { code, error: null };
    pids.remove(child.pid);
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exited) {
      const e = exited as { code: number | null; error: NodeJS.ErrnoException | null };
      throw new SshFailure(e.error?.code === "ENOENT" ? { code: "noSsh", detail: e.error.message } : classifySshFailure(e.code, stderr, "tunnel"));
    }
    if (await portListening(port, 800)) return { port, close };
    if (Date.now() > deadline) {
      close();
      throw new SshFailure({ code: "timeout", detail: classifySshFailure(null, stderr, "tunnel").detail || "timed out waiting for the port forward" });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
