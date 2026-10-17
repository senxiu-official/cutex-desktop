// Live check of the interactive SSH path with the real OpenSSH client against a throwaway sshd on
// 127.0.0.1 (own host key, own authorized_keys, an encrypted throwaway client key — all generated
// in a temp dir; never ~/.ssh). The target is typed as user@host:port, not an alias.
// Skipped unless CUTEX_SSH_IT=1 and a POSIX sshd exists.
//   CUTEX_SSH_IT=1 pnpm exec vitest run test/sshInteractive.live.test.ts
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifySshFailure, parseSshTarget, type TunnelView } from "../src/shared/hosts";
import type { SshPromptView } from "../src/shared/sshPrompt";
import { SshAskpass } from "../src/main/sshAskpass";
import { SshTunnel, TunnelPidFile, freeLocalPort, runSsh } from "../src/main/ssh";

const SSHD = ["/usr/sbin/sshd", "/usr/local/sbin/sshd", "/opt/homebrew/sbin/sshd"].find((p) => existsSync(p));
const enabled = !!process.env.CUTEX_SSH_IT && !!SSHD && process.platform !== "win32";

describe.skipIf(!enabled)("interactive ssh against a throwaway sshd", () => {
  const dir = mkdtempSync(join(tmpdir(), "cutex-ssh-ask-it-"));
  const key = join(dir, "id_ed25519");
  const knownHosts = join(dir, "known_hosts");
  const PASS = "throwaway-passphrase";
  let port = 0;
  let sshd: ChildProcess;
  let http: Server;
  let httpPort = 0;
  let prompts: SshPromptView[] = [];
  const broker = new SshAskpass({ dir: join(dir, "askpass"), onChange: (p) => (prompts = p), execPath: process.execPath });
  const target = () => parseSshTarget(`${userInfo().username}@127.0.0.1:${port}`)!;
  // Isolation only: no user config, no agent, only the throwaway key and known_hosts file. The
  // product passes none of these (it uses ~/.ssh/config, the agent and the default keys).
  const extraArgs = () => ["-F", "none", "-o", `UserKnownHostsFile=${knownHosts}`, "-o", "GlobalKnownHostsFile=/dev/null", "-o", `IdentityFile=${key}`, "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "PreferredAuthentications=publickey"];

  /** Answers questions as they come: `answers(prompt)` → text / null; records what was asked. */
  function autoAnswer(answers: (p: SshPromptView) => string | null): { asked: SshPromptView[]; stop(): void } {
    const asked: SshPromptView[] = [];
    const done = new Set<string>();
    const timer = setInterval(() => {
      for (const p of prompts) {
        if (done.has(p.id)) continue;
        done.add(p.id);
        asked.push(p);
        broker.answer(p.id, answers(p));
      }
    }, 20);
    return { asked, stop: () => clearInterval(timer) };
  }

  beforeAll(async () => {
    spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(dir, "host_ed25519")]);
    spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", PASS, "-f", key]);
    writeFileSync(join(dir, "authorized_keys"), readFileSync(`${key}.pub`));
    port = await freeLocalPort();
    writeFileSync(
      join(dir, "sshd_config"),
      [`Port ${port}`, "ListenAddress 127.0.0.1", `HostKey ${join(dir, "host_ed25519")}`, `PidFile ${join(dir, "sshd.pid")}`, `AuthorizedKeysFile ${join(dir, "authorized_keys")}`, "UsePAM no", "StrictModes no", "PasswordAuthentication no", "KbdInteractiveAuthentication no", "AllowTcpForwarding yes", "LogLevel ERROR"].join("\n") + "\n",
    );
    sshd = spawn(SSHD!, ["-D", "-e", "-f", join(dir, "sshd_config")], { stdio: ["ignore", "ignore", "pipe"] });
    for (let i = 0; i < 100; i++) {
      const { portListening } = await import("../src/main/ssh");
      if (await portListening(port, 200)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    http = createHttpServer((_req, res) => res.end("through-the-tunnel"));
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    httpPort = (http.address() as { port: number }).port;
  }, 30_000);

  afterAll(() => {
    broker.stop();
    sshd?.kill();
    http?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejecting the unknown host key fails with hostKey", async () => {
    const session = broker.session("t");
    const auto = autoAnswer(() => "no");
    const r = await runSsh(target(), "echo ok", 30_000, { askpass: session, extraArgs: extraArgs() });
    auto.stop();
    session.close();
    expect(auto.asked.map((p) => p.kind)).toEqual(["hostKey"]);
    expect(auto.asked[0]!.fingerprint).toMatch(/^SHA256:/);
    expect(classifySshFailure(r.code, r.stderr, "exec").code).toBe("hostKey");
  }, 40_000);

  it("asks for the host key and the key passphrase, then runs; a second ssh of the operation asks nothing", async () => {
    const session = broker.session("t");
    const auto = autoAnswer((p) => (p.kind === "hostKey" ? "yes" : PASS));
    const r = await runSsh(target(), "echo ok", 30_000, { askpass: session, extraArgs: extraArgs() });
    expect(auto.asked.map((p) => p.kind)).toEqual(["hostKey", "passphrase"]);
    expect(r.stdout.trim()).toBe("ok");
    const again = await runSsh(target(), "echo again", 30_000, { askpass: session, extraArgs: extraArgs() });
    expect(again.stdout.trim()).toBe("again");
    expect(auto.asked.length).toBe(2);
    auto.stop();
    session.close();
    expect(readFileSync(knownHosts, "utf8")).toContain("ssh-ed25519");
  }, 40_000);

  it("a wrong passphrase is asked again; cancel ends with an auth error", async () => {
    const session = broker.session("t");
    let n = 0;
    // OpenSSH repeats the same question after a wrong passphrase: not answered from the cache.
    const auto = autoAnswer(() => (n++ === 0 ? "wrong" : null));
    const r = await runSsh(target(), "echo ok", 30_000, { askpass: session, extraArgs: extraArgs() });
    auto.stop();
    session.close();
    expect(auto.asked.map((p) => p.kind)).toEqual(["passphrase", "passphrase"]);
    expect(classifySshFailure(r.code, r.stderr, "exec").code).toBe("auth");
  }, 40_000);

  it("the timeout waits while a question is open", async () => {
    const session = broker.session("t");
    // Answer after 2.5 s with a 1.5 s timeout: still runs.
    const started = Date.now();
    const timer = setInterval(() => {
      const p = prompts[0];
      if (p && Date.now() - started > 2500) broker.answer(p.id, PASS);
    }, 50);
    const r = await runSsh(target(), "echo slow", 1500, { askpass: session, extraArgs: extraArgs() });
    clearInterval(timer);
    session.close();
    expect(r.stdout.trim()).toBe("slow");
  }, 40_000);

  it("the port forward asks too, and a reconnect reuses the connection's answer", async () => {
    const session = broker.session("t");
    const auto = autoAnswer(() => PASS);
    const views: TunnelView[] = [];
    const tunnel = new SshTunnel({ target: target(), remotePort: httpPort, pids: new TunnelPidFile(join(dir, "pids.json")), onChange: (v) => views.push(v), askpass: session, extraArgs: extraArgs() });
    tunnel.start();
    const up = async () => {
      for (let i = 0; i < 300; i++) {
        const v = views[views.length - 1];
        if (v?.status === "up") return v;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`tunnel not up: ${JSON.stringify(views[views.length - 1])}`);
    };
    const v = await up();
    expect(await (await fetch(`http://127.0.0.1:${v.localPort}/`)).text()).toBe("through-the-tunnel");
    expect(auto.asked.length).toBe(1);
    tunnel.stop();
    expect(session.cache.size).toBe(0); // stop() closed the session
    auto.stop();
  }, 40_000);
});
