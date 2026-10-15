// Settings → NCI 远程作业 (module `nci`): pure helpers of the step-by-step setup guide — which steps
// are done (from `GET /v2/inbound-mail` and `GET /v2/nci-verification`), the authorized_keys line
// with the owner's Gadi home filled in, and SSH host key fingerprints as `ssh-keygen -l` prints them.
import type { InboundMailStatus, NciVerificationStatus } from "../../../shared/remoteJobs";

export type NciStepId = "key" | "gadi" | "hostKeys" | "username" | "mailbox" | "enable";
/**
 * done = cutex reports it; todo = still to do; manual = only the owner can tell (things on Gadi, until
 * the first successful check proves them); blocked = needs an earlier step; unsupported = this cutex
 * lacks the feature; loading = status not loaded yet.
 */
export type NciStepState = "done" | "todo" | "manual" | "blocked" | "unsupported" | "loading";

export interface NciSetupInput {
  /** Host features: inbound-mail / nci-verification / nci-host-keygen. */
  mail: boolean;
  verification: boolean;
  keygen: boolean;
  /** undefined = loading, null = failed / unsupported. */
  mailStatus: InboundMailStatus | null | undefined;
  nciStatus: NciVerificationStatus | null | undefined;
}

export interface NciStep {
  id: NciStepId;
  state: NciStepState;
}

/** A key cutex can use: a stored one, or a generated one waiting for the next save. */
export function hasNciKey(s: NciVerificationStatus | null | undefined): boolean {
  return !!s && (!!s.privateKeyStored || !!s.pendingGeneratedKey) && !!s.publicKey;
}

/** The mailbox receives NCI mail (configured, on, NCI source on). */
export function mailboxReady(s: InboundMailStatus | null | undefined): boolean {
  return !!s?.configured && !!s.enabled && (s.sources ?? []).includes("nci");
}

/** Steps ①–⑥ in order with their state. */
export function nciSteps(input: NciSetupInput): NciStep[] {
  const { mailStatus: mail, nciStatus: nci } = input;
  const verify = (fn: (s: NciVerificationStatus) => NciStepState): NciStepState =>
    !input.verification ? "unsupported" : nci === undefined ? "loading" : nci === null ? "todo" : fn(nci);
  const configured = !!nci?.configured;
  const proven = configured && nci?.lastSuccessAt != null;

  const key: NciStepState = verify((s) => (hasNciKey(s) ? "done" : "todo"));
  // The helper and the authorized_keys line live on Gadi: only a successful check proves them.
  const gadi: NciStepState = !input.verification ? "unsupported" : key === "loading" ? "loading" : proven ? "done" : key === "done" ? "manual" : "blocked";
  const hostKeys: NciStepState = verify((s) => (s.configured && (s.hostKeys ?? []).length > 0 ? "done" : "todo"));
  const username: NciStepState = verify((s) => (s.configured && !!s.username ? "done" : "todo"));
  const mailbox: NciStepState = !input.mail ? "unsupported" : mail === undefined ? "loading" : mailboxReady(mail) ? "done" : "todo";

  let enable: NciStepState;
  if (!input.mail && !input.verification) enable = "unsupported";
  else if ((input.mail && mail === undefined) || (input.verification && nci === undefined)) enable = "loading";
  else {
    const mailOk = !input.mail || (mailboxReady(mail) && mail?.lastConnectedAt != null && !mail?.errorCode);
    const verifyOn = !input.verification || (configured && !!nci?.enabled);
    const before = input.verification ? [key, hostKeys, username] : [];
    if (mailOk && verifyOn) enable = "done";
    else if ((input.mail && mailbox !== "done") || before.some((s) => s !== "done")) enable = "blocked";
    else enable = "todo";
  }
  return [
    { id: "key", state: key },
    { id: "gadi", state: gadi },
    { id: "hostKeys", state: hostKeys },
    { id: "username", state: username },
    { id: "mailbox", state: mailbox },
    { id: "enable", state: enable },
  ];
}

/** The step the guide opens on: the first that still needs the owner (null = all done). */
export function currentNciStep(steps: readonly NciStep[]): NciStepId | null {
  return steps.find((s) => s.state === "todo" || s.state === "manual")?.id ?? null;
}

export const GADI_HOME_PLACEHOLDER = "<GADI_HOME>";
/** Where the helper goes on Gadi, relative to the home (cutex's `installPath` without `~/`). */
export const QSTAT_HELPER_RELATIVE = ".cutex/nci-qstat-only.py";

/**
 * The owner's Gadi home as `echo $HOME` prints it (e.g. `/home/123/ab1234`): an absolute path of
 * plain characters (it goes inside the authorized_keys `command="…"`), trailing slashes dropped.
 * null = not usable.
 */
export function normalizeGadiHome(text: string): string | null {
  const home = text.trim().replace(/\/+$/, "");
  if (!home.startsWith("/") || home.length > 256) return null;
  if (!/^\/[A-Za-z0-9._/-]+$/.test(home) || home.split("/").some((part) => part === "." || part === "..") || home.includes("//")) return null;
  return home;
}

/**
 * The authorized_keys line for Gadi with the home filled in: cutex's template (nci-host-keygen) with
 * its placeholder replaced, else (an older cutex) built from the public key like cutex does. null =
 * no key yet or the home is not usable.
 */
export function authorizedKeysFor(status: Pick<NciVerificationStatus, "authorizedKeysTemplate" | "gadiHomePlaceholder" | "publicKey"> | null | undefined, homeText: string): string | null {
  const home = normalizeGadiHome(homeText);
  if (!home || !status) return null;
  const template = status.authorizedKeysTemplate;
  if (template) {
    const placeholder = status.gadiHomePlaceholder || GADI_HOME_PLACEHOLDER;
    return template.includes(placeholder) ? template.split(placeholder).join(home) : null;
  }
  const key = status.publicKey?.trim();
  if (!key) return null;
  const [type, blob, comment] = key.split(/\s+/);
  if (!type || !blob) return null;
  return `restrict,command="/usr/bin/python3 -I ${home}/${QSTAT_HELPER_RELATIVE}" ${type} ${blob} ${comment || "cutex-qstat"}`;
}

/** Base64 (standard alphabet, padding optional) → bytes; null when malformed. */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.replace(/=+$/, "").length % 4 === 1) return null;
  try {
    const bin = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, "="));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * The SHA256 fingerprint of an SSH public key (`TYPE BASE64`, or just the base64 blob) as
 * `ssh-keygen -l` prints it: `SHA256:` + unpadded base64 of SHA-256 over the decoded blob. null when
 * the blob is not base64 or WebCrypto is missing.
 */
export async function sshFingerprint(key: string): Promise<string | null> {
  const parts = key.trim().split(/\s+/);
  const blob = parts.length >= 2 ? parts[1]! : parts[0]!;
  const bytes = decodeBase64(blob ?? "");
  const subtle = globalThis.crypto?.subtle;
  if (!bytes || !subtle) return null;
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return `SHA256:${btoa(bin).replace(/=+$/, "")}`;
}
