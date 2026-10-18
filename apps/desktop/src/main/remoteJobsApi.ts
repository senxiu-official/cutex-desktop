// NCI remote jobs: owner marking of external jobs, the PBS mailbox and the optional Gadi scheduler
// check. Bodies are rebuilt from known fields; credentials only travel renderer → main → cutex (the
// mailbox password the owner typed) or file → main → cutex (the SSH key, chosen here, never sent to
// the renderer). A key cutex generates on the host (`POST /v2/nci-verification/key`) never leaves
// cutex at all: only its public half and fingerprint come back. No reply shape carries a credential:
// cutex never returns one, and statuses are passed through only after dropping unexpected
// credential-like keys.
import { appWindows } from "./appWindows";
import { readFile, stat, writeFile } from "node:fs/promises";
import { BrowserWindow, dialog } from "electron";
import { CutexApiError, type CutexClient } from "@cutex-desktop/cutex-client";
import type { DaemonApi, JobResult } from "../shared/ipc";
import type { ExternalTerminalState, InboundMailInput, NciHelper, NciVerificationInput } from "../shared/remoteJobs";

const MAX_KEY_BYTES = 16 * 1024;
const KEY_HEADER = "-----BEGIN OPENSSH PRIVATE KEY-----";

async function call<T>(client: CutexClient, method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<JobResult<T>> {
  try {
    const value = await client.request<T>(method, path, body === undefined ? {} : { body });
    return { ok: true, value: scrub(value) };
  } catch (error) {
    if (error instanceof CutexApiError) {
      const missing = (error.status === 404 || error.status === 405) && !/^(job|mail|qstat|inbound|nci)/.test(error.code);
      const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
      return { ok: false, code: missing ? "unsupported" : error.code, message };
    }
    return { ok: false, code: "unreachable", message: String((error as Error)?.message ?? error) };
  }
}

/** Defense in depth: a status never carries these, whatever a daemon sends. */
function scrub<T>(value: T): T {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const copy = { ...(value as Record<string, unknown>) };
    for (const key of ["password", "privateKey", "appPassword"]) delete copy[key];
    return copy as T;
  }
  return value;
}

function str(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`invalid ${what}`);
  return value.trim();
}

function mailBody(input: InboundMailInput): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new Error("invalid mailbox configuration");
  if (!Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error("invalid port");
  const sources = Array.isArray(input.sources) ? input.sources.filter((s) => s === "nci") : ["nci"];
  const body: Record<string, unknown> = {
    enabled: input.enabled === true,
    server: str(input.server, 253, "server"),
    port: input.port,
    username: str(input.username, 320, "username"),
    mailbox: input.mailbox === undefined || input.mailbox === "" ? "INBOX" : str(input.mailbox, 128, "mailbox"),
    sources: [...new Set(sources)],
  };
  // The password may contain spaces (app passwords); only control characters are refused.
  if (typeof input.password === "string" && input.password !== "") {
    if (input.password.length > 4096 || /[\u0000-\u001f\u007f]/.test(input.password)) throw new Error("invalid password");
    body.password = input.password;
  }
  if (typeof input.address === "string" && input.address.trim() !== "") body.address = str(input.address, 254, "address");
  return body;
}

async function pickPrivateKey(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? appWindows()[0];
  const options = { title: "SSH private key for Gadi", properties: ["openFile", "showHiddenFiles"] as ("openFile" | "showHiddenFiles")[] };
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (r.canceled || !r.filePaths[0]) return null;
  const path = r.filePaths[0];
  if ((await stat(path)).size > MAX_KEY_BYTES) throw new Error("the chosen file is too large for an SSH key");
  const text = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  if (!text.startsWith(KEY_HEADER)) throw new Error("not an OpenSSH private key (choose the key file without .pub)");
  return text.endsWith("\n") ? text : `${text}\n`;
}

const STATES: readonly ExternalTerminalState[] = ["exited", "failed", "cancelled"];
const MAX_HELPER_CHARS = 256 * 1024;

/** The helper reply, rebuilt from its four known string fields (anything else is refused). */
function helperOf(value: unknown): NciHelper | null {
  const v = value as Partial<Record<keyof NciHelper, unknown>> | null;
  if (!v || typeof v !== "object") return null;
  const { fileName, installPath, script, sha256 } = v;
  if (typeof fileName !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(fileName)) return null;
  if (typeof installPath !== "string" || installPath.length > 512 || /[\u0000-\u001f\u007f]/.test(installPath)) return null;
  if (typeof script !== "string" || script.length > MAX_HELPER_CHARS) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256)) return null;
  return { fileName, installPath, script, sha256: sha256.toLowerCase() };
}

