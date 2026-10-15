// Claude Science module helpers (modules/claude-science/model.ts): the cutex service an account is,
// and reading an account back from a service view.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServiceView } from "../src/shared/ipc";
import { accountOf, accountsOf, homeFor, idFromName, loginLinkCommand, quote, registerRequest, serviceCommand, shellPath, specProblems, unshellPath, type AccountSpec } from "../src/renderer/src/modules/claude-science/model";

const spec = (over: Partial<AccountSpec> = {}): AccountSpec => ({ id: "work", name: "Work", home: "~/.cs-accounts/work", binary: "~/.local/bin/claude-science", shareSsh: false, ...over });
const view = (request: ReturnType<typeof registerRequest>, over: Partial<ServiceView> = {}): ServiceView => ({
  slug: request.slug,
  displayName: request.displayName,
  host: "workstation",
  port: 24400,
  path: null,
  ownerCutexSessionId: null,
  projectId: null,
  runtime: "managed",
  createdAt: "2026-10-14T00:00:00Z",
  lastSeenAt: null,
  health: "reachable",
  url: "http://workstation:24400/",
  localUrl: "http://127.0.0.1:24400/",
  command: request.command,
  envKeys: Object.keys(request.env),
  ...over,
});
const posix = process.platform !== "win32";

