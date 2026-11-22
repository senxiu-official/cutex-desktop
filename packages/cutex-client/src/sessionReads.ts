// r290 P4 scoped session reads (cutex capabilities.rs): what a device with a session read grant (a member's phone
// too) may read of one session, without the owner-only routes or a bootstrap.
import type { PendingServerRequest } from "@cutex-desktop/protocol";

/** `GET /v2/sessions/{id}/media/{sha256}` follows session read grants (before: owner only, 403 for members). */
export const SESSION_MEDIA_READ_FEATURE = "session-media-read";
/** `GET /v2/sessions/{id}/attachments/{attachmentId}`: an uploaded image's raw bytes (id = SHA-256 of the bytes). */
export const SESSION_ATTACHMENT_READ_FEATURE = "session-attachment-read";
/** `GET /v2/sessions/{id}/server-requests`: the pending native requests of the live runtime, no history read. */
export const SESSION_SERVER_REQUESTS_READ_FEATURE = "session-server-requests-read";

/** `GET /v2/sessions/{id}/server-requests`. `requests` is empty unless the runtime is online and connected (this generation). */
export interface SessionServerRequests {
  contractVersion: 2;
  cutexSessionId: string;
  runtimeGeneration: number;
  requests: PendingServerRequest[];
}

/** Largest attachment the host serves (cutex attachments.rs: 16 MiB). */
export const SESSION_ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024;
const ATTACHMENT_ID = /^[0-9a-f]{64}$/;
/** Where the host stores an upload: `…/attachments/<session dir>/<sha256>.<ext>` (cutex attachments.rs). */
const ATTACHMENT_PATH = /[\\/]attachments[\\/][^\\/]+[\\/]([0-9a-f]{64})\.(?:png|jpe?g|gif|webp)$/i;

export function isAttachmentId(value: unknown): value is string {
  return typeof value === "string" && ATTACHMENT_ID.test(value);
}

/** The attachment id of a host path from the upload store (a `localImage` sent from a phone / desktop), else null. */
export function attachmentIdOfPath(path: string): string | null {
  const m = ATTACHMENT_PATH.exec(path);
  return m ? m[1]!.toLowerCase() : null;
}

/** A well-formed server-requests answer, or throws. */
export function readSessionServerRequests(value: unknown): SessionServerRequests {
  const v = value as Partial<SessionServerRequests> | null;
  if (!v || typeof v !== "object" || typeof v.cutexSessionId !== "string" || !Number.isSafeInteger(v.runtimeGeneration) || !Array.isArray(v.requests)) throw new Error("bad server-requests answer");
  return { contractVersion: 2, cutexSessionId: v.cutexSessionId, runtimeGeneration: v.runtimeGeneration as number, requests: v.requests };
}
