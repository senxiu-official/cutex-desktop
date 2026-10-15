// Mock cutex inbound mail + Gadi scheduler check for the preview of Settings → NCI 远程作业 (module
// nci). Starts from nothing configured so the setup guide can be walked: generate the key on the
// "host", copy / save the helper, paste host keys, username, mailbox, test, turn the check on.
// Shared by every mock host. Nothing here is a real key: the "keys" are fixed placeholder strings.
import type { JobResult } from "../../../../shared/ipc";
import type { InboundMailInput, InboundMailStatus, NciHelper, NciVerificationInput, NciVerificationStatus } from "../../../../shared/remoteJobs";
import type { ModuleMock } from "../../dev/mockTypes";

const now = () => Math.floor(Date.now() / 1000);
const ok = <T,>(value: T): JobResult<T> => ({ ok: true, value: structuredClone(value) });
const fail = <T,>(code: string): JobResult<T> => ({ ok: false, code, message: code });
const delay = () => new Promise((r) => setTimeout(r, 150));

let mail: (InboundMailInput & { password: string; mailbox: string; sources: string[]; lastConnectedAt: number | null }) | null = null;
function mailStatus(): InboundMailStatus {
  const c = mail;
  const mailTo = !c || !c.sources.includes("nci") || !c.enabled ? null : (c.address ?? (c.username.includes("@") ? c.username : null));
  const code = !c ? "mailbox_not_configured" : !c.sources.includes("nci") ? "nci_source_disabled" : !c.enabled ? "receiver_disabled" : mailTo ? "configured" : "address_required";
  return {
    enabled: !!c?.enabled,
    configured: !!c,
    server: c?.server ?? null,
    port: c?.port ?? null,
    username: c?.username ?? null,
    mailbox: c?.mailbox ?? null,
    sources: c?.sources ?? [],
    address: c?.address ?? null,
    nciMailTo: mailTo,
    nciMailToStatus: code,
    nciMailToFrom: mailTo ? (c?.address ? "address" : "username") : null,
    notifyAddressFile: "/home/alex/.cutex/runtime/inbound-mail/notify-address-v1.json",
    jobServiceNotifyFile: true,
    jobServiceNciSource: true,
    lastConnectedAt: c?.enabled ? c.lastConnectedAt : null,
    errorCode: null,
    deliveryErrorCode: null,
    nciVerificationAvailable: true,
    statusCode: null,
    counts: c ? { processed: 0, ignored: 0, rejected: 0, duplicates: 0, applied: 0, pending: 0, discarded: 0, expired: 0 } : {},
  };
}

const PLACEHOLDER = "<GADI_HOME>";
let keySerial = 0;
/** A placeholder public key (not a real key) and its "fingerprint". */
function mockKey(): { line: string; fingerprint: string } {
  keySerial++;
  const blob = `AAAAC3NzaC1lZDI1NTE5AAAAIMockHostGeneratedQstatKey${String(keySerial).padStart(4, "0")}PreviewOnly000`;
  return { line: `ssh-ed25519 ${blob}`, fingerprint: `SHA256:Mock+host/generated+key+${keySerial}+PreviewOnly0000000000` };
}
let key: { line: string; fingerprint: string; source: "generated" | "uploaded"; pending: boolean } | null = null;
let config: { enabled: boolean; username: string; hostKeys: string[]; pollIntervalSeconds: number } | null = null;
let queries = { count: 0, last: null as number | null, success: null as number | null };

function nciStatus(): NciVerificationStatus {
  return {
    configured: !!config,
    enabled: !!config?.enabled,
    host: "gadi.nci.org.au",
    pollIntervalSeconds: config?.pollIntervalSeconds ?? 21600,
    minimumQueryIntervalSeconds: 180,
    queryCount: queries.count,
    errorCode: null,
    username: config?.username ?? null,
    hostKeys: config?.hostKeys ?? [],
    hostKeyFingerprints: (config?.hostKeys ?? []).map((_, i) => `SHA256:Mock+gadi/host+key+${i}+PreviewOnly00000000000000`),
    privateKeyStored: !!config && !!key && !key.pending,
    pendingGeneratedKey: !!key?.pending,
    keySource: key?.source ?? null,
    publicKey: key ? (key.source === "generated" ? `${key.line} cutex-qstat` : key.line) : null,
    publicKeyFingerprint: key?.fingerprint ?? null,
    authorizedKeysTemplate: key ? `restrict,command="/usr/bin/python3 -I ${PLACEHOLDER}/.cutex/nci-qstat-only.py" ${key.line} cutex-qstat` : null,
    gadiHomePlaceholder: PLACEHOLDER,
    trackedJobs: config ? 3 : 0,
    lastQueryAt: queries.last,
    lastSuccessAt: queries.success,
    nextQueryAllowedAt: null,
  };
}

