// The person key (P2 person identity; shared/personIdentity.ts): an Ed25519 key pair made with
// node:crypto, stored as JWK fields in `<dir>/person-key.json` (0600, its directory 0700 — on Windows
// the userData directory under the user profile is already owner-private). The private key never
// leaves this module except as the identity key string / identity file the person copies or exports on
// purpose. No Electron here (unit-tested in test/personIdentity.test.ts).
//
// Identity key string (what the person copies between computers, like an API key):
// `cutex-id-` + base64url (no padding) of [32-byte Ed25519 seed (JWK `d`) ‖ 4-byte checksum], the
// checksum being the first 4 bytes of SHA-256 over `"cutex-id-v1" ‖ seed` — 57 characters in all.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { IDENTITY_FILE_TYPE, IDENTITY_FILE_VERSION, identityClaimMessage, PERSON_PUBLIC_KEY } from "../shared/personIdentity";

export interface PersonKeyFile {
  type: typeof IDENTITY_FILE_TYPE;
  version: typeof IDENTITY_FILE_VERSION;
  /** base64url raw 32-byte public key (JWK `x`). */
  publicKey: string;
  /** base64url raw 32-byte private seed (JWK `d`). */
  privateKey: string;
  createdAt: string;
}

export interface PersonKey {
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly file: PersonKeyFile;
  /** Ed25519 signature (base64url) over the UTF-8 message. */
  sign(message: string): string;
}

/** First 16 hex (8 bytes) of SHA-256 over the raw public key bytes, as cutex computes it. */
export function personFingerprint(publicKey: string): string {
  return createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex").slice(0, 16);
}

function keyOf(file: PersonKeyFile, privateKey: KeyObject): PersonKey {
  return {
    publicKey: file.publicKey,
    fingerprint: personFingerprint(file.publicKey),
    file,
    sign: (message) => sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64url"),
  };
}

/** A fresh key pair. */
export function generatePersonKey(now = new Date()): PersonKey {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { x?: string; d?: string };
  if (!jwk.x || !jwk.d) throw new Error("ed25519 key export failed");
  return keyOf({ type: IDENTITY_FILE_TYPE, version: IDENTITY_FILE_VERSION, publicKey: jwk.x, privateKey: jwk.d, createdAt: now.toISOString() }, privateKey);
}

/**
 * Read an identity file's JSON (the stored key or an imported one). Throws on anything that is not a
 * consistent Ed25519 pair: the public key must be the private key's.
 */
export function parsePersonKey(raw: unknown): PersonKey {
  const r = raw as Partial<PersonKeyFile> | null;
  if (!r || typeof r !== "object" || r.type !== IDENTITY_FILE_TYPE) throw new Error("not a cutex identity file");
  if (r.version !== IDENTITY_FILE_VERSION) throw new Error(`unsupported identity file version${typeof r.version === "number" && Number.isSafeInteger(r.version) ? ` ${r.version}` : ""}`);
  if (typeof r.publicKey !== "string" || !PERSON_PUBLIC_KEY.test(r.publicKey)) throw new Error("bad public key");
  if (typeof r.privateKey !== "string" || !PERSON_PUBLIC_KEY.test(r.privateKey)) throw new Error("bad private key");
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", x: r.publicKey, d: r.privateKey }, format: "jwk" });
  } catch {
    throw new Error("bad private key");
  }
  const derived = (createPublicKey(privateKey).export({ format: "jwk" }) as { x?: string }).x;
  if (derived !== r.publicKey) throw new Error("public key does not match the private key");
  const file: PersonKeyFile = { type: IDENTITY_FILE_TYPE, version: IDENTITY_FILE_VERSION, publicKey: r.publicKey, privateKey: r.privateKey, createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString() };
  // Round trip: a key that cannot sign / verify is no key.
  const probe = Buffer.from("cutex-identity-probe");
  if (!verify(null, probe, createPublicKey(privateKey), sign(null, probe, privateKey))) throw new Error("bad key pair");
  return keyOf(file, privateKey);
}

/** The identity key string's prefix and checksum domain. */
export const PERSON_KEY_STRING_PREFIX = "cutex-id-";
const PERSON_KEY_STRING_DOMAIN = "cutex-id-v1";
const SEED_BYTES = 32;
const CHECKSUM_BYTES = 4;
/** base64url (no padding) length of seed + checksum: 36 bytes → 48 characters. */
const PERSON_KEY_STRING_BODY = Math.ceil(((SEED_BYTES + CHECKSUM_BYTES) * 4) / 3);
/** PKCS#8 DER header of an Ed25519 private key; the 32-byte seed follows. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Why a pasted identity key string was refused (the renderer shows each one in its own words). */
export type PersonKeyStringErrorCode = "prefix" | "length" | "checksum" | "key";

export class PersonKeyStringError extends Error {
  constructor(readonly code: PersonKeyStringErrorCode, text: string) {
    super(text);
    this.name = "PersonKeyStringError";
  }
}

