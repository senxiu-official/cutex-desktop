// System OpenSSH client for remote hosts: one-shot remote commands (pairing / revoke) and the
// management port forward (`ssh -N -L`). The user's ~/.ssh/config, ssh-agent and default identity
// files do the authentication, for an alias and a typed `user@host[:port]` alike. With an
// `AskpassSession` ssh may also ask (key passphrase, password, keyboard-interactive, unknown host
// key) through the desktop's prompt dialog (main/sshAskpass.ts); without one it runs in BatchMode
// and never asks. Pure argument building and error classification live in shared/hosts.ts.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import {
  ROUTE_ALIVE_INTERVAL_SEC,
  ROUTE_CONNECT_TIMEOUT_SEC,
  ROUTE_FLAP_BASE_MS,
  ROUTE_FLAP_MAX_MS,
  ROUTE_FLAP_WINDOW_MS,
  ROUTE_HOLD_MS,
  ROUTE_MAX_BACKOFF_MS,
  ROUTE_NEXT_MS,
  ROUTE_PROBE_INTERVAL_MS,
  ROUTE_PROBE_SLOW_AFTER_ROUNDS,
  ROUTE_PROBE_SLOW_INTERVAL_MS,
  ROUTE_READY_TIMEOUT_MS,
  ROUTE_REFUSED_RETRY_MS,
  TUNNEL_STABLE_MS,
  backoffMs,
  classifySshFailure,
  execArgs,
  formatSshTarget,
  initialTunnel,
  isPermanentSshError,
  parseSshConfigDump,
  tunnelArgs,
  tunnelReduce,
  type SshErrorView,
  type SshTarget,
  type TunnelEvent,
  type TunnelTiming,
  type TunnelView,
} from "../shared/hosts";
import type { AskpassSession, AskpassSpawn } from "./sshAskpass";
import { TunnelFront } from "./tunnelFront";

export interface SshRunOptions {
  /** Prompts go to the desktop's dialog; timeouts pause while a question is open. */
  askpass?: AskpassSession | null;
  /** Tests only: extra ssh options (before `--`). */
  extraArgs?: string[];
}

function withExtra(args: string[], extra: string[] | undefined): string[] {
  if (!extra?.length) return args;
  const i = args.indexOf("--");
  return [...args.slice(0, i), ...extra, ...args.slice(i)];
}

/** env + token for one ssh process (null = BatchMode, no prompts: none wanted, or the bridge failed). */
async function askpassSpawn(options: SshRunOptions | undefined): Promise<AskpassSpawn | null> {
  if (!options?.askpass) return null;
  try {
    return await options.askpass.spawn();
  } catch {
    return null;
  }
}

/** A deadline that moves while the user is answering a prompt (counted again from the answer). */
function deadline(timeoutMs: number, askpass: AskpassSession | null | undefined): () => boolean {
  let until = Date.now() + timeoutMs;
  return () => {
    const now = Date.now();
    if (askpass) until = Math.max(until, (askpass.waiting ? now : askpass.lastAnswerAt) + timeoutMs);
    return now > until;
  };
}

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
export async function runSsh(target: SshTarget, command: string, timeoutMs = 30_000, options?: SshRunOptions): Promise<ExecResult> {
  const ask = options?.askpass ? await askpassSpawn(options) : null;
  return new Promise<ExecResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      // Detached on POSIX with a prompt: no controlling terminal, so ssh can only ask through askpass.
      child = spawn(resolveSshBinary(), withExtra(execArgs(target, command, !!ask), options?.extraArgs), {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        ...(ask ? { env: ask.env, detached: process.platform !== "win32" } : {}),
      });
    } catch (error) {
      ask?.done();
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
    const expired = deadline(timeoutMs, options?.askpass);
    const timer = setInterval(() => {
      if (!expired()) return;
      clearInterval(timer);
      killTree(child);
      reject(new SshFailure({ code: "timeout", detail: `no answer within ${Math.round(timeoutMs / 1000)} s` }));
    }, Math.min(250, timeoutMs));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearInterval(timer);
      ask?.done();
      reject(new SshFailure({ code: error.code === "ENOENT" ? "noSsh" : "exited", detail: error.message }));
    });
    child.on("close", (code) => {
      clearInterval(timer);
      ask?.done();
      resolve({ code, stdout, stderr });
    });
  });
}

