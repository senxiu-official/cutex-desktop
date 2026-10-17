// SSH_ASKPASS bridge: lets the system OpenSSH client ask the user (key passphrase, password,
// keyboard-interactive questions, unknown host key) through the desktop's prompt dialog instead of
// a terminal it does not have.
//
// ssh runs the askpass program with the question as its argument; ours is a small Node script
// (run by this Electron binary as Node) that connects to a main-process socket, sends the question
// with a per-ssh-process random token (env CUTEX_ASKPASS_TOKEN, ≥ 128 bit) and prints the answer
// main sends back. Main accepts questions only for tokens of ssh processes it started itself, so
// another local program cannot raise a fake prompt. Answers stay in main: they go to that one
// helper connection and nowhere else (no log, no disk, never to the renderer). Within one
// operation (`AskpassSession`: one add / pair / test, or one host connection with its reconnects)
// an answered secret is reused for the same question from a later ssh process, so pairing (several
// ssh round trips) asks once; asked again by the same ssh process, the answer was wrong and the user
// is asked again. Closing the session forgets everything it held.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { classifySshPrompt, SSH_PROMPT_TIMEOUT_MS, type SshPromptAnswer, type SshPromptView } from "../shared/sshPrompt";

/** The helper ssh runs (plain Node, CommonJS; no app code). */
export const ASKPASS_HELPER_SOURCE = String.raw`"use strict";
// Cutex desktop SSH_ASKPASS helper (written by the app; see main/sshAskpass.ts).
const net = require("node:net");
const endpoint = process.env.CUTEX_ASKPASS_ENDPOINT;
const token = process.env.CUTEX_ASKPASS_TOKEN;
if (!endpoint || !token) process.exit(1);
let prompt = process.argv.slice(2).join(" ");
// Windows runs the .cmd launcher through cmd.exe, which ends the arguments at the first line break
// (an unknown host key question is several lines): read the full text from cmd's command line.
if (process.platform === "win32" && !/\?\s*$|:\s*$/.test(prompt)) {
  try {
    const out = require("node:child_process").execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_Process -Filter 'ProcessId=" + process.ppid + "').CommandLine"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
    const at = out.toLowerCase().lastIndexOf("askpass.cmd");
    if (at >= 0) {
      let rest = out.slice(at + "askpass.cmd".length).replace(/^"?\s*/, "").replace(/\s+$/, "");
      if (rest.endsWith('""')) rest = rest.slice(0, -2); else if (rest.endsWith('"')) rest = rest.slice(0, -1);
      if (rest.startsWith('"')) rest = rest.slice(1);
      rest = rest.replace(/\r\n/g, "\n");
      if (rest.length > prompt.length && rest.startsWith(prompt.slice(0, 20))) prompt = rest;
    }
  } catch {}
}
let done = false;
const socket = net.connect(endpoint);
let buf = "";
socket.setEncoding("utf8");
socket.on("connect", () => socket.write(JSON.stringify({ token, prompt, hint: process.env.SSH_ASKPASS_PROMPT || "" }) + "\n"));
socket.on("data", (d) => {
  buf += d;
  const i = buf.indexOf("\n");
  if (i < 0 || done) return;
  done = true;
  let msg = null;
  try { msg = JSON.parse(buf.slice(0, i)); } catch {}
  if (msg && msg.ok === true && typeof msg.answer === "string") process.stdout.write(msg.answer + "\n", () => process.exit(0));
  else process.exit(1);
});
socket.on("error", () => { if (!done) process.exit(1); });
socket.on("close", () => { if (!done) process.exit(1); });
`;

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The launcher SSH_ASKPASS points at: runs `execPath` as Node on the helper (`"$@"` = the question). */
export function askpassLauncher(platform: NodeJS.Platform, execPath: string, helper: string): { name: string; body: string } {
  if (platform === "win32") {
    const q = (p: string) => `"${p.replace(/%/g, "%%")}"`;
    return { name: "askpass.cmd", body: `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n${q(execPath)} ${q(helper)} %*\r\n` };
  }
  return { name: "askpass.sh", body: `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuote(execPath)} ${shQuote(helper)} "$@"\n` };
}

/** One line from the helper. */
interface AskpassRequest {
  token?: unknown;
  prompt?: unknown;
  hint?: unknown;
}

interface OpenPrompt {
  view: SshPromptView;
  socket: Socket;
  spawn: SpawnRecord;
  timer: NodeJS.Timeout;
}

