import { describe, expect, it } from "vitest";
import type { InboundMailStatus, NciVerificationStatus } from "../src/shared/remoteJobs";
import { authorizedKeysFor, currentNciStep, decodeBase64, hasNciKey, mailboxReady, nciSteps, normalizeGadiHome, sshFingerprint, type NciSetupInput } from "../src/renderer/src/lib/nciSetup";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey";
const TEMPLATE = `restrict,command="/usr/bin/python3 -I <GADI_HOME>/.cutex/nci-qstat-only.py" ${KEY} cutex-qstat`;

function nci(extra: Partial<NciVerificationStatus> = {}): NciVerificationStatus {
  return { configured: false, enabled: false, host: "gadi.nci.org.au", hostKeys: [], privateKeyStored: false, publicKey: null, ...extra } as NciVerificationStatus;
}
function mail(extra: Partial<InboundMailStatus> = {}): InboundMailStatus {
  return { configured: false, enabled: false, sources: [], lastConnectedAt: null, errorCode: null, ...extra } as InboundMailStatus;
}
const states = (input: Partial<NciSetupInput>) =>
  Object.fromEntries(nciSteps({ mail: true, verification: true, keygen: true, mailStatus: mail(), nciStatus: nci(), ...input }).map((s) => [s.id, s.state]));

describe("NCI setup guide steps", () => {
  it("starts with everything to do (Gadi waits for the key, enable waits for the rest)", () => {
    expect(states({})).toEqual({ key: "todo", gadi: "blocked", hostKeys: "todo", username: "todo", mailbox: "todo", enable: "blocked" });
  });

  it("loading while a status is still undefined", () => {
    const s = states({ mailStatus: undefined, nciStatus: undefined });
    expect(s).toEqual({ key: "loading", gadi: "loading", hostKeys: "loading", username: "loading", mailbox: "loading", enable: "loading" });
  });

  it("a pending generated key is step ① done; Gadi becomes the owner's manual step", () => {
    const pending = nci({ pendingGeneratedKey: true, publicKey: `${KEY} cutex-qstat`, keySource: "generated" });
    expect(hasNciKey(pending)).toBe(true);
    expect(states({ nciStatus: pending })).toMatchObject({ key: "done", gadi: "manual", hostKeys: "todo", username: "todo" });
    expect(currentNciStep(nciSteps({ mail: true, verification: true, keygen: true, mailStatus: mail(), nciStatus: pending }))).toBe("gadi");
  });

  it("everything done after a successful check and a connected mailbox", () => {
    const done = nci({ configured: true, enabled: true, privateKeyStored: true, publicKey: KEY, username: "ab1234", hostKeys: [KEY], lastSuccessAt: 100 });
    const box = mail({ configured: true, enabled: true, sources: ["nci"], lastConnectedAt: 50 });
    expect(mailboxReady(box)).toBe(true);
    const steps = nciSteps({ mail: true, verification: true, keygen: true, mailStatus: box, nciStatus: done });
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(currentNciStep(steps)).toBeNull();
  });

  it("the check off (or the mailbox never connected) leaves step ⑥ to do", () => {
    const off = nci({ configured: true, enabled: false, privateKeyStored: true, publicKey: KEY, username: "ab1234", hostKeys: [KEY] });
    const box = mail({ configured: true, enabled: true, sources: ["nci"], lastConnectedAt: 50 });
    expect(states({ nciStatus: off, mailStatus: box }).enable).toBe("todo");
    const on = { ...off, enabled: true };
    expect(states({ nciStatus: on, mailStatus: { ...box, lastConnectedAt: null } }).enable).toBe("todo");
    expect(states({ nciStatus: on, mailStatus: { ...box, sources: [] } })).toMatchObject({ mailbox: "todo", enable: "blocked" });
  });

  it("the mailbox is optional: no mailbox and the check on is step ⑥ done, and the guide does not hold on ⑤", () => {
    const on = nci({ configured: true, enabled: true, privateKeyStored: true, publicKey: KEY, username: "ab1234", hostKeys: [KEY], lastSuccessAt: 100 });
    const steps = nciSteps({ mail: true, verification: true, keygen: true, mailStatus: mail(), nciStatus: on });
    expect(Object.fromEntries(steps.map((s) => [s.id, s.state]))).toMatchObject({ mailbox: "todo", enable: "done" });
    expect(currentNciStep(steps)).toBeNull();
    // Check off and no mailbox: ⑥ is to do (not blocked by ⑤).
    expect(states({ nciStatus: { ...on, enabled: false } }).enable).toBe("todo");
    // A configured mailbox with an error still keeps ⑥ open.
    const broken = mail({ configured: true, enabled: true, sources: ["nci"], lastConnectedAt: 5, errorCode: "mail_authentication_failed" });
    expect(states({ nciStatus: on, mailStatus: broken }).enable).toBe("todo");
  });

  it("a cutex without nci-verification: Gadi steps unsupported, the mailbox still works", () => {
    const s = states({ verification: false, keygen: false, nciStatus: null, mailStatus: mail({ configured: true, enabled: true, sources: ["nci"], lastConnectedAt: 1 }) });
    expect(s).toEqual({ key: "unsupported", gadi: "unsupported", hostKeys: "unsupported", username: "unsupported", mailbox: "done", enable: "done" });
    expect(states({ mail: false, verification: false, keygen: false }).enable).toBe("unsupported");
  });
});

describe("authorized_keys line", () => {
  it("fills the Gadi home into cutex's template", () => {
    const status = { authorizedKeysTemplate: TEMPLATE, gadiHomePlaceholder: "<GADI_HOME>", publicKey: KEY };
    expect(authorizedKeysFor(status, " /home/123/ab1234/ ")).toBe(`restrict,command="/usr/bin/python3 -I /home/123/ab1234/.cutex/nci-qstat-only.py" ${KEY} cutex-qstat`);
    expect(authorizedKeysFor(status, "")).toBeNull();
    expect(authorizedKeysFor(null, "/home/123/ab1234")).toBeNull();
  });

  it("builds it from the public key on an older cutex (no template)", () => {
    expect(authorizedKeysFor({ publicKey: KEY }, "/home/1/x")).toBe(`restrict,command="/usr/bin/python3 -I /home/1/x/.cutex/nci-qstat-only.py" ${KEY} cutex-qstat`);
    expect(authorizedKeysFor({ publicKey: null }, "/home/1/x")).toBeNull();
  });

  it("only accepts a plain absolute home (it goes inside command=\"…\")", () => {
    expect(normalizeGadiHome("/home/123/ab1234")).toBe("/home/123/ab1234");
    for (const bad of ["home/123", "~/x", "/home/a b", '/home/"x', "/home/../etc", "/home//x", "/home/$USER"]) expect(normalizeGadiHome(bad)).toBeNull();
  });
});

describe("SSH fingerprints", () => {
  it("decodes base64 with or without padding and refuses junk", () => {
    expect(Array.from(decodeBase64("YWJj")!)).toEqual([97, 98, 99]);
    expect(Array.from(decodeBase64("YWI")!)).toEqual([97, 98]);
    expect(decodeBase64("not base64!")).toBeNull();
  });

  it("matches ssh-keygen -l (SHA256 of the blob, unpadded base64)", async () => {
    // Same vector as cutex's nci_verification test: SHA256("abc").
    expect(await sshFingerprint("ssh-ed25519 YWJj")).toBe("SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0");
    expect(await sshFingerprint("YWJj")).toBe("SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0");
    expect(await sshFingerprint("ssh-ed25519 !!")).toBeNull();
  });
});