describe("claude-science model", () => {
  it("quotes paths for sh and reads them back", () => {
    expect(quote("a'b")).toBe(`'a'\\''b'`);
    expect(shellPath("~")).toBe(`"$r"`);
    expect(shellPath("~/x y/'z'")).toBe(`"$r"/'x y/'\\''z'\\'''`);
    for (const p of ["~", "~/.cs-accounts/work", "/home/o/it's here", "/a'b'c"]) expect(unshellPath(shellPath(p))).toBe(p);
    expect(unshellPath("$(rm -rf /)")).toBeNull();
  });

  it("registers a managed, persistent, upstream-Host service with a login link and the account marker", () => {
    const r = registerRequest(spec({ port: 8010 }));
    expect(r).toMatchObject({ slug: "claude-science-work", displayName: "Work", runtime: "managed", lifetime: "persistent", proxyHostHeader: "upstream", port: 8010, env: { CLAUDE_SCIENCE_ACCOUNT: "work" } });
    expect(r.command).toContain(`"$cs" serve --port {port} --sandbox-port 0 --no-browser --no-auto-update`);
    expect(r.command).not.toContain("--detached");
    expect(r.loginLinkCommand).toBe(`r=$HOME; HOME="$r"/'.cs-accounts/work' exec "$r"/'.local/bin/claude-science' url`);
    expect("port" in registerRequest(spec())).toBe(false);
    expect(serviceCommand(spec({ shareSsh: true }))).toContain(`ln -s "$r/.ssh" "$h/.ssh"`);
    expect(serviceCommand(spec())).not.toContain(".ssh");
  });

  it("reads accounts back from service views and ignores other services", () => {
    const work = accountOf(view(registerRequest(spec({ shareSsh: true }))));
    expect(work).toMatchObject({ id: "work", name: "Work", home: "~/.cs-accounts/work", binary: "~/.local/bin/claude-science", shareSsh: true });
    const lab = accountOf(view(registerRequest(spec({ id: "lab", name: "Lab", home: "/srv/o'neil/lab" }))));
    expect(lab).toMatchObject({ id: "lab", home: "/srv/o'neil/lab", shareSsh: false });
    expect(accountOf(view(registerRequest(spec()), { envKeys: [] }))).toBeNull();
    expect(accountOf(view(registerRequest(spec()), { slug: "web" }))).toBeNull();
    // A changed command still lists the account, without a home / binary.
    expect(accountOf(view(registerRequest(spec()), { command: "something else" }))).toMatchObject({ id: "work", home: null, binary: null });
    expect(accountsOf([view(registerRequest(spec({ id: "b", name: "B" }))), view(registerRequest(spec({ id: "a", name: "A" })))]).map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("validates ids, paths and ports", () => {
    const none = new Set<string>();
    expect(specProblems(spec(), none)).toEqual([]);
    expect(specProblems(spec({ id: "-x" }), none)).toContain("id");
    expect(specProblems(spec({ id: "abcdefghijklm" }), none)).toContain("id");
    expect(specProblems(spec(), new Set(["work"]))).toEqual(["idTaken"]);
    expect(specProblems(spec({ name: " " }), none)).toEqual(["name"]);
    expect(specProblems(spec({ home: "relative/dir" }), none)).toEqual(["home"]);
    expect(specProblems(spec({ home: "~/../etc" }), none)).toEqual(["home"]);
    expect(specProblems(spec({ home: "/home/samuel/.claude-science-account2-home" }), none)).toEqual(["home"]);
    expect(specProblems(spec({ home: "/home/samuel/.cs-accounts/work" }), none)).toEqual([]);
    expect(specProblems(spec({ binary: "~" }), none)).toEqual(["binary"]);
    expect(specProblems(spec({ port: 80 }), none)).toEqual(["port"]);
    expect(idFromName("Work 2 (Lab)!")).toBe("work-2-lab");
    expect(idFromName("中文")).toBe("");
    expect(homeFor("~/.cs-accounts/", "x")).toBe("~/.cs-accounts/x");
  });

  it.runIf(posix && existsSync("/usr/bin/setsid"))("the command creates the home, follows a self-restarted daemon and stops it on TERM", () => {
    const dir = mkdtempSync(posix ? "/tmp/cs-" : join(tmpdir(), "cs-"));
    try {
      // A stand-in for claude-science: serve hands over to a detached successor and exits.
      const fake = join(dir, "cs");
      writeFileSync(fake, `#!/bin/sh
f="$HOME/fake.pid"
case "$1" in
  serve) sleep 30 </dev/null >/dev/null 2>&1 & echo $! > "$f"; exit 0;;
  status) if [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null; then printf '{"running":true,"pid":%s}\\n' "$(cat "$f")"; else echo '{"running":false}'; fi;;
  stop) kill "$(cat "$f")" 2>/dev/null; rm -f "$f";;
esac
`);
      chmodSync(fake, 0o755);
      const command = serviceCommand({ home: "~/h", binary: fake, shareSsh: true }).replace("{port}", "1");
      execFileSync("sh", ["-n", "-c", command]);
      const script = join(dir, "run.sh");
      // Run like cutex: own process group, HOME = the host user's home; TERM the group after 1.5 s.
      writeFileSync(join(dir, "cmd"), command);
      writeFileSync(script, `HOME='${dir}' setsid sh -c "$(cat '${dir}/cmd')" & p=$!; sleep 1.5; alive=$(kill -0 $p 2>/dev/null && echo yes); succ=$(cat '${dir}/h/fake.pid'); /bin/kill -TERM -- -$p; wait $p; echo "$alive $? $succ"`);
      const [alive, code, successor] = execFileSync("sh", [script], { encoding: "utf8" }).trim().split(" ");
      expect(alive).toBe("yes");
      expect(code).toBe("143");
      expect(existsSync(join(dir, "h"))).toBe(true);
      expect(lstatSync(join(dir, "h/.ssh")).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(dir, "h/.ssh"))).toBe(`${dir}/.ssh`);
      expect(() => process.kill(Number(successor), 0)).toThrow();
      expect(existsSync(join(dir, "h/fake.pid"))).toBe(false);
      // Too long a home stops before creating anything.
      const long = serviceCommand({ home: "~/a-home-path-that-is-way-too-long-for-it", binary: fake, shareSsh: false }).replace("{port}", "1");
      let failed = 0;
      try {
        execFileSync("sh", ["-c", long], { env: { ...process.env, HOME: dir }, stdio: "pipe" });
      } catch (e) {
        failed = (e as { status: number }).status;
      }
      expect(failed).toBe(2);
      expect(readFileSync(join(dir, "run.sh"), "utf8")).toContain("kill -TERM");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(posix)("the login link command runs the binary's url with HOME = the account home", () => {
    const dir = mkdtempSync(posix ? "/tmp/cs-" : join(tmpdir(), "cs-"));
    try {
      const fake = join(dir, "cs");
      writeFileSync(fake, `#!/bin/sh\necho "$1 $HOME"\n`);
      chmodSync(fake, 0o755);
      const out = execFileSync("sh", ["-c", loginLinkCommand({ home: "~/h", binary: fake })], { env: { ...process.env, HOME: dir }, encoding: "utf8" });
      expect(out.trim()).toBe(`url ${dir}/h`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