function keyStringChecksum(seed: Buffer): Buffer {
  return createHash("sha256").update(PERSON_KEY_STRING_DOMAIN, "utf8").update(seed).digest().subarray(0, CHECKSUM_BYTES);
}

/** The identity key string (the private key in clear: whoever has it is this person). */
export function encodePersonKeyString(key: PersonKey): string {
  const seed = Buffer.from(key.file.privateKey, "base64url");
  if (seed.length !== SEED_BYTES) throw new Error("bad private key");
  return PERSON_KEY_STRING_PREFIX + Buffer.concat([seed, keyStringChecksum(seed)]).toString("base64url");
}

/**
 * Read a pasted identity key string. Whitespace and line breaks anywhere in it are ignored (a string
 * wrapped by a chat or mail client still reads). Throws a PersonKeyStringError: `prefix` (not a
 * `cutex-id-` string), `length` (cut short, too long or not base64url), `checksum` (a character
 * changed), `key` (not a usable Ed25519 seed). The public key is derived from the seed and checked
 * the same way as an identity file (parsePersonKey); `createdAt` is now.
 */
export function parsePersonKeyString(text: string, now = new Date()): PersonKey {
  const compact = String(text ?? "").replace(/\s+/g, "");
  if (!compact.startsWith(PERSON_KEY_STRING_PREFIX)) throw new PersonKeyStringError("prefix", "not a cutex identity key (it should start with cutex-id-)");
  const body = compact.slice(PERSON_KEY_STRING_PREFIX.length);
  if (body.length !== PERSON_KEY_STRING_BODY || !/^[A-Za-z0-9_-]+$/.test(body)) throw new PersonKeyStringError("length", "the identity key is incomplete or has extra characters");
  const bytes = Buffer.from(body, "base64url");
  const seed = bytes.subarray(0, SEED_BYTES);
  // Compare the re-encoded body too: base64url's last character carries spare bits that decode the same.
  if (bytes.length !== SEED_BYTES + CHECKSUM_BYTES || bytes.toString("base64url") !== body || !keyStringChecksum(seed).equals(bytes.subarray(SEED_BYTES))) {
    throw new PersonKeyStringError("checksum", "the identity key's checksum does not match (a character is wrong)");
  }
  let publicKey: string | undefined;
  try {
    const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
    publicKey = (createPublicKey(privateKey).export({ format: "jwk" }) as { x?: string }).x;
  } catch {
    publicKey = undefined;
  }
  if (!publicKey) throw new PersonKeyStringError("key", "bad private key");
  try {
    return parsePersonKey({ type: IDENTITY_FILE_TYPE, version: IDENTITY_FILE_VERSION, publicKey, privateKey: seed.toString("base64url"), createdAt: now.toISOString() });
  } catch (error) {
    throw new PersonKeyStringError("key", error instanceof Error ? error.message : String(error));
  }
}

/** JSON.parse of a key file with a fixed error message (never quoting the text, which holds the private key). */
export function parseKeyJson(text: string, error = "not a cutex identity file (not valid JSON)"): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(error);
  }
}

/** The identity file's text (the legacy transfer format; also how the key is stored). */
export function serializePersonKey(key: PersonKey): string {
  return `${JSON.stringify(key.file, null, 2)}\n`;
}

/**
 * Write a key file owner-only, atomically and durably: a fresh temp file (0600; a leftover temp is
 * removed first so it cannot keep looser permissions), its data fsynced before the rename, then the
 * directory fsynced so the rename survives a crash (where the platform supports it; not on Windows).
 */
export function writePersonKeyFile(path: string, key: PersonKey): void {
  const tmp = `${path}.tmp`;
  rmSync(tmp, { force: true });
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, serializePersonKey(key), "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}

/** fsync a directory (makes a rename in it durable); best effort: Windows cannot open directories this way. */
export function fsyncDir(dir: string): void {
  if (process.platform === "win32") return;
  let fd: number | null = null;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch {
    // unsupported here (some file systems refuse): the file itself is already synced
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** `<dir>/person-key.json`: load it, or make and store a new key the first time. */
export function loadOrCreatePersonKey(dir: string): PersonKey {
  const path = join(dir, "person-key.json");
  let text: string | null = null;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // A damaged file is an error, never silently replaced: that would be a different person. The error
  // is a fixed text: JSON.parse quotes the source, which may hold part of the private seed (it is
  // logged and shown in the renderer).
  if (text !== null) return parsePersonKey(parseKeyJson(text, "person-key.json is damaged (not valid JSON)"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = generatePersonKey();
  writePersonKeyFile(path, key);
  return key;
}

/** The claim signature for `POST /v2/identity/claim`. */
export function signClaim(key: PersonKey, input: { hostId: string; nonce: string; tokenId: string }): string {
  return key.sign(identityClaimMessage(input.hostId, input.nonce, input.tokenId));
}
