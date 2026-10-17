// Copy a profile to another host (cutex `profile-transfer`): host A's `POST /v2/profiles/{p}/export`,
// then host B's `POST /v2/profiles/import`, both from main. The bundle (which may hold an API key) only
// lives in this function's locals: it is never logged, never put in an error, never sent to the
// renderer. Errors are reduced to {code, message, status} with any key redacted; the error log gets
// the same reduced record (no bundle, no response details).
import { CutexApiError } from "@cutex-desktop/cutex-client";
import {
  parseTransferWarnings,
  redactSecrets,
  type ProfileCredentialKind,
  type ProfileTransferRequest,
  type ProfileTransferResult,
  type ProfileTransferStage,
} from "../shared/profileTransfer";

export interface ExportReply {
  bundle?: unknown;
  credentialsIncluded?: boolean;
  credentialKind?: string;
}

export interface ImportReply {
  profile?: { id?: unknown; name?: unknown };
  credentialsCopied?: boolean;
  credentialKind?: string;
  warnings?: unknown;
}

export interface TransferEndpoints {
  exportBundle(profile: string, includeCredentials: boolean): Promise<ExportReply>;
  importBundle(bundle: unknown, name: string): Promise<ImportReply>;
}

export type TransferLog = (record: { source: string; message: string; [key: string]: unknown }) => void;

const KINDS: readonly ProfileCredentialKind[] = ["apiKey", "chatgpt", "claude", "none"];
const kindOf = (value: unknown): ProfileCredentialKind => (KINDS.includes(value as ProfileCredentialKind) ? (value as ProfileCredentialKind) : "none");

/** Every string value under `credentials` (the API key), for redaction. */
function secretsOf(bundle: unknown): string[] {
  const credentials = (bundle as { credentials?: unknown } | null)?.credentials;
  if (!credentials || typeof credentials !== "object") return [];
  return Object.values(credentials as Record<string, unknown>).filter((v): v is string => typeof v === "string" && v.length >= 8 && v !== "apiKey");
}

function reduce(error: unknown, secrets: readonly string[]): { code: string; message: string; status?: number } {
  const clip = (s: string) => redactSecrets(s, secrets).slice(0, 500);
  // CutexApiError's message is "<code>: <cutex message>"; the code is its own field here.
  if (error instanceof CutexApiError) return { code: error.code, message: clip(error.message.replace(`${error.code}: `, "")), status: error.status };
  if (error instanceof Error) return { code: error.name === "CutexUnreachableError" ? "unreachable" : "error", message: clip(error.message) };
  return { code: "error", message: clip(String(error)) };
}

export async function transferProfile(
  request: ProfileTransferRequest,
  source: Pick<TransferEndpoints, "exportBundle">,
  target: Pick<TransferEndpoints, "importBundle">,
  log: TransferLog,
): Promise<ProfileTransferResult> {
  const fail = (stage: ProfileTransferStage, error: { code: string; message: string; status?: number }): ProfileTransferResult => {
    log({ source: "profile-transfer", stage, sourceHostId: request.sourceHostId, targetHostId: request.targetHostId, code: error.code, status: error.status, message: error.message });
    return { ok: false, stage, error };
  };
  let exported: ExportReply | null = null;
  try {
    exported = await source.exportBundle(request.profile, request.includeApiKey === true);
  } catch (error) {
    return fail("export", reduce(error, []));
  }
  let bundle: unknown = exported?.bundle;
  const secrets = secretsOf(bundle);
  exported = null;
  if (!bundle || typeof bundle !== "object") return fail("export", { code: "bad_bundle", message: "the source host answered without a profile bundle" });
  try {
    const reply = await target.importBundle(bundle, request.name.trim());
    bundle = null;
    const id = typeof reply?.profile?.id === "string" ? reply.profile.id : "";
    const name = typeof reply?.profile?.name === "string" ? reply.profile.name : request.name.trim();
    return {
      ok: true,
      profile: { id, name },
      credentialKind: kindOf(reply?.credentialKind),
      credentialsCopied: reply?.credentialsCopied === true,
      warnings: parseTransferWarnings(reply?.warnings),
    };
  } catch (error) {
    return fail("import", reduce(error, secrets));
  } finally {
    bundle = null;
  }
}

/** Request shape check (IPC input: untrusted renderer). */
export function checkTransferRequest(request: unknown): ProfileTransferRequest | string {
  const r = request as Partial<ProfileTransferRequest> | null;
  if (!r || typeof r !== "object") return "bad request";
  for (const key of ["sourceHostId", "profile", "targetHostId", "name"] as const) {
    const v = r[key];
    if (typeof v !== "string" || !v.trim() || v.length > 256) return `bad ${key}`;
  }
  if (r.sourceHostId === r.targetHostId) return "source and target are the same host";
  return { sourceHostId: r.sourceHostId!, profile: r.profile!, targetHostId: r.targetHostId!, name: r.name!.trim(), includeApiKey: r.includeApiKey === true };
}
