import { describe, expect, it } from "vitest";
import type { InboundMailStatus } from "../src/shared/remoteJobs";
import { jobStatus } from "../src/renderer/src/lib/jobs";
import {
  canMarkExternal,
  intervalLabel,
  isExternalJob,
  mailboxDraft,
  mailPasswordRequired,
  mailToView,
  markInput,
  parseHostKeys,
  sourceLabel,
  validMailAddress,
} from "../src/renderer/src/lib/remoteJobs";

const job = { jobId: "job_1", revision: 4 };
const status = (extra: Partial<InboundMailStatus> = {}): InboundMailStatus => ({
  enabled: true,
  configured: true,
  server: "imap.gmail.com",
  port: 993,
  username: "nci.owner@gmail.com",
  mailbox: "INBOX",
  sources: ["nci"],
  lastConnectedAt: null,
  errorCode: null,
  ...extra,
});

describe("remote jobs", () => {
  it("tells external jobs from local ones; an older row without source is local", () => {
    expect(isExternalJob({})).toBe(false);
    expect(isExternalJob({ source: "local" })).toBe(false);
    expect(isExternalJob({ source: "nci" })).toBe(true);
    expect(sourceLabel("nci")).toBe("NCI");
    expect(sourceLabel("local")).toBe("");
    expect(jobStatus({ state: "registered" })).toMatchObject({ group: "queued", key: "registered" });
  });

  it("offers 手动标记 only for unfinished external jobs on a host with job-external", () => {
    expect(canMarkExternal({ source: "nci", state: "running" }, true)).toBe(true);
    expect(canMarkExternal({ source: "nci", state: "registered" }, true)).toBe(true);
    expect(canMarkExternal({ source: "nci", state: "running" }, false)).toBe(false);
    expect(canMarkExternal({ source: "nci", state: "exited", exitCode: 0 }, true)).toBe(false);
    expect(canMarkExternal({ source: "local", state: "running" }, true)).toBe(false);
  });

  it("builds the mark-external body from the dialog draft", () => {
    expect(markInput(job, { choice: "succeeded", exitCode: "", note: "" })).toEqual({ input: { jobId: "job_1", expectedRevision: 4, state: "exited", exitCode: 0 } });
    expect(markInput(job, { choice: "exitCode", exitCode: " 271 ", note: " checked qstat -x " })).toEqual({ input: { jobId: "job_1", expectedRevision: 4, state: "exited", exitCode: 271, note: "checked qstat -x" } });
    expect(markInput(job, { choice: "failed", exitCode: "3", note: "" })).toEqual({ input: { jobId: "job_1", expectedRevision: 4, state: "failed" } });
    expect(markInput(job, { choice: "cancelled", exitCode: "", note: "" })).toEqual({ input: { jobId: "job_1", expectedRevision: 4, state: "cancelled" } });
    for (const bad of ["", "-1", "1.5", "abc", "99999999999"]) expect(markInput(job, { choice: "exitCode", exitCode: bad, note: "" })).toEqual({ error: "exitCodeInvalid" });
    expect(markInput(job, { choice: "failed", exitCode: "", note: "x".repeat(2049) })).toEqual({ error: "noteTooLong" });
  });

  it("explains what address agents get", () => {
    expect(mailToView(status({ nciMailTo: "nci.owner@gmail.com", nciMailToStatus: "configured", jobServiceNotifyFile: true }))).toEqual({ address: "nci.owner@gmail.com", reason: null, jobServiceMissing: false });
    expect(mailToView(status({ nciMailTo: "nci.owner@gmail.com", nciMailToStatus: "configured", jobServiceNotifyFile: false })).jobServiceMissing).toBe(true);
    expect(mailToView(status({ nciMailTo: null, nciMailToStatus: "receiver_disabled" })).reason).toBe("receiver_disabled");
    expect(mailToView(status({ nciMailTo: null, nciMailToStatus: "address_required" })).reason).toBe("address_required");
    // An older cutex without the field.
    expect(mailToView(status()).reason).toBe("unsupported");
    expect(mailToView(null).reason).toBe("unknown");
  });

  it("fills the mailbox form without a password and knows when the password is needed again", () => {
    const s = status({ address: "alias@example.org" });
    expect(mailboxDraft(s)).toMatchObject({ server: "imap.gmail.com", port: 993, username: "nci.owner@gmail.com", address: "alias@example.org", password: "", sources: ["nci"] });
    expect(mailboxDraft(null)).toMatchObject({ enabled: true, port: 993, mailbox: "INBOX", sources: ["nci"], password: "" });
    expect(mailPasswordRequired(null, { server: "a", port: 993, username: "b" })).toBe(true);
    expect(mailPasswordRequired(s, { server: "imap.gmail.com", port: 993, username: "nci.owner@gmail.com" })).toBe(false);
    expect(mailPasswordRequired(s, { server: "imap.gmail.com", port: 993, username: "other@gmail.com" })).toBe(true);
    expect(mailPasswordRequired(s, { server: "imap.gmail.com", port: 143, username: "nci.owner@gmail.com" })).toBe(true);
  });

  it("checks addresses like cutex does", () => {
    for (const ok of ["a@b.au", "first.last+nci@mail.example.org"]) expect(validMailAddress(ok)).toBe(true);
    for (const bad of ["", "a", "a@b", "-a@b.au", "a b@c.au", "a@b..au", "a,b@c.au", "a@b@c.au", "\"a\"@b.au"]) expect(validMailAddress(bad)).toBe(false);
  });

  it("reads pinned host keys from key lines and ssh-keyscan / known_hosts lines", () => {
    const text = [
      "# gadi.nci.org.au:22 SSH-2.0-OpenSSH",
      "gadi.nci.org.au ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample",
      "ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB+/=",
      "",
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample",
      "not a key",
    ].join("\n");
    expect(parseHostKeys(text)).toEqual({ keys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample", "ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB+/="], invalid: 1 });
  });

  it("labels poll intervals", () => {
    expect(intervalLabel(21600)).toBe("6h");
    expect(intervalLabel(86400)).toBe("1d");
    expect(intervalLabel(1800)).toBe("30m");
  });
});

describe("external job titles", () => {
  it("prefer a real scheduler name, else the PBS id, never the bare correlation marker", async () => {
    const { jobTitle } = await import("../src/renderer/src/lib/jobs");
    const base = { jobId: "job_x", actionId: "", command: null };
    expect(jobTitle({ ...base, remoteName: `cx${"a".repeat(32)}`, remoteId: "1.gadi-pbs" })).toBe("1.gadi-pbs");
    expect(jobTitle({ ...base, remoteName: "relax-cx0011", remoteId: "1.gadi-pbs" })).toBe("relax-cx0011");
    expect(jobTitle({ ...base })).toBe("job_x");
  });
});
