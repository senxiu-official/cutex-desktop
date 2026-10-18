// minisign signing in plain Node (module packs, docs/desktop-modules.md §23.10): the format main/minisign.ts
// verifies — prehashed ("ED", BLAKE2b-512 of the file) with a trusted comment and its global signature.
// Used for the TEST key only (local end-to-end runs and tests); release signing is the minisign CLI in CI.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

export const TEST_SEED_TEXT = "cutex-desktop module packs TEST KEY - never trusted by packaged builds";

/** The module-pack test key: Ed25519 from SHA-256(seed text); key id = first 8 bytes of SHA-256("key id:" + seed). */
export function testKey() {
  const seed = createHash("sha256").update(TEST_SEED_TEXT).digest();
  const keyId = createHash("sha256").update(`key id:${TEST_SEED_TEXT}`).digest().subarray(0, 8);
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  return { privateKey, keyId };
}

/** The minisign public key line ("Ed" | key id | Ed25519 public key, base64). */
export function publicKeyLine({ privateKey, keyId }) {
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  return Buffer.concat([Buffer.from("Ed"), keyId, Buffer.from(jwk.x, "base64url")]).toString("base64");
}

/** A `.minisig` for `data` whose trusted comment names `fileName` (as `minisign -S` writes it). */
export function signMinisig(data, fileName, key = testKey(), timestamp = Math.floor(Date.now() / 1000)) {
  const hash = createHash("blake2b512").update(data).digest();
  const signature = sign(null, hash, key.privateKey);
  const trusted = `timestamp:${timestamp}\tfile:${fileName}\thashed`;
  const global = sign(null, Buffer.concat([signature, Buffer.from(trusted, "utf8")]), key.privateKey);
  return [
    "untrusted comment: signature from cutex-desktop module-pack TEST key",
    Buffer.concat([Buffer.from("ED"), key.keyId, signature]).toString("base64"),
    `trusted comment: ${trusted}`,
    global.toString("base64"),
    "",
  ].join("\n");
}
