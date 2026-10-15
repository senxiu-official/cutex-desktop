// minisign verification and BLAKE2b-512 (main/minisign.ts, main/blake2b.ts). The fixtures under
// test/fixtures/minisign were made with the minisign CLI (0.12) and two throwaway keys whose secret halves
// were never kept: test.pub signed payload.txt (prehashed and legacy) and payload.bin; other.pub signed
// payload.txt.other.minisig.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Blake2b512, blake2b512 } from "../src/main/blake2b";
import { parsePublicKey, parseSignature, RELEASE_PUBLIC_KEYS, releaseKeyring, trustedCommentFile, verifyData } from "../src/main/minisign";

const FIX = join(__dirname, "fixtures", "minisign");
const fix = (name: string) => readFileSync(join(FIX, name));
const text = (name: string) => readFileSync(join(FIX, name), "utf8");
const testKey = parsePublicKey(text("test.pub"));
const otherKey = parsePublicKey(text("other.pub"));

describe("blake2b512", () => {
  it("matches node's blake2b512 for many lengths, in one piece and in odd chunks", () => {
    for (const n of [0, 1, 3, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1000, 4096, 100_003]) {
      const data = randomBytes(n);
      const want = createHash("blake2b512").update(data).digest("hex");
      expect(blake2b512(data).toString("hex")).toBe(want);
      const h = new Blake2b512();
      for (let i = 0; i < n; i += 37) h.update(data.subarray(i, i + 37));
      expect(h.digest().toString("hex")).toBe(want);
    }
  });

  it("matches the RFC 7693 test vector for \"abc\"", () => {
    expect(blake2b512(Buffer.from("abc")).toString("hex")).toBe(
      "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
    );
  });

  it("refuses a second digest", () => {
    const h = new Blake2b512();
    h.digest();
    expect(() => h.digest()).toThrow();
  });
});

describe("release keys", () => {
  it("the embedded keys are docs/install/cutex-release.pub and cutex-release-spare.pub", () => {
    const docs = join(__dirname, "..", "..", "..", "docs", "install");
    const line = (f: string) => readFileSync(join(docs, f), "utf8").split(/\r?\n/)[1]!.trim();
    expect(RELEASE_PUBLIC_KEYS).toEqual([line("cutex-release.pub"), line("cutex-release-spare.pub")]);
    expect(releaseKeyring().map((k) => k.id)).toEqual(["00A0BD016183F447", "D12869DA9D6F784E"]);
  });

  it("parses a .pub file and a bare key line to the printed key id", () => {
    expect(testKey.id).toBe("07AA4FC66CC8B5E8");
    expect(parsePublicKey(text("test.pub").split("\n")[1]!).id).toBe("07AA4FC66CC8B5E8");
    expect(() => parsePublicKey("untrusted comment: x\nnot base64!")).toThrow();
    expect(() => parsePublicKey(Buffer.alloc(42).toString("base64"))).toThrow(/not a minisign/);
  });
});

describe("verifyData", () => {
  it("accepts a prehashed signature made by minisign, returning key id and trusted comment", () => {
    const r = verifyData(fix("payload.txt"), text("payload.txt.minisig"), [otherKey, testKey], "payload.txt");
    expect(r.keyId).toBe("07AA4FC66CC8B5E8");
    expect(r.trustedComment).toMatch(/file:payload\.txt\thashed$/);
    expect(verifyData(fix("payload.bin"), text("payload.bin.minisig"), [testKey], "payload.bin").keyId).toBe(testKey.id);
  });

  it("refuses changed data", () => {
    const data = Buffer.from(fix("payload.bin"));
    data[1000] = data[1000]! ^ 1;
    expect(() => verifyData(data, text("payload.bin.minisig"), [testKey])).toThrow("signature does not verify");
  });

  it("refuses a key id it does not trust (the embedded release keys do not know the test key)", () => {
    expect(() => verifyData(fix("payload.txt"), text("payload.txt.other.minisig"), [testKey])).toThrow(/unknown key/);
    expect(() => verifyData(fix("payload.txt"), text("payload.txt.minisig"), releaseKeyring())).toThrow(/unknown key 07AA4FC66CC8B5E8/);
  });

  it("refuses a signature whose key id was swapped to a trusted key", () => {
    const lines = text("payload.txt.other.minisig").split("\n");
    const raw = Buffer.from(lines[1]!, "base64");
    testKey.keyId.copy(raw, 2);
    lines[1] = raw.toString("base64");
    expect(() => verifyData(fix("payload.txt"), lines.join("\n"), [testKey])).toThrow("signature does not verify");
  });

  it("refuses legacy (non-prehashed) signatures", () => {
    expect(parseSignature(text("payload.txt.legacy.minisig")).prehashed).toBe(false);
    expect(() => verifyData(fix("payload.txt"), text("payload.txt.legacy.minisig"), [testKey])).toThrow(/legacy/);
  });

  it("refuses an edited trusted comment", () => {
    const sig = text("payload.txt.minisig").replace("file:payload.txt", "file:payload.txX");
    expect(() => verifyData(fix("payload.txt"), sig, [testKey])).toThrow("trusted comment signature does not verify");
  });

  it("refuses a signature made for another file name", () => {
    expect(() => verifyData(fix("payload.txt"), text("payload.txt.minisig"), [testKey], "cutex-desktop-9.9.9-linux-x64.tar.gz")).toThrow(/signature is for "payload.txt"/);
  });

  it("refuses malformed signature files", () => {
    const good = text("payload.txt.minisig");
    const lines = good.split("\n");
    expect(() => parseSignature("")).toThrow();
    expect(() => parseSignature(lines.slice(1).join("\n"))).toThrow(/untrusted comment/);
    expect(() => parseSignature([lines[0], lines[1]!.slice(4), lines[2], lines[3]].join("\n"))).toThrow(/bad signature line/);
    expect(() => parseSignature([lines[0], lines[1], "comment: x", lines[3]].join("\n"))).toThrow(/trusted comment/);
    expect(() => parseSignature([lines[0], lines[1], lines[2], "AAAA"].join("\n"))).toThrow(/global signature/);
    expect(() => parseSignature(good + "extra\n")).toThrow(/trailing/);
    expect(() => parseSignature(good + " ".repeat(5000))).toThrow(/too large/);
  });

  it("reads the file: field of a trusted comment", () => {
    expect(trustedCommentFile("timestamp:1\tfile:SHA256SUMS\thashed")).toBe("SHA256SUMS");
    expect(trustedCommentFile("just a comment")).toBeNull();
  });
});