export function remoteJobsApi(client: CutexClient): Pick<DaemonApi, "markExternalJob" | "inboundMail" | "putInboundMail" | "testInboundMail" | "deleteInboundMail" | "nciVerification" | "putNciVerification" | "deleteNciVerification" | "generateNciKey" | "nciHelper" | "saveNciHelper"> {
  return {
    markExternalJob(input) {
      if (typeof input?.jobId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(input.jobId)) throw new Error("bad job id");
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("bad revision");
      if (!STATES.includes(input.state)) throw new Error("bad state");
      const body: Record<string, unknown> = { jobId: input.jobId, expectedRevision: input.expectedRevision, state: input.state };
      if (input.exitCode !== undefined) {
        if (!Number.isSafeInteger(input.exitCode) || input.exitCode < 0 || input.exitCode > 2 ** 31 - 1) throw new Error("bad exit code");
        body.exitCode = input.exitCode;
      } else if (input.state === "exited") throw new Error("exit code required");
      if (typeof input.note === "string" && input.note.trim()) {
        if (input.note.length > 2048) throw new Error("note too long");
        body.note = input.note;
      }
      return call(client, "POST", "/v2/job-service/mark-external", body);
    },
    inboundMail() {
      return call(client, "GET", "/v2/inbound-mail");
    },
    putInboundMail(input) {
      return call(client, "PUT", "/v2/inbound-mail/config", mailBody(input));
    },
    testInboundMail(input) {
      return call(client, "POST", "/v2/inbound-mail/test", input ? mailBody(input) : {});
    },
    deleteInboundMail() {
      return call(client, "DELETE", "/v2/inbound-mail/config", {});
    },
    nciVerification() {
      return call(client, "GET", "/v2/nci-verification");
    },
    async putNciVerification(input: NciVerificationInput) {
      if (!input || typeof input !== "object") throw new Error("invalid configuration");
      if (!Array.isArray(input.hostKeys) || input.hostKeys.length < 1 || input.hostKeys.length > 8) throw new Error("1 to 8 host keys");
      const body: Record<string, unknown> = {
        username: str(input.username, 64, "username"),
        hostKeys: input.hostKeys.map((k) => str(k, 16_400, "host key")),
        hostKeyConfirmed: input.hostKeyConfirmed === true,
      };
      if (typeof input.enabled === "boolean") body.enabled = input.enabled;
      if (input.pollIntervalSeconds !== undefined) {
        if (!Number.isSafeInteger(input.pollIntervalSeconds)) throw new Error("bad interval");
        body.pollIntervalSeconds = input.pollIntervalSeconds;
      }
      if (input.useGeneratedKey === true) {
        if (input.pickPrivateKey) throw new Error("choose either the generated key or a key file");
        body.useGeneratedKey = true;
      } else if (input.pickPrivateKey) {
        let key: string | null;
        try {
          key = await pickPrivateKey();
        } catch (error) {
          return { ok: false, code: "qstat_invalid_private_key", message: (error as Error).message };
        }
        if (key === null) return { ok: false, code: "cancelled", message: "cancelled" };
        body.privateKey = key;
      }
      return call(client, "PUT", "/v2/nci-verification/config", body);
    },
    deleteNciVerification() {
      return call(client, "DELETE", "/v2/nci-verification/config", {});
    },
    generateNciKey(replace) {
      return call(client, "POST", "/v2/nci-verification/key", replace === true ? { replace: true } : {});
    },
    async nciHelper() {
      const r = await call<unknown>(client, "GET", "/v2/nci-verification/helper");
      if (!r.ok) return r;
      const helper = helperOf(r.value);
      return helper ? { ok: true, value: helper } : { ok: false, code: "invalid_reply", message: "unexpected helper reply" };
    },
    // The helper text comes from cutex here in main (not from the renderer) and goes to a file the
    // owner picks on this machine; the renderer only learns the chosen path.
    async saveNciHelper() {
      const r = await call<unknown>(client, "GET", "/v2/nci-verification/helper");
      if (!r.ok) return r;
      const helper = helperOf(r.value);
      if (!helper) return { ok: false, code: "invalid_reply", message: "unexpected helper reply" };
      const win = BrowserWindow.getFocusedWindow() ?? appWindows()[0];
      const options = { defaultPath: helper.fileName, filters: [{ name: "Python", extensions: ["py"] }] };
      const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return { ok: false, code: "cancelled", message: "" };
      await writeFile(picked.filePath, helper.script, { encoding: "utf8", mode: 0o600 });
      return { ok: true, value: { path: picked.filePath } };
    },
  };
}
