import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cutexCandidateLabels, cutexDiscoveryCommand, issueTokenFindingCutex, parseCutexDiscovery, type RemoteRunner, type SshErrorView } from "../src/shared/hosts";

const TOKEN_JSON = JSON.stringify({ tokenId: "ct_01", label: "desktop-HOST-A", token: "secret", createdAt: "2026-10-08T00:00:00Z" });
const toError = (e: unknown): SshErrorView => ({ code: "exited", detail: String(e) });
const notFound = { code: 127, stdout: "", stderr: "bash: line 1: cutex: command not found\n" };

/** Fake ssh: `cutex …` at `installed` succeeds, other paths are "command not found"; the discovery
 *  script answers with `discovery`. Records every command. */
function fakeSsh(installed: string, discovery: string | Error): RemoteRunner & { calls: string[] } {
  const calls: string[] = [];
  const run = (async (command: string) => {
    calls.push(command);
    if (command.startsWith("sh -c ")) {
      if (discovery instanceof Error) throw discovery;
      return { code: 0, stdout: discovery, stderr: "" };
    }
    return command.startsWith(`${installed} management client-token issue`) ? { code: 0, stdout: TOKEN_JSON, stderr: "" } : notFound;
  }) as RemoteRunner & { calls: string[] };
  run.calls = calls;
  return run;
}

describe("finding cutex on the remote", () => {
  it("uses the configured path without probing when it works", async () => {
    const run = fakeSsh("cutex", "");
    const r = await issueTokenFindingCutex(run, "cutex", "desktop-HOST-A", toError);
    expect(r).toMatchObject({ ok: true, cutexPath: "cutex", token: { tokenId: "ct_01" } });
    expect(run.calls).toHaveLength(1);
  });

  it("falls back to the login shell / well-known paths and returns the absolute path (Workstation)", async () => {
    const run = fakeSsh("/home/sam/Resources/Shortcuts/cutex", "try 0\ntry 1\nfound 1 /home/sam/Resources/Shortcuts/cutex\n");
    const r = await issueTokenFindingCutex(run, "cutex", "desktop-HOST-A", toError);
    expect(r).toMatchObject({ ok: true, cutexPath: "/home/sam/Resources/Shortcuts/cutex" });
    expect(run.calls).toHaveLength(3);
    expect(run.calls[2]).toBe("/home/sam/Resources/Shortcuts/cutex management client-token issue --label desktop-HOST-A");
  });

  it("lists every place tried when nothing is found", async () => {
    const tried = [0, 1, 2, 3, 4, 5].map((i) => `try ${i}`).join("\n");
    const r = await issueTokenFindingCutex(fakeSsh("/nowhere", tried), "cutex", "x", toError);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("cutexNotFound");
    expect(r.error.tried).toEqual(cutexCandidateLabels("cutex"));
    expect(r.error.tried?.[3]).toBe("~/Resources/Shortcuts/cutex");
  });

  it("keeps the original error when the probe itself fails", async () => {
    const r = await issueTokenFindingCutex(fakeSsh("/nowhere", new Error("ssh died")), "/opt/cutex", "x", toError);
    expect(r).toMatchObject({ ok: false, error: { code: "cutexNotFound", tried: ["/opt/cutex"] } });
  });

  it("does not probe for other failures", async () => {
    const calls: string[] = [];
    const run: RemoteRunner = async (c) => (calls.push(c), { code: 2, stdout: "", stderr: "error: unrecognized subcommand 'client-token'" });
    const r = await issueTokenFindingCutex(run, "cutex", "x", toError);
    expect(r).toMatchObject({ ok: false, error: { code: "cutexTooOld" } });
    expect(calls).toHaveLength(1);
  });

  it("parses only well-formed absolute hits", () => {
    expect(parseCutexDiscovery("motd\ntry 0\nfound 0 relative/cutex\ntry 3\nfound 3 /h/cutex\n", "cutex")).toEqual({ path: "/h/cutex", tried: ["cutex", "~/Resources/Shortcuts/cutex"] });
    expect(parseCutexDiscovery("found 9 /x\n", "cutex")).toEqual({ path: null, tried: [] });
  });
});

// The script itself, against a fake home (POSIX sh only; skipped where there is none).
const sh = spawnSync("sh", ["-c", "echo ok"], { encoding: "utf8" });
const posix = process.platform !== "win32" && sh.stdout?.trim() === "ok";
describe.skipIf(!posix)("discovery script (real sh)", () => {
  const home = mkdtempSync(join(tmpdir(), "cutex-disc-"));
  afterAll(() => rmSync(home, { recursive: true, force: true }));
  const runScript = (configured: string) =>
    spawnSync("sh", ["-c", cutexDiscoveryCommand(configured).replace(/^sh -c /, "eval ")], {
      encoding: "utf8",
      env: { HOME: home, PATH: "/usr/bin:/bin", SHELL: "/bin/sh" },
    }).stdout;

  it("finds ~/Resources/Shortcuts/cutex as a symlink to a release binary, without dereferencing it", () => {
    const release = join(home, "releases", "r202");
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, "cutex"), "#!/bin/sh\n");
    chmodSync(join(release, "cutex"), 0o755);
    mkdirSync(join(home, "Resources", "Shortcuts"), { recursive: true });
    symlinkSync(join(release, "cutex"), join(home, "Resources", "Shortcuts", "cutex"));
    expect(parseCutexDiscovery(runScript("cutex"), "cutex").path).toBe(join(home, "Resources", "Shortcuts", "cutex"));
  });

  it("takes the binary inside a configured directory", () => {
    expect(parseCutexDiscovery(runScript("~/releases/r202"), "~/releases/r202").path).toBe(join(home, "releases", "r202", "cutex"));
  });
});