const HELPER = `#!/usr/bin/python3
"""Optional Gadi authorized_keys forced command; install only after owner review."""
# (preview copy; the real text comes from cutex)
import os, re, sys
QSTAT = "/opt/pbs/default/bin/qstat"
`;

const api = {
  async inboundMail(): Promise<JobResult<InboundMailStatus>> {
    await delay();
    return ok(mailStatus());
  },
  async putInboundMail(input: InboundMailInput): Promise<JobResult<InboundMailStatus>> {
    await delay();
    const same = mail && mail.server === input.server && mail.port === input.port && mail.username === input.username;
    const password = input.password ?? (same ? mail!.password : undefined);
    if (!password) return fail("mail_password_required");
    mail = { ...input, password, mailbox: input.mailbox ?? "INBOX", sources: input.sources ?? [], address: input.address ?? null, lastConnectedAt: mail?.lastConnectedAt ?? null };
    return ok(mailStatus());
  },
  async testInboundMail(input: InboundMailInput | null): Promise<JobResult<{ ok: boolean }>> {
    await delay();
    if (!input && !mail) return fail("mail_not_configured");
    if ((input?.server ?? mail?.server ?? "").includes("bad")) return fail("mail_connection_failed");
    if (mail) mail.lastConnectedAt = now();
    return ok({ ok: true });
  },
  async deleteInboundMail(): Promise<JobResult<InboundMailStatus>> {
    await delay();
    mail = null;
    return ok(mailStatus());
  },
  async nciVerification(): Promise<JobResult<NciVerificationStatus>> {
    await delay();
    return ok(nciStatus());
  },
  async generateNciKey(replace: boolean): Promise<JobResult<NciVerificationStatus>> {
    await delay();
    if (key && !replace) return fail("qstat_key_exists");
    key = { ...mockKey(), source: "generated", pending: !config };
    return ok(nciStatus());
  },
  async nciHelper(): Promise<JobResult<NciHelper>> {
    await delay();
    return ok({ fileName: "nci-qstat-only.py", installPath: "~/.cutex/nci-qstat-only.py", script: HELPER, sha256: "0".repeat(64) });
  },
  async saveNciHelper(): Promise<JobResult<{ path: string }>> {
    await delay();
    return ok({ path: "/home/alex/Downloads/nci-qstat-only.py" });
  },
  async putNciVerification(input: NciVerificationInput): Promise<JobResult<NciVerificationStatus>> {
    await delay();
    if (!input.hostKeyConfirmed) return fail("qstat_host_key_confirmation_required");
    if (input.useGeneratedKey && input.pickPrivateKey) return fail("qstat_invalid_config");
    if (input.useGeneratedKey) {
      if (!key?.pending) return fail("qstat_private_key_required");
      key.pending = false;
    } else if (input.pickPrivateKey) {
      key = { ...mockKey(), source: "uploaded", pending: false };
    } else {
      const same = !!config && config.username === input.username && JSON.stringify(config.hostKeys) === JSON.stringify(input.hostKeys);
      if (!same || !key || key.pending) return fail("qstat_private_key_required");
    }
    const enabled = input.enabled ?? config?.enabled ?? false;
    config = { enabled, username: input.username, hostKeys: input.hostKeys, pollIntervalSeconds: input.pollIntervalSeconds ?? config?.pollIntervalSeconds ?? 21600 };
    if (enabled && queries.success === null) queries = { count: 1, last: now(), success: now() };
    return ok(nciStatus());
  },
  async deleteNciVerification(): Promise<JobResult<NciVerificationStatus>> {
    await delay();
    config = null;
    key = null;
    return ok(nciStatus());
  },
};

export const mock: ModuleMock = {
  api: () => api,
  remote: () => api,
  features: { new: ["inbound-mail", "nci-mail-address", "nci-verification", "job-source-nci", "nci-host-keygen"] },
};
