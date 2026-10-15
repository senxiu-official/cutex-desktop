// minisign signature verification (main process only; node:crypto Ed25519 + our BLAKE2b-512).
//
// Formats (https://jedisct1.github.io/minisign/):
//   public key   base64( "Ed" | key id (8 bytes, little-endian) | Ed25519 public key (32) )
//   signature    untrusted comment line
//                base64( "ED" | key id (8) | Ed25519 signature (64) of BLAKE2b-512(file) )
//                "trusted comment: <text>"
//                base64( Ed25519 signature (64) of (the 64 signature bytes above | <text>) )
//
// Refused: an unknown key id, a bad signature or global signature, and legacy (non-prehashed,
// algorithm "Ed") signatures — minisign ≥ 0.10 signs prehashed by default and every release is signed
// that way (scripts/public-export/sign-and-upload.sh), so a legacy signature is never expected here.
// `expectFile`: the trusted comment's `file:<name>` field (minisign writes the signed file's base name
// there) must name that file, so one signed file cannot stand in for another.
import { createPublicKey, verify as edVerify, type KeyObject } from "node:crypto";
import { Blake2b512 } from "./blake2b";

/**
 * The release public keys (docs/install/cutex-release.pub — primary, key id 00A0BD016183F447 — and
 * cutex-release-spare.pub, D12869DA9D6F784E): the same keys cutex trusts for backend updates. A test
 * checks these against the .pub files.
 */
export const RELEASE_PUBLIC_KEYS = [
  "RWRH9INhAb2gACJAg/h5EBjbudos2LXj6K+5hRBEGeVLDKaKzE+FICmS",
  "RWROeG+d2mko0etWv0Aty4m3z61dYl8Bc1IBTlgOoHA7FGhZMg+BfXSa",
] as const;

export interface MinisignPublicKey {
  /** Key id as minisign prints it (16 hex digits, most significant byte first). */
  id: string;
  keyId: Buffer;
  key: KeyObject;
}

export interface MinisignSignature {
  prehashed: boolean;
  id: string;
  keyId: Buffer;
  signature: Buffer;
  trustedComment: string;
  globalSignature: Buffer;
}

function strictBase64(text: string): Buffer | null {
  const t = text.trim();
  if (!t || !/^[A-Za-z0-9+/]+={0,2}$/.test(t) || t.length % 4 !== 0) return null;
  return Buffer.from(t, "base64");
}

function printableId(keyId: Buffer): string {
  return Buffer.from(keyId).reverse().toString("hex").toUpperCase();
}

/** A public key from a `.pub` file's content or its bare base64 line. */
export function parsePublicKey(text: string): MinisignPublicKey {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => !l.startsWith("untrusted comment:"));
  const raw = line ? strictBase64(line) : null;
  if (!raw || raw.length !== 42 || raw[0] !== 0x45 || raw[1] !== 0x64) throw new Error("not a minisign Ed25519 public key");
  const keyId = raw.subarray(2, 10);
  const pk = raw.subarray(10, 42);
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pk.toString("base64url") }, format: "jwk" });
  return { id: printableId(keyId), keyId: Buffer.from(keyId), key };
}

/** A `.minisig` file. Throws on anything malformed (including signatures over 4 KiB). */
export function parseSignature(text: string): MinisignSignature {
  if (text.length > 4096) throw new Error("signature file too large");
  const lines = text.split(/\r?\n/);
  if (lines.length < 4 || !lines[0]!.startsWith("untrusted comment:")) throw new Error("not a minisign signature (no untrusted comment line)");
  const sig = strictBase64(lines[1]!);
  if (!sig || sig.length !== 74) throw new Error("not a minisign signature (bad signature line)");
  const alg = sig.subarray(0, 2).toString("latin1");
  if (alg !== "ED" && alg !== "Ed") throw new Error(`unknown minisign signature algorithm ${JSON.stringify(alg)}`);
  const prefix = "trusted comment: ";
  if (!lines[2]!.startsWith(prefix)) throw new Error("not a minisign signature (no trusted comment line)");
  const global = strictBase64(lines[3]!);
  if (!global || global.length !== 64) throw new Error("not a minisign signature (bad global signature line)");
  if (lines.slice(4).some((l) => l.trim() !== "")) throw new Error("not a minisign signature (trailing data)");
  const keyId = Buffer.from(sig.subarray(2, 10));
  return { prehashed: alg === "ED", id: printableId(keyId), keyId, signature: Buffer.from(sig.subarray(10, 74)), trustedComment: lines[2]!.slice(prefix.length), globalSignature: global };
}

/** The `file:` field of a trusted comment (tab-separated `key:value` fields), or null. */
export function trustedCommentFile(comment: string): string | null {
  for (const field of comment.split("\t")) if (field.startsWith("file:")) return field.slice(5);
  return null;
}

/** BLAKE2b-512 of `data` (a Buffer or an iterable of chunks, e.g. a file read in pieces). */
export function prehash(chunks: Iterable<Uint8Array> | Uint8Array): Buffer {
  const h = new Blake2b512();
  if (chunks instanceof Uint8Array) h.update(chunks);
  else for (const c of chunks) h.update(c);
  return h.digest();
}

/**
 * Verify a signature over a file whose BLAKE2b-512 is `fileHash` (prehash) against `keys`.
 * Returns the matching key's id and the trusted comment; throws with the reason otherwise.
 */
export function verifyPrehashed(fileHash: Buffer, signatureText: string, keys: readonly MinisignPublicKey[], expectFile?: string): { keyId: string; trustedComment: string } {
  const sig = parseSignature(signatureText);
  if (!sig.prehashed) throw new Error("legacy (non-prehashed) minisign signature refused");
  const key = keys.find((k) => k.keyId.equals(sig.keyId));
  if (!key) throw new Error(`signed with an unknown key ${sig.id}`);
  if (!edVerify(null, fileHash, key.key, sig.signature)) throw new Error("signature does not verify");
  if (!edVerify(null, Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, "utf8")]), key.key, sig.globalSignature)) throw new Error("trusted comment signature does not verify");
  if (expectFile !== undefined && trustedCommentFile(sig.trustedComment) !== expectFile) throw new Error(`signature is for ${JSON.stringify(trustedCommentFile(sig.trustedComment))}, not ${expectFile}`);
  return { keyId: key.id, trustedComment: sig.trustedComment };
}

/** Verify a whole in-memory file. */
export function verifyData(data: Uint8Array, signatureText: string, keys: readonly MinisignPublicKey[], expectFile?: string): { keyId: string; trustedComment: string } {
  return verifyPrehashed(prehash(data), signatureText, keys, expectFile);
}

let releaseKeys: MinisignPublicKey[] | null = null;
/** The embedded release keys, parsed once. */
export function releaseKeyring(): MinisignPublicKey[] {
  releaseKeys ??= RELEASE_PUBLIC_KEYS.map(parsePublicKey);
  return releaseKeys;
}
