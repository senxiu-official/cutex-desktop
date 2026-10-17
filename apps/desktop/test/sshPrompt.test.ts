import { describe, expect, it } from "vitest";
import { classifySshPrompt } from "../src/shared/sshPrompt";
import { execArgs, tunnelArgs } from "../src/shared/hosts";

describe("ssh prompt classification", () => {
  it("key passphrase (also the retry wording)", () => {
    expect(classifySshPrompt("Enter passphrase for key '/home/me/.ssh/id_ed25519': ")).toMatchObject({ kind: "passphrase", secret: true });
    expect(classifySshPrompt("Bad passphrase, try again for /home/me/.ssh/id_ed25519: ")).toMatchObject({ kind: "passphrase", secret: true });
  });

  it("password and keyboard-interactive", () => {
    expect(classifySshPrompt("me@example.org's password: ")).toMatchObject({ kind: "password", secret: true });
    expect(classifySshPrompt("(me@example.org) Password: ")).toMatchObject({ kind: "password", secret: true });
    expect(classifySshPrompt("Verification code: ")).toMatchObject({ kind: "text", secret: true });
  });

  it("unknown host key: fingerprint and key type", () => {
    const msg = "The authenticity of host '[127.0.0.1]:2222 ([127.0.0.1]:2222)' can't be established.\nED25519 key fingerprint is SHA256:Xq3M2b8u1mZ0eV7tq0n8yJm1lI0p9yX4cQm7a2Kc9sE.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ";
    expect(classifySshPrompt(msg)).toMatchObject({ kind: "hostKey", secret: false, keyType: "ED25519", fingerprint: "SHA256:Xq3M2b8u1mZ0eV7tq0n8yJm1lI0p9yX4cQm7a2Kc9sE" });
  });

  it("askpass hints: confirm and notice", () => {
    expect(classifySshPrompt("Allow use of key /x?", "confirm")).toMatchObject({ kind: "confirm", secret: false });
    expect(classifySshPrompt("Confirm user presence for key ED25519-SK SHA256:abc", "none")).toMatchObject({ kind: "notice", secret: false });
  });
});

describe("interactive ssh arguments", () => {
  it("BatchMode only without a prompt bridge", () => {
    const t = { destination: "me@example.org", port: 2222 };
    expect(execArgs(t, "true")).toContain("BatchMode=yes");
    expect(execArgs(t, "true", true)).toContain("BatchMode=no");
    expect(execArgs(t, "true", true)).not.toContain("BatchMode=yes");
    expect(tunnelArgs(t, 1, 2, true)).toContain("BatchMode=no");
    // A typed user@host:port and an alias take the same path: no IdentitiesOnly / IdentityFile /
    // config override, so ~/.ssh/config, ssh-agent and the default keys apply as in a terminal.
    for (const args of [execArgs(t, "true", true), execArgs({ destination: "alias", port: null }, "true", true)]) {
      expect(args.join(" ")).not.toMatch(/IdentitiesOnly|IdentityFile|IdentityAgent|-F /);
    }
    expect(execArgs(t, "true", true).slice(-3)).toEqual(["--", "me@example.org", "true"]);
  });
});