/** The host behind an address as ssh would resolve it (`ssh -G`: reads the config, opens no connection). */
export function resolveSshHost(target: SshTarget): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = "";
    let child: ChildProcess;
    try {
      child = spawn(resolveSshBinary(), ["-G", ...(target.port ? ["-p", String(target.port)] : []), "--", target.destination], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    child.stdout!.on("data", (d: Buffer) => {
      if (stdout.length < 64 * 1024) stdout += d.toString("utf8");
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? parseSshConfigDump(stdout) : null));
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

  /** Resolves once the writes begun so far have ended. */
  saved(): Promise<void> {
    return this.saving;
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

export function isOurTunnelCommandLine(cmdline: string): boolean {
  return /ssh/i.test(cmdline) && cmdline.includes("ExitOnForwardFailure=yes") && cmdline.includes("ServerAliveCountMax=3") && /-L\s+127\.0\.0\.1:\d+:127\.0\.0\.1:\d+/.test(cmdline);
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
  return isOurTunnelCommandLine(cmdline);
}

export interface SshTunnelOptions {
  targets: SshTarget[];
  remotePort: number;
  pids: TunnelPidFile;
  onChange(view: TunnelView): void;
  /** How long one attempt may take to come up before it is killed and retried (paused while a prompt is open). */
  readyTimeoutMs?: number;
  /** Prompts for this connection (owned by the tunnel: closed by stop()). */
  askpass?: AskpassSession | null;
  /** Tests only: extra ssh options. */
  extraArgs?: string[];
  /**
   * Several routes: does a better route's forward at `port` reach this same host? null = yes.
   * Absent: no probing, the tunnel only moves when a route fails.
   */
  verifyRoute?(port: number, target: string): Promise<SshErrorView | null>;
  /** The tunnel moved to a better route; new connections already go there. */
  onRouteSwitched?(): void;
}

/** A better route being tried: never a prompt (BatchMode), nothing visible until it has proved itself. */
interface RouteCandidate {
  child: ChildProcess;
  port: number;
  index: number;
  stderr: string;
  closed: boolean;
  code: number | null;
}

/** What the tunnel remembers per route between probes. */
interface RouteMemory {
  /** No probe before this epoch ms (refused us, or kept failing right after a switch). */
  notBefore: number;
  /** When we switched to it (null: not switched to / already judged). */
  switchedAt: number | null;
  flaps: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remote>` with readiness detection (the local port starts
 * accepting) and automatic reconnect with backoff (shared/hosts `tunnelReduce`). The local port is
 * kept across reconnects so the daemon client — and its event-feed cursors — survive a drop.
 *
 * With several routes the shown port is a `TunnelFront` and each ssh forwards to a private port behind
 * it. A failed route moves to the next one at once; the backoff waits only between whole passes. On a
 * lower route the better ones are tried in the background without prompts; one that stays up and
 * answers as this host takes the new connections. The old ssh keeps running until its last
 * connection ends, so requests in flight finish on the route they were sent on.
 */
export class SshTunnel {
  forwardFailure(): SshErrorView | null {
    return /administratively prohibited|port forwarding (?:is )?(?:disabled|not permitted)|forwarding disabled/i.test(this.stderr)
      ? classifySshFailure(null, this.stderr, "tunnel") : null;
  }
  private view: TunnelView = initialTunnel();
  private child: ChildProcess | null = null;
  private stopped = true;
  private retryTimer: NodeJS.Timeout | null = null;
  private stderr = "";
  private targetIndex = 0;
  private rejected: SshErrorView | null = null;
  private readonly multi: boolean;
  private front: TunnelFront | null = null;
  /** The private port of the current ssh (several routes only). */
  private backendPort: number | null = null;
  /** Failures in the current pass over the routes; reset when a connection proved stable. */
  private passFailures = 0;
  private passOnNetwork = false;
  private passes = 0;
  private readonly routes: RouteMemory[];
  private candidate: RouteCandidate | null = null;
  /** Former routes still carrying connections, by private port. */
  private readonly draining = new Map<number, ChildProcess>();
  private probeTimer: NodeJS.Timeout | null = null;
  /** Bumped to abandon a probe in progress. */
  private probeRun = 0;
  private probeRounds = 0;

  constructor(private readonly options: SshTunnelOptions) {
    this.multi = options.targets.length > 1;
    this.routes = options.targets.map(() => ({ notBefore: 0, switchedAt: null, flaps: 0 }));
  }

  get state(): TunnelView {
    return this.view;
  }

  /** Private loopback ports of this tunnel's ssh processes: control ports like the shown one. */
  backendPorts(): number[] {
    return [...(this.backendPort !== null ? [this.backendPort] : []), ...(this.candidate ? [this.candidate.port] : []), ...this.draining.keys()];
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.targetIndex = 0;
    void this.attempt();
  }

  /** Retry now (manual "reconnect", or the daemon noticed the drop first). */
  reconnectNow(): void {
    if (this.stopped || this.child) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.targetIndex = 0;
    this.passFailures = 0;
    this.passOnNetwork = false;
    this.options.askpass?.reset();
    void this.attempt();
  }

  rejectReady(error: SshErrorView): void {
    if (!this.child || this.view.status !== "up") return;
    this.rejected = error;
    killTree(this.child);
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.cancelProbe();
    const child = this.child;
    this.child = null;
    this.backendPort = null;
    for (const old of [...(child ? [child] : []), ...this.draining.values()]) {
      killTree(old);
      this.options.pids.remove(old.pid);
    }
    this.draining.clear();
    this.front?.close();
    this.front = null;
    this.options.askpass?.close();
    this.dispatch({ type: "stop" });
  }

  private dispatch(event: TunnelEvent): void {
    this.view = tunnelReduce(this.view, event);
    this.options.onChange(this.view);
  }

  /** Limits for one route's attempt; single-route hosts keep the plain defaults. */
  private timing(): TunnelTiming | undefined {
    if (!this.multi) return undefined;
    return { connectTimeoutSec: this.longPass() ? 15 : ROUTE_CONNECT_TIMEOUT_SEC, aliveIntervalSec: ROUTE_ALIVE_INTERVAL_SEC };
  }

  private longPass(): boolean {
    return this.passes % 3 === 2;
  }

  private async attempt(): Promise<void> {
    if (this.stopped || this.child) return;
    let shown: number;
    let port: number;
    if (this.multi) {
      this.front ??= new TunnelFront((drained) => this.retire(drained));
      shown = await this.front.listen(this.view.localPort).catch(() => 0);
      if (this.stopped || this.child) return;
      port = await freeLocalPort().catch(() => 0);
    } else {
      const previous = this.view.localPort;
      port = previous !== null && (await portFree(previous)) ? previous : await freeLocalPort().catch(() => 0);
      shown = port;
    }
    if (this.stopped || this.child) return;
    if (!port || !shown) {
      this.fail({ code: "forward", detail: "no free local port" });
      return;
    }
    this.stderr = "";
    this.rejected = null;
    const target = this.options.targets[this.targetIndex]!;
    let ask: AskpassSpawn | null = null;
    if (this.options.askpass) {
      ask = await askpassSpawn(this.options);
      if (this.stopped || this.child) {
        ask?.done();
        return;
      }
    }
    let child: ChildProcess;
    try {
      child = spawn(resolveSshBinary(), withExtra(tunnelArgs(target, port, this.options.remotePort, !!ask, this.timing()), this.options.extraArgs), {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
        ...(ask ? { env: ask.env } : {}),
      });
    } catch (error) {
      ask?.done();
      this.fail({ code: "noSsh", detail: String(error) });
      return;
    }
    this.child = child;
    this.options.pids.add(child.pid);
    this.dispatch({ type: "spawn", localPort: shown, target: formatSshTarget(target), ...(this.multi ? { routeIndex: this.targetIndex } : {}) });
    this.watch(child, ask);
    // Ready = ssh accepts on the local port (it binds only after authentication).
    const expired = deadline(this.options.readyTimeoutMs ?? (this.multi && !this.longPass() ? ROUTE_READY_TIMEOUT_MS : 30_000), this.options.askpass);
    while (this.child === child && !this.stopped) {
      if (await portListening(port, 800)) {
        if (this.child === child && !this.stopped) {
          if (this.multi) {
            this.backendPort = port;
            this.front?.use(port);
          }
          this.dispatch({ type: "ready", now: Date.now() });
          this.probeRounds = 0;
          this.scheduleProbe();
        }
        return;
      }
      if (expired()) {
        this.stderr += "\ntimed out waiting for the port forward";
        killTree(child);
        return;
      }
      await pause(250);
    }
  }

  /** Follows one ssh process, whichever role it has by the time it ends (candidate, current, draining). */
  private watch(child: ChildProcess, ask: AskpassSpawn | null): void {
    child.stderr!.on("data", (d: Buffer) => {
      if (this.candidate?.child === child) this.candidate.stderr = (this.candidate.stderr + d.toString("utf8")).slice(-8192);
      else if (this.child === child) this.stderr = (this.stderr + d.toString("utf8")).slice(-8192);
    });
    let spawnError: NodeJS.ErrnoException | null = null;
    child.on("error", (error: NodeJS.ErrnoException) => (spawnError = error));
    child.on("close", (code) => {
      ask?.done();
      this.options.pids.remove(child.pid);
      for (const [port, old] of this.draining) if (old === child) this.draining.delete(port);
      if (this.candidate?.child === child) {
        this.candidate.closed = true;
        this.candidate.code = code;
        return;
      }
      if (this.child !== child) return;
      this.child = null;
      this.backendPort = null;
      this.front?.use(null);
      this.cancelProbe();
      if (this.stopped) return;
      const err = spawnError as NodeJS.ErrnoException | null;
      this.judgeLostRoute();
      this.fail(this.rejected ?? (err?.code === "ENOENT" ? { code: "noSsh", detail: err.message } : classifySshFailure(code, this.stderr, "tunnel")));
    });
  }

  /** A route we switched to and lost soon after is not tried again for a while, longer each time. */
  private judgeLostRoute(): void {
    const route = this.routes[this.targetIndex]!;
    if (route.switchedAt === null) return;
    const now = Date.now();
    route.flaps = now - route.switchedAt < ROUTE_FLAP_WINDOW_MS ? route.flaps + 1 : 0;
    route.switchedAt = null;
    if (route.flaps > 0) route.notBefore = now + Math.min(ROUTE_FLAP_BASE_MS * 2 ** (route.flaps - 1), ROUTE_FLAP_MAX_MS);
  }

  /** The route failed: the next one comes right away, the backoff waits only between whole passes. */
  private fail(error: SshErrorView): void {
    const count = this.options.targets.length;
    const now = Date.now();
    if (this.view.upSince !== null && now - this.view.upSince >= TUNNEL_STABLE_MS) {
      this.passFailures = 0;
      this.passOnNetwork = false;
      this.passes = 0;
    }
    this.passFailures++;
    this.passOnNetwork ||= !isPermanentSshError(error.code);
    this.targetIndex = (this.targetIndex + 1) % count;
    const passDone = this.passFailures >= count;
    // Refused everywhere needs the user. Any network failure can heal by itself (a VPN comes back).
    const keepTrying = !passDone || this.passOnNetwork;
    this.dispatch({ type: "exit", error, now, nextRoute: !passDone, exhausted: passDone && this.multi && this.passOnNetwork, ...(this.multi ? { maxBackoffMs: ROUTE_MAX_BACKOFF_MS } : {}) });
    if (passDone) {
      this.passFailures = 0;
      this.passOnNetwork = false;
      this.passes++;
    }
    if (!keepTrying) return;
    const retryAt = this.view.retryAt ?? now + (passDone ? Math.min(backoffMs(this.view.attempt), ROUTE_MAX_BACKOFF_MS) : ROUTE_NEXT_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attempt();
    }, Math.max(0, retryAt - now));
  }

  // ---------- back to a better route ----------

  private scheduleProbe(): void {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
    if (!this.options.verifyRoute || this.targetIndex === 0 || this.stopped) return;
    const wait = this.probeRounds < ROUTE_PROBE_SLOW_AFTER_ROUNDS ? ROUTE_PROBE_INTERVAL_MS : ROUTE_PROBE_SLOW_INTERVAL_MS;
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      void this.probeRound();
    }, wait);
    this.probeTimer.unref?.();
  }

  private cancelProbe(): void {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
    this.probeRun++;
    this.dropCandidate();
  }

  private dropCandidate(): void {
    const candidate = this.candidate;
    this.candidate = null;
    if (!candidate) return;
    if (!candidate.closed) killTree(candidate.child);
    this.options.pids.remove(candidate.child.pid);
  }

  private async probeRound(): Promise<void> {
    const run = ++this.probeRun;
    const live = () => run === this.probeRun && !this.stopped && this.child !== null && this.view.status === "up";
    for (let index = 0; index < this.targetIndex; index++) {
      if (!live()) return;
      if (Date.now() < this.routes[index]!.notBefore) continue;
      if (await this.probe(index, live)) {
        if (live()) this.switchToCandidate();
        return;
      }
      if (run !== this.probeRun) return;
      this.dropCandidate();
    }
    if (!live()) return;
    this.probeRounds++;
    this.scheduleProbe();
  }

  /** One better route: true once it stayed up and kept answering as this host. */
  private async probe(index: number, live: () => boolean): Promise<boolean> {
    const port = await freeLocalPort().catch(() => 0);
    if (!port || !live()) return false;
    const target = this.options.targets[index]!;
    let child: ChildProcess;
    try {
      // interactive = false: BatchMode, ssh never asks; a route that needs an answer just fails here.
      child = spawn(resolveSshBinary(), withExtra(tunnelArgs(target, port, this.options.remotePort, false, { connectTimeoutSec: ROUTE_CONNECT_TIMEOUT_SEC, aliveIntervalSec: ROUTE_ALIVE_INTERVAL_SEC }), this.options.extraArgs), {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch {
      return false;
    }
    const candidate: RouteCandidate = { child, port, index, stderr: "", closed: false, code: null };
    this.candidate = candidate;
    this.options.pids.add(child.pid);
    this.watch(child, null);
    const current = () => this.candidate === candidate && !candidate.closed && live();
    const refused = () => {
      this.routes[index]!.notBefore = Date.now() + ROUTE_REFUSED_RETRY_MS;
      return false;
    };
    const expired = deadline(ROUTE_READY_TIMEOUT_MS, null);
    while (!(await portListening(port, 800))) {
      if (candidate.closed) return isPermanentSshError(classifySshFailure(candidate.code, candidate.stderr, "tunnel").code) ? refused() : false;
      if (!current() || expired()) return false;
      await pause(250);
    }
    // Another cutex or a rejected token stays that way; a daemon that did not answer may next time.
    const verified = async () => {
      const problem = await this.options.verifyRoute!(port, formatSshTarget(target)).catch((error: unknown): SshErrorView => ({ code: "remoteDaemon", detail: String(error) }));
      if (problem && (problem.code === "hostMismatch" || isPermanentSshError(problem.code))) refused();
      return !problem;
    };
    if (!current() || !(await verified())) return false;
    await pause(ROUTE_HOLD_MS);
    return current() && (await verified()) && current();
  }

  /** New connections go to the candidate now; the old ssh stays until its connections have ended. */
  private switchToCandidate(): void {
    const candidate = this.candidate!;
    const old = this.child;
    const oldPort = this.backendPort;
    this.candidate = null;
    this.child = candidate.child;
    this.backendPort = candidate.port;
    this.stderr = candidate.stderr;
    this.targetIndex = candidate.index;
    this.rejected = null;
    this.passFailures = 0;
    this.passOnNetwork = false;
    this.passes = 0;
    this.probeRounds = 0;
    this.routes[candidate.index]!.switchedAt = Date.now();
    this.front?.use(candidate.port);
    if (old && oldPort !== null) {
      this.draining.set(oldPort, old);
      if (!this.front?.connections(oldPort)) this.retire(oldPort);
    }
    this.dispatch({ type: "switch", target: formatSshTarget(this.options.targets[candidate.index]!), routeIndex: candidate.index, now: Date.now() });
    this.options.onRouteSwitched?.();
    this.scheduleProbe();
  }

  /** A former route has no connections left. */
  private retire(port: number): void {
    const old = this.draining.get(port);
    if (!old) return;
    this.draining.delete(port);
    killTree(old);
    this.options.pids.remove(old.pid);
  }
}

/**
 * A short-lived forward for one-off checks (test connection / revoke on a host that is not
 * active). Resolves once the port accepts; `close()` kills it.
 */
export async function openTemporaryTunnel(target: SshTarget, remotePort: number, pids: TunnelPidFile, timeoutMs = 25_000, options?: SshRunOptions): Promise<{ port: number; close(): void; failure?(): SshErrorView | null }> {
  const port = await freeLocalPort();
  const ask = options?.askpass ? await askpassSpawn(options) : null;
  let child: ChildProcess;
  try {
    child = spawn(resolveSshBinary(), withExtra(tunnelArgs(target, port, remotePort, !!ask), options?.extraArgs), {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      ...(ask ? { env: ask.env } : {}),
    });
  } catch (error) {
    ask?.done();
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
    ask?.done();
    pids.remove(child.pid);
  });
  const expired = deadline(timeoutMs, options?.askpass);
  for (;;) {
    if (exited) {
      const e = exited as { code: number | null; error: NodeJS.ErrnoException | null };
      throw new SshFailure(e.error?.code === "ENOENT" ? { code: "noSsh", detail: e.error.message } : classifySshFailure(e.code, stderr, "tunnel"));
    }
    if (await portListening(port, 800)) return { port, close, failure: () => /administratively prohibited|port forwarding (?:is )?(?:disabled|not permitted)|forwarding disabled/i.test(stderr) ? classifySshFailure(null, stderr, "tunnel") : null };
    if (expired()) {
      close();
      throw new SshFailure({ code: "timeout", detail: classifySshFailure(null, stderr, "tunnel").detail || "timed out waiting for the port forward" });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