interface SpawnRecord {
  session: AskpassSession;
  /** Questions this ssh process already got an answer for (asked again = the answer was wrong). */
  asked: Set<string>;
}

export interface AskpassSpawn {
  env: NodeJS.ProcessEnv;
  /** The ssh process ended: its token stops working. */
  done(): void;
}

export interface SshAskpassOptions {
  /** Where the helper scripts go (userData/ssh-askpass). */
  dir: string;
  /** The open questions changed (main → renderer `sshPrompts`). */
  onChange(prompts: SshPromptView[]): void;
  /** Binary that runs the helper as Node (ELECTRON_RUN_AS_NODE). Default process.execPath. */
  execPath?: string;
  platform?: NodeJS.Platform;
  promptTimeoutMs?: number;
}

export class SshAskpass {
  private server: Server | null = null;
  private starting: Promise<void> | null = null;
  private endpoint = "";
  private socketDir: string | null = null;
  private launcher = "";
  private readonly spawns = new Map<string, SpawnRecord>();
  private readonly open = new Map<string, OpenPrompt>();
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: SshAskpassOptions) {
    this.platform = options.platform ?? process.platform;
  }

  /** One operation's prompts (see the file comment). `target` is shown in the dialog. */
  session(target: string): AskpassSession {
    return new AskpassSession(this, target);
  }

  prompts(): SshPromptView[] {
    return [...this.open.values()].map((p) => p.view).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** The renderer's answer (null = cancel). False when the question is gone. */
  answer(id: string, answer: SshPromptAnswer): boolean {
    const p = typeof id === "string" ? this.open.get(id) : undefined;
    if (!p) return false;
    if (answer !== null && typeof answer !== "string") return false;
    this.finish(p, answer === null ? null : answer.replace(/[\r\n]+/g, "").slice(0, 4096));
    return true;
  }

  stop(): void {
    for (const p of [...this.open.values()]) this.finish(p, null);
    this.spawns.clear();
    this.server?.close();
    this.server = null;
    this.starting = null;
    if (this.socketDir) rmSync(this.socketDir, { recursive: true, force: true });
    this.socketDir = null;
  }

  /** @internal AskpassSession */
  async spawnFor(session: AskpassSession): Promise<AskpassSpawn> {
    await this.ensureStarted();
    const token = randomBytes(24).toString("hex");
    this.spawns.set(token, { session, asked: new Set() });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SSH_ASKPASS: this.launcher,
      // OpenSSH ≥ 8.4: always ask through SSH_ASKPASS, never a terminal. Older clients use it
      // without a tty (POSIX spawns are detached) when DISPLAY is set.
      SSH_ASKPASS_REQUIRE: "force",
      CUTEX_ASKPASS_ENDPOINT: this.endpoint,
      CUTEX_ASKPASS_TOKEN: token,
    };
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) env.DISPLAY = ":0";
    return { env, done: () => this.spawns.delete(token) };
  }

  /** @internal AskpassSession.close */
  release(session: AskpassSession): void {
    for (const [token, s] of this.spawns) if (s.session === session) this.spawns.delete(token);
    for (const p of [...this.open.values()]) if (p.spawn.session === session) this.finish(p, null);
  }

  /** @internal */
  pending(session: AskpassSession): boolean {
    for (const p of this.open.values()) if (p.spawn.session === session) return true;
    return false;
  }

  private ensureStarted(): Promise<void> {
    this.starting ??= this.startServer().catch((error: unknown) => {
      this.starting = null;
      throw error;
    });
    return this.starting;
  }

  private async startServer(): Promise<void> {
    const dir = this.options.dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const helper = join(dir, "askpass-helper.cjs");
    writeFileSync(helper, ASKPASS_HELPER_SOURCE, { mode: 0o600 });
    const launcher = askpassLauncher(this.platform, this.options.execPath ?? process.execPath, helper);
    const launcherPath = join(dir, launcher.name);
    writeFileSync(launcherPath, launcher.body, { mode: 0o700 });
    if (this.platform !== "win32") chmodSync(launcherPath, 0o700);
    this.launcher = launcherPath;
    if (this.platform === "win32") {
      this.endpoint = `\\\\.\\pipe\\cutex-askpass-${randomBytes(16).toString("hex")}`;
    } else {
      // A private (0700) dir: only this user can even reach the socket; the token does the rest.
      this.socketDir = mkdtempSync(join(tmpdir(), "cutex-askpass-"));
      this.endpoint = join(this.socketDir, "s");
    }
    const server = createServer((socket) => this.onConnection(socket));
    server.unref();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.endpoint, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
  }

  private onConnection(socket: Socket): void {
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    let buf = "";
    let handled = false;
    socket.on("data", (d: string) => {
      if (handled) return;
      buf += d;
      if (buf.length > 32 * 1024) {
        handled = true;
        socket.destroy();
        return;
      }
      const i = buf.indexOf("\n");
      if (i < 0) return;
      handled = true;
      let msg: AskpassRequest | null = null;
      try {
        msg = JSON.parse(buf.slice(0, i)) as AskpassRequest | null;
      } catch {
        // fall through
      }
      const spawn = typeof msg?.token === "string" ? this.spawns.get(msg.token) : undefined;
      if (!spawn || typeof msg?.prompt !== "string") return reply(socket, null);
      this.onQuestion(socket, spawn, msg.prompt, typeof msg.hint === "string" ? msg.hint : "");
    });
  }

  private onQuestion(socket: Socket, spawn: SpawnRecord, prompt: string, hint: string): void {
    const session = spawn.session;
    const info = classifySshPrompt(prompt, hint);
    if (info.secret) {
      const cached = session.cache.get(info.message);
      if (cached !== undefined && !spawn.asked.has(info.message)) {
        spawn.asked.add(info.message);
        return reply(socket, cached);
      }
      // The same ssh process asks again: the answer it got was wrong.
      session.cache.delete(info.message);
    }
    if (session.cancelled) return reply(socket, null);
    const id = randomBytes(12).toString("hex");
    const view: SshPromptView = { id, target: session.target, createdAt: Date.now(), ...info };
    const timer = setTimeout(() => {
      const p = this.open.get(id);
      if (p) this.finish(p, null);
    }, this.options.promptTimeoutMs ?? SSH_PROMPT_TIMEOUT_MS);
    timer.unref?.();
    const entry: OpenPrompt = { view, socket, spawn, timer };
    this.open.set(id, entry);
    // ssh gave up (killed / timed out) or a notice ended: the question is gone.
    socket.on("close", () => {
      if (this.open.get(id) !== entry) return;
      clearTimeout(timer);
      this.open.delete(id);
      this.publish();
    });
    this.publish();
  }

  private finish(p: OpenPrompt, answer: string | null): void {
    if (this.open.get(p.view.id) !== p) return;
    clearTimeout(p.timer);
    this.open.delete(p.view.id);
    const session = p.spawn.session;
    if (answer === null) {
      // Cancel: no more questions in this operation (ssh then fails with an auth error).
      if (p.view.kind !== "notice") session.cancelled = true;
    } else {
      session.lastAnswerAt = Date.now();
      if (p.view.secret) {
        session.cache.set(p.view.message, answer);
        p.spawn.asked.add(p.view.message);
      }
    }
    if (p.view.kind === "notice") p.socket.destroy();
    else if (p.view.kind === "confirm") reply(p.socket, answer === null || !/^y(es)?$/i.test(answer) ? null : "yes");
    else reply(p.socket, answer);
    this.publish();
  }

  private publish(): void {
    this.options.onChange(this.prompts());
  }
}

function reply(socket: Socket, answer: string | null): void {
  if (socket.destroyed) return;
  socket.end(`${JSON.stringify(answer === null ? { ok: false } : { ok: true, answer })}\n`);
}

/**
 * One operation's prompts: every ssh process it starts gets its own token (`spawn()`), answers are
 * shared among them (see the file comment). Cancel ends the questions until `reset()`.
 */
export class AskpassSession {
  /** @internal question → answer (secrets; memory only, wiped by close()). */
  readonly cache = new Map<string, string>();
  cancelled = false;
  lastAnswerAt = 0;
  private closed = false;

  constructor(
    private readonly owner: SshAskpass,
    readonly target: string,
  ) {}

  spawn(): Promise<AskpassSpawn> {
    if (this.closed) return Promise.reject(new Error("askpass session closed"));
    return this.owner.spawnFor(this);
  }

  /** A question of this session is waiting for the user (timeouts pause meanwhile). */
  get waiting(): boolean {
    return this.owner.pending(this);
  }

  /** A new user-initiated attempt (reconnect): ask again after a cancel. */
  reset(): void {
    this.cancelled = false;
  }

  close(): void {
    this.closed = true;
    this.cache.clear();
    this.owner.release(this);
  }
}
