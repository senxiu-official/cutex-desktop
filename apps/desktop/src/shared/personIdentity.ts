// P2 person identity, desktop side (docs/research/person-identity-p2-20261014.md): one Ed25519 key per
// person, kept by main in `<userData>/identity/person-key.json` (the renderer never sees the private
// key), presented to every paired host with cutex `person-identity` (`POST /v2/identity/claim`) once
// per host + token + key. Weak authentication: it tells a host who a paired device belongs to; pairing
// stays the only way in. This file: the IPC view shapes and the pure decisions (unit-tested in
// test/personIdentity.test.ts); keys and claims live in main/personKey.ts + main/personIdentity.ts.
import { PERSON_IDENTITY_FEATURE } from "@cutex-desktop/cutex-client";

export { identityClaimMessage, PERSON_IDENTITY_FEATURE, PERSON_PUBLIC_KEY, type IdentityChallenge, type IdentityClaimOutcome, type IdentityClaimResult, type PersonKeyInput, type PersonKeyRecord, type PersonKeysResult, type TokenPerson } from "@cutex-desktop/cutex-client";
import type { IdentityClaimOutcome } from "@cutex-desktop/cutex-client";

/** The identity file (also the export format): the private key in clear — whoever has it is you. */
export const IDENTITY_FILE_TYPE = "cutex-person-identity";
export const IDENTITY_FILE_VERSION = 1;

/** What one host knows of this desktop's identity. */
export type HostClaimState =
  /** cutex without `person-identity`: nothing presented (as before P2). */
  | "unsupported"
  /** no person key (it could not be read or made). */
  | "noKey"
  | "claiming"
  | "claimed"
  | "failed";

export interface HostClaimView {
  state: HostClaimState;
  /** claimed: what the claim did. */
  outcome?: IdentityClaimOutcome;
  /** claimed: where the credential is now (null + pending: waiting for the host owner). */
  userId?: string | null;
  pending?: boolean;
  /** ISO time of the claim. */
  at?: string;
  /** failed: the cutex error code (challenge_invalid, invalid_signature, client_token_not_found, …). */
  errorCode?: string;
  error?: string;
}

/** `identityState()` and the `identityState` event. */
export interface PersonIdentityView {
  /** base64url raw 32 bytes; null when the key could not be read or made (`error`). */
  publicKey: string | null;
  /** First 16 hex of SHA-256 of the raw public key (cutex's fingerprint). */
  fingerprint: string | null;
  error?: string;
  /** Per desktop host id. */
  claims: Record<string, HostClaimView>;
}

/** Why a pasted identity key string was refused (main/personKey.ts parsePersonKeyString). */
export type IdentityKeyErrorCode = "prefix" | "length" | "checksum" | "key";

/**
 * Export / import through main's file dialogs, and the identity key string (copy / paste).
 * `canceled`: the person closed a dialog. `errorCode`: a pasted key string that does not read.
 */
export type IdentityFileResult = { ok: true; path?: string; changed?: boolean } | { ok: false; canceled?: boolean; error?: string; errorCode?: IdentityKeyErrorCode };

/** `copyIdentityKey`: main put the key string on the clipboard (never in the renderer); it clears it after `clearAfterMs` if unchanged. */
export type IdentityKeyCopyResult = { ok: true; clearAfterMs: number } | { ok: false; error?: string };

/** Texts of main's import confirm dialog (the renderer's locale and terms); `{old}` / `{new}` = fingerprints. */
export interface IdentityImportTexts {
  title: string;
  message: string;
  detail: string;
  replace: string;
  cancel: string;
}

/**
 * A claim remembered by main: done for this host while the credential and the key stay the same.
 * `credential` is the desktop's own name for the connection's credential (an SSH host's client token
 * id from hosts.json, `root` for this machine's root credential, `dev` for a dev host): known before
 * any request, so a remembered claim costs no round trip. `tokenId` is what cutex signed (`"root"` for
 * the root credential).
 */
export interface ClaimRecord {
  publicKey: string;
  credential: string;
  tokenId: string;
  outcome: IdentityClaimOutcome;
  at: string;
  userId: string | null;
  pending: boolean;
  personUserId: string | null;
  /** The name sent with the claim (a pending device is claimed again when it changes). */
  displayName: string | null;
}

export type ClaimDecision = "unsupported" | "noKey" | "done" | "claim";

/**
 * Whether to present the key on one host now. `features`: the host's featureList (null = not read
 * yet: decide what can be decided without it). A new credential (re-pairing) or a new key (import)
 * makes a remembered claim stale, so each successful pairing and each upgrade claims exactly once; a
 * still-pending device is claimed again when the name 「你」 sends changed (its pending card shows it).
 */
export function claimDecision(input: { features: ReadonlySet<string> | null; credential: string | null | undefined; publicKey: string | null; record: ClaimRecord | undefined; displayName?: string | null }): ClaimDecision {
  const { features, credential, publicKey, record } = input;
  if (!credential || !publicKey) return "noKey";
  const nameChanged = !!record?.pending && (record.displayName ?? null) !== (input.displayName ?? null);
  if (record && record.publicKey === publicKey && record.credential === credential && !nameChanged) return "done";
  if (features && !features.has(PERSON_IDENTITY_FEATURE)) return "unsupported";
  return "claim";
}

/** The claim's view of a remembered record. */
export function claimedView(record: ClaimRecord): HostClaimView {
  return { state: "claimed", outcome: record.outcome, userId: record.userId, pending: record.pending, at: record.at };
}

/** Claim errors worth one immediate retry with a fresh challenge (the nonce expired / was spent). */
export const CLAIM_RETRY_ONCE = new Set(["challenge_invalid"]);
/** Claim errors worth a later retry (host busy / store unavailable). */
export const CLAIM_RETRY_LATER = new Set(["too_many_challenges", "users_unavailable", "client_tokens_unavailable"]);

/** Fingerprint length: cutex shows the first 8 bytes of SHA-256 as 16 hex. */
export const FINGERPRINT_BYTES = 8;

/** First 16 hex of a SHA-256 digest (the person fingerprint, as cutex computes it). */
export function fingerprintOfDigest(digest: ArrayBuffer | Uint8Array): string {
  const bytes = digest instanceof Uint8Array ? digest : new Uint8Array(digest);
  return [...bytes.subarray(0, FINGERPRINT_BYTES)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fingerprint for reading: `ab12 cd34 ef56 7890`. */
export function groupFingerprint(fingerprint: string | null | undefined): string {
  return (fingerprint ?? "").replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

/** The name 「你」 sends with a claim: the typed name, else nothing (≤ 60 chars, no control characters). */
export function claimDisplayName(name: unknown): string | null {
  const text = typeof name === "string" ? name.trim() : "";
  return text && [...text].length <= 60 && !/\p{Cc}/u.test(text) ? text : null;
}

/** base64url (padding optional) → bytes; null when malformed. */
export function base64UrlBytes(text: string): Uint8Array | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return null;
  const b64 = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
