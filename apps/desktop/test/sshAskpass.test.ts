// The SSH_ASKPASS bridge without ssh: the launcher is run the way ssh runs it (question as the only
// argument, the env of `session.spawn()`), with this Node as the helper's runtime.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askpassLauncher, SshAskpass, type AskpassSpawn } from "../src/main/sshAskpass";
import type { SshPromptView } from "../src/shared/sshPrompt";

const posix = process.platform !== "win32";

function runHelper(ask: AskpassSpawn, prompt: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(ask.env.SSH_ASKPASS!, [prompt], { env: { ...ask.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

async function until<T>(get: () => T | undefined, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("askpass launcher", () => {
  it("quotes paths for sh and cmd", () => {
    expect(askpassLauncher("linux", "/opt/My App/cutex", "/h/it's/helper.cjs").body).toBe(`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/opt/My App/cutex' '/h/it'\\''s/helper.cjs' "$@"\n`);
    const win = askpassLauncher("win32", "C:\\Apps\\Cutex 100%\\cutex.exe", "D:\\Data\\Cutex\\ssh-askpass\\askpass-helper.cjs");
    expect(win.name).toBe("askpass.cmd");
    expect(win.body).toContain(`"C:\\Apps\\Cutex 100%%\\cutex.exe" "D:\\Data\\Cutex\\ssh-askpass\\askpass-helper.cjs" %*`);
    expect(win.body).toContain("set ELECTRON_RUN_AS_NODE=1");
  });
});

describe.skipIf(!posix)("askpass bridge", () => {
  let dir: string;
  let broker: SshAskpass;
  let seen: SshPromptView[][];
  const latest = () => seen[seen.length - 1] ?? [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cutex-askpass-test-"));
    seen = [];
    broker = new SshAskpass({ dir, onChange: (p) => seen.push(p), execPath: process.execPath });
  });
  afterEach(() => {
    broker.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("forwards the question and returns the answer to that ssh process only", async () => {
    const session = broker.session("me@example.org:2222");
    const ask = await session.spawn();
    expect(ask.env.SSH_ASKPASS_REQUIRE).toBe("force");
    expect(ask.env.CUTEX_ASKPASS_TOKEN).toMatch(/^[0-9a-f]{48}$/);
    const run = runHelper(ask, "Enter passphrase for key '/tmp/k': ");
    const prompt = await until(() => latest()[0]);
    expect(prompt).toMatchObject({ kind: "passphrase", target: "me@example.org:2222", secret: true });
    expect(JSON.stringify(seen)).not.toContain("s3cret");
    expect(session.waiting).toBe(true);
    expect(broker.answer(prompt.id, "s3cret")).toBe(true);
    expect(await run).toEqual({ code: 0, stdout: "s3cret\n" });
    expect(latest()).toEqual([]);
    // Answered views never carry the answer.
    expect(JSON.stringify(seen)).not.toContain("s3cret");
    expect(session.waiting).toBe(false);
    session.close();
  });

  it("reuses a secret for a later ssh process of the same operation, asks again when the same process repeats", async () => {
    const session = broker.session("h");
    const q = "Enter passphrase for key '/tmp/k': ";
    const first = await session.spawn();
    const run1 = runHelper(first, q);
    broker.answer((await until(() => latest()[0])).id, "pw");
    expect((await run1).stdout).toBe("pw\n");
    // Another ssh process (pairing makes several round trips): no new question.
    const second = await session.spawn();
    const before = seen.length;
    expect(await runHelper(second, q)).toEqual({ code: 0, stdout: "pw\n" });
    expect(seen.length).toBe(before);
    // The same process asks again: the cached answer was wrong → the user is asked.
    const run3 = runHelper(second, q);
    const again = await until(() => latest()[0]);
    broker.answer(again.id, "pw2");
    expect((await run3).stdout).toBe("pw2\n");
    // A new operation knows nothing.
    session.close();
    const other = await broker.session("h").spawn();
    const run4 = runHelper(other, q);
    const fresh = await until(() => latest()[0]);
    broker.answer(fresh.id, null);
    expect((await run4).code).toBe(1);
  });

  it("cancel fails this question and every later one of the operation until reset", async () => {
    const session = broker.session("h");
    const ask = await session.spawn();
    const run = runHelper(ask, "me@h's password: ");
    broker.answer((await until(() => latest()[0])).id, null);
    expect(await run).toEqual({ code: 1, stdout: "" });
    const before = seen.length;
    expect((await runHelper(ask, "me@h's password: ")).code).toBe(1);
    expect(seen.length).toBe(before);
    session.reset();
    const run2 = runHelper(ask, "me@h's password: ");
    broker.answer((await until(() => latest()[0])).id, "ok");
    expect((await run2).stdout).toBe("ok\n");
    session.close();
  });

  it("host key: yes / no go to ssh as text", async () => {
    const session = broker.session("h");
    const ask = await session.spawn();
    const msg = "The authenticity of host 'h (192.0.2.1)' can't be established.\nED25519 key fingerprint is SHA256:Xq3M2b8u1mZ0eV7tq0n8yJm1lI0p9yX4cQm7a2Kc9sE.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ";
    const run = runHelper(ask, msg);
    const p = await until(() => latest()[0]);
    expect(p).toMatchObject({ kind: "hostKey", fingerprint: "SHA256:Xq3M2b8u1mZ0eV7tq0n8yJm1lI0p9yX4cQm7a2Kc9sE", secret: false });
    broker.answer(p.id, "yes");
    expect((await run).stdout).toBe("yes\n");
    session.close();
  });

  it("confirm (SSH_ASKPASS_PROMPT=confirm): exit status is the answer; notice ends with the helper", async () => {
    const session = broker.session("h");
    const ask = await session.spawn();
    const run = runHelper(ask, "Allow use of key?", { SSH_ASKPASS_PROMPT: "confirm" });
    broker.answer((await until(() => latest()[0])).id, "no");
    expect((await run).code).toBe(1);
    const notice = spawn(ask.env.SSH_ASKPASS!, ["Confirm user presence for key"], { env: { ...ask.env, SSH_ASKPASS_PROMPT: "none" }, stdio: "ignore" });
    expect((await until(() => latest()[0])).kind).toBe("notice");
    notice.kill();
    await until(() => (latest().length === 0 ? true : undefined));
    session.close();
  });

  it("refuses questions without a live token (another local program cannot raise a prompt)", async () => {
    const session = broker.session("h");
    const ask = await session.spawn();
    const forged = { ...ask, env: { ...ask.env, CUTEX_ASKPASS_TOKEN: "0".repeat(48) } };
    expect((await runHelper(forged, "me@h's password: ")).code).toBe(1);
    ask.done();
    expect((await runHelper(ask, "me@h's password: ")).code).toBe(1);
    expect(seen.every((list) => list.length === 0)).toBe(true);
    session.close();
  });

  it("closing the session cancels its open questions", async () => {
    const session = broker.session("h");
    const ask = await session.spawn();
    const run = runHelper(ask, "me@h's password: ");
    await until(() => latest()[0]);
    session.close();
    expect((await run).code).toBe(1);
    expect(latest()).toEqual([]);
  });

  it("an unanswered question times out", async () => {
    broker.stop();
    broker = new SshAskpass({ dir, onChange: (p) => seen.push(p), execPath: process.execPath, promptTimeoutMs: 200 });
    const session = broker.session("h");
    const ask = await session.spawn();
    expect((await runHelper(ask, "me@h's password: ")).code).toBe(1);
    session.close();
  });
});
