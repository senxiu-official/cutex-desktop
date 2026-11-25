// The vault: one X25519 key pair per store. Every saved password is sealed to the vault's public key (ephemeral
// X25519 + HKDF-SHA256 + AES-256-GCM), so saving needs no prompt. Only the vault's private key opens an entry, and that
// key is kept wrapped by a KeyGuard (Windows: an RSA key inside Windows Hello; Linux / macOS: safeStorage). Unwrapping
// is the one step that asks the owner (Windows Hello).
//
// The AAD binds a sealed blob to its index entry (id, identity, origin): a blob copied onto another entry fails to open.
import { createPrivateKey, createPublicKey, createCipheriv, createDecipheriv, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from "node:crypto";

const VERSION = 1;
const INFO = Buffer.from("cutex-desktop browser password v1");

export interface VaultKeyPair { publicKey: Buffer; privateKey: Buffer }

export function generateVaultKeys(): VaultKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  return { publicKey: Buffer.from(jwk.x, "base64url"), privateKey: Buffer.from(jwk.d, "base64url") };
}

const publicKeyObject = (raw: Buffer): KeyObject => createPublicKey({ key: { kty: "OKP", crv: "X25519", x: raw.toString("base64url") }, format: "jwk" });
const privateKeyObject = (pair: VaultKeyPair): KeyObject =>
  createPrivateKey({ key: { kty: "OKP", crv: "X25519", x: pair.publicKey.toString("base64url"), d: pair.privateKey.toString("base64url") }, format: "jwk" });

function entryKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer {
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephemeral, recipient]), INFO, 32));
  shared.fill(0);
  return key;
}

export function vaultAad(entry: { id: string; identityId: string; origin: string }): Buffer {
  return Buffer.from(JSON.stringify(["cutex-browser-password", entry.id, entry.identityId, entry.origin]));
}

/** version(1) | ephemeral public(32) | iv(12) | tag(16) | ciphertext */
export function sealToVault(vaultPublic: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralRaw = Buffer.from((ephemeral.publicKey.export({ format: "jwk" }) as { x: string }).x, "base64url");
  const key = entryKey(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKeyObject(vaultPublic) }), ephemeralRaw, vaultPublic);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), ephemeralRaw, iv, cipher.getAuthTag(), body]);
  } finally { key.fill(0); }
}

/** Throws `unreadable` when the blob was not sealed to this vault (or was altered / moved). */
export function openFromVault(pair: VaultKeyPair, blob: Buffer, aad: Buffer): Buffer {
  if (blob.length < 1 + 32 + 12 + 16 || blob[0] !== VERSION) throw new Error("unreadable");
  const ephemeralRaw = blob.subarray(1, 33), iv = blob.subarray(33, 45), tag = blob.subarray(45, 61), body = blob.subarray(61);
  let shared: Buffer;
  try { shared = diffieHellman({ privateKey: privateKeyObject(pair), publicKey: publicKeyObject(Buffer.from(ephemeralRaw)) }); }
  catch { throw new Error("unreadable"); }
  const key = entryKey(shared, ephemeralRaw, pair.publicKey);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const head = decipher.update(body), tail = decipher.final();
    const plain = Buffer.concat([head, tail]);
    head.fill(0); tail.fill(0);
    return plain;
  } catch { throw new Error("unreadable"); }
  finally { key.fill(0); }
}
