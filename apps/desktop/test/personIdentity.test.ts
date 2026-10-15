// P2 person identity (docs/research/person-identity-p2-20261014.md): the signed claim message, the
// claim decision, the person key (node:crypto Ed25519, main/personKey.ts), the owner's person-key
// helpers (users module) and Settings → 你 → 你能访问的主机 rows (lib/myAccess).
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CutexApiError, identityClaimMessage, personKeysBody } from "@cutex-desktop/cutex-client";
import { base64UrlBytes, claimDecision, claimDisplayName, fingerprintOfDigest, groupFingerprint, type ClaimRecord, type PersonIdentityView } from "../src/shared/personIdentity";
import { IDENTITY_KEY_CLIPBOARD_MS, PersonIdentityService } from "../src/main/personIdentity";
import { refusalText } from "../src/renderer/src/modules/users/model";

// Electron's dialogs and clipboard as main's identity service uses them (copy / paste / file import).
const electronFake = vi.hoisted(() => ({ clipboard: "", confirmResponse: 1, confirms: 0, openPath: "", savePath: "" }));
vi.mock("electron", () => ({
  dialog: {
    showMessageBox: async () => {
      electronFake.confirms++;
      return { response: electronFake.confirmResponse };
    },
    showOpenDialog: async () => ({ canceled: !electronFake.openPath, filePaths: electronFake.openPath ? [electronFake.openPath] : [] }),
    showSaveDialog: async () => ({ canceled: !electronFake.savePath, filePath: electronFake.savePath || undefined }),
  },
  clipboard: {
    writeText: async (text: string) => {
      electronFake.clipboard = text;
    },
    readText: async () => electronFake.clipboard,
    clear: () => {
      electronFake.clipboard = "";
    },
  },
}));
import { clipboard } from "electron";
import { encodePersonKeyString, generatePersonKey, loadOrCreatePersonKey, parsePersonKey, parsePersonKeyString, personFingerprint, PersonKeyStringError, serializePersonKey, signClaim } from "../src/main/personKey";
import { personKeyOwners, tokenPerson, unknownKeysOf, withoutPersonKey, withPersonKey } from "../src/renderer/src/modules/users/model";
import { claimTransitions, foldNames, hostIssue, myAccessRow, myDeviceLine } from "../src/renderer/src/lib/myAccess";
import { selfKeyUnknown } from "../src/renderer/src/lib/personKeys";
import { hostUserAccessOf, selfTokenOf } from "../src/shared/users";
import { OWNER_ACCESS, type UsersList } from "../src/shared/users";

describe("claim message", () => {
  it("is the versioned, newline-joined host id, nonce and token id", () => {
    expect(identityClaimMessage("host-abc", "n0nce", "mct-1a2b")).toBe("cutex-identity-v1\nhost-abc\nn0nce\nmct-1a2b");
  });
  it("refuses empty parts and parts that would shift the fields", () => {
    expect(() => identityClaimMessage("", "n", "t")).toThrow(/hostId/);
    expect(() => identityClaimMessage("h", "a\nb", "t")).toThrow(/nonce/);
    expect(() => identityClaimMessage("h", "n", "")).toThrow(/tokenId/);
  });
});

describe("claim decision", () => {
  const record = (over: Partial<ClaimRecord> = {}): ClaimRecord => ({ publicKey: "K1", credential: "T1", tokenId: "T1", outcome: "recorded", at: "2026-10-14T00:00:00Z", userId: "owner", pending: false, personUserId: "owner", displayName: null, ...over });
  const yes = new Set(["users", "person-identity"]);
  it("nothing without a key", () => {
    expect(claimDecision({ features: yes, credential: "T1", publicKey: null, record: undefined })).toBe("noKey");
  });
  it("every connection claims, the local root credential too", () => {
    expect(claimDecision({ features: yes, credential: "root", publicKey: "K1", record: undefined })).toBe("claim");
  });
  it("once per host + credential + key: done when both match, without reading capabilities", () => {
    expect(claimDecision({ features: null, credential: "T1", publicKey: "K1", record: record() })).toBe("done");
  });
  it("claims after an upgrade (no record), a re-pairing (new credential) and an import (new key)", () => {
    expect(claimDecision({ features: yes, credential: "T1", publicKey: "K1", record: undefined })).toBe("claim");
    expect(claimDecision({ features: yes, credential: "T2", publicKey: "K1", record: record() })).toBe("claim");
    expect(claimDecision({ features: yes, credential: "T1", publicKey: "K2", record: record() })).toBe("claim");
  });
  it("a still-pending device is claimed again when 「你」's name changed; a bound one is not", () => {
    expect(claimDecision({ features: yes, credential: "T1", publicKey: "K1", record: record({ pending: true, outcome: "pending", displayName: "Old" }), displayName: "New" })).toBe("claim");
    expect(claimDecision({ features: yes, credential: "T1", publicKey: "K1", record: record({ pending: true, outcome: "pending", displayName: "New" }), displayName: "New" })).toBe("done");
    expect(claimDecision({ features: yes, credential: "T1", publicKey: "K1", record: record({ displayName: "Old" }), displayName: "New" })).toBe("done");
  });
  it("an older host (no person-identity) is left alone; unknown features defer to a capabilities read", () => {
    expect(claimDecision({ features: new Set(["users"]), credential: "T1", publicKey: "K1", record: undefined })).toBe("unsupported");
    expect(claimDecision({ features: null, credential: "T1", publicKey: "K1", record: undefined })).toBe("claim");
  });
  it("the claim name: trimmed, ≤ 60 chars, no control characters", () => {
    expect(claimDisplayName("  林木 ")).toBe("林木");
    expect(claimDisplayName("")).toBeNull();
    expect(claimDisplayName("a\u0007b")).toBeNull();
    expect(claimDisplayName("x".repeat(61))).toBeNull();
  });
});

describe("claim flow (main PersonIdentityService)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cutex-claims-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function fakeClient(script: { claimErrors?: CutexApiError[] } = {}) {
    const errors = [...(script.claimErrors ?? [])];
    const calls: { challenge: number; claims: { publicKey: string; signature: string; nonce: string; displayName?: string | null }[] } = { challenge: 0, claims: [] };
    const client = {
      capabilities: async () => ({ featureList: ["users", "person-identity"] }),
      identityChallenge: async () => ({ nonce: `n${++calls.challenge}`, hostId: "host-a", tokenId: "root", expiresAt: "" }),
      identityClaim: async (claim: (typeof calls.claims)[number]) => {
        calls.claims.push(claim);
        const error = errors.shift();
        if (error) throw error;
        return { outcome: "ownerKeyAdded" as const, tokenId: null, userId: "owner", pending: false, personUserId: "owner", publicKey: claim.publicKey, fingerprint: "" };
      },
    };
    return { client, calls };
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("signs cutex's token id (root) with the nonce, sends nonce + name, and remembers the outcome", async () => {
    const views: PersonIdentityView[] = [];
    const service = new PersonIdentityService(dir, (v) => views.push(v), () => null, () => []);
    service.setDisplayName("林木");
    const { client, calls } = fakeClient();
    service.onConnected({ hostId: "local", credential: "root", epoch: "e1", client });
    await settle();
    expect(calls.claims).toHaveLength(1);
    const claim = calls.claims[0]!;
    expect(claim).toMatchObject({ nonce: "n1", displayName: "林木" });
    const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: claim.publicKey }, format: "jwk" });
    expect(verify(null, Buffer.from("cutex-identity-v1\nhost-a\nn1\nroot", "utf8"), pub, Buffer.from(claim.signature, "base64url"))).toBe(true);
    expect(service.view().claims.local).toMatchObject({ state: "claimed", outcome: "ownerKeyAdded", userId: "owner" });
    // Done: the next connect costs no request.
    service.onConnected({ hostId: "local", credential: "root", epoch: "e2", client });
    await settle();
    expect(calls.challenge).toBe(1);
    expect(views.at(-1)!.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("retries challenge_invalid once with a fresh challenge", async () => {
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    const { client, calls } = fakeClient({ claimErrors: [new CutexApiError(400, "challenge_invalid", "expired")] });
    service.onConnected({ hostId: "ssh-1", credential: "mct-1", epoch: "e1", client });
    await settle();
    expect(calls.claims.map((c) => c.nonce)).toEqual(["n1", "n2"]);
    expect(service.view().claims["ssh-1"]?.state).toBe("claimed");
  });

  it("never marks a host claimed on an error (claims again on the next connect)", async () => {
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    const { client, calls } = fakeClient({ claimErrors: [new CutexApiError(400, "invalid_signature", "no")] });
    service.onConnected({ hostId: "ssh-1", credential: "mct-1", epoch: "e1", client });
    await settle();
    expect(service.view().claims["ssh-1"]).toMatchObject({ state: "failed", errorCode: "invalid_signature" });
    service.onConnected({ hostId: "ssh-1", credential: "mct-1", epoch: "e2", client });
    await settle();
    expect(calls.claims).toHaveLength(2);
    expect(service.view().claims["ssh-1"]?.state).toBe("claimed");
  });
});

describe("person key (main)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("signs the claim message with Ed25519 (verifiable with the raw public key)", () => {
    const key = generatePersonKey();
    expect(base64UrlBytes(key.publicKey)?.length).toBe(32);
    const sig = signClaim(key, { hostId: "h", nonce: "n", tokenId: "t" });
    expect(sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.publicKey }, format: "jwk" });
    expect(verify(null, Buffer.from("cutex-identity-v1\nh\nn\nt", "utf8"), pub, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("fingerprint = first 16 hex of SHA-256 over the raw key (cutex's; same in main and renderer)", () => {
    const key = generatePersonKey();
    const digest = createHash("sha256").update(Buffer.from(key.publicKey, "base64url")).digest();
    expect(key.fingerprint).toBe(digest.toString("hex").slice(0, 16));
    expect(personFingerprint(key.publicKey)).toBe(fingerprintOfDigest(digest));
    expect(groupFingerprint("ab12cd34ef567890")).toBe("ab12 cd34 ef56 7890");
  });

  it("is created once, owner-only, and read back the same", () => {
    dir = mkdtempSync(join(tmpdir(), "cutex-person-"));
    const keyDir = join(dir, "identity");
    const first = loadOrCreatePersonKey(keyDir);
    const again = loadOrCreatePersonKey(keyDir);
    expect(again.publicKey).toBe(first.publicKey);
    if (process.platform !== "win32") expect(statSync(join(keyDir, "person-key.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(keyDir, "person-key.json"), "utf8")).type).toBe("cutex-person-identity");
  });

  it("refuses a damaged file instead of silently becoming someone else", () => {
    dir = mkdtempSync(join(tmpdir(), "cutex-person-"));
    writeFileSync(join(dir, "person-key.json"), "{nope");
    expect(() => loadOrCreatePersonKey(dir!)).toThrow();
  });

  it("a damaged file's error never quotes its text (it may hold the private seed)", () => {
    dir = mkdtempSync(join(tmpdir(), "cutex-person-"));
    const key = generatePersonKey();
    // Truncated mid-seed: JSON.parse would quote the text around the cut.
    const text = serializePersonKey(key);
    writeFileSync(join(dir, "person-key.json"), text.slice(0, text.indexOf(key.file.privateKey) + 20));
    let error: unknown;
    try {
      loadOrCreatePersonKey(dir);
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toBe("person-key.json is damaged (not valid JSON)");
    expect((error as Error).message).not.toContain(key.file.privateKey.slice(0, 8));
    // Through the service: the view's error is the same fixed text.
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    expect(service.view().error).toBe("person-key.json is damaged (not valid JSON)");
    expect(() => parsePersonKey({ ...key.file, version: key.file.privateKey })).toThrow(/^unsupported identity file version$/);
  });

  it("an import must be a consistent pair", () => {
    const a = generatePersonKey();
    const b = generatePersonKey();
    expect(parsePersonKey(JSON.parse(serializePersonKey(a))).publicKey).toBe(a.publicKey);
    expect(() => parsePersonKey({ ...a.file, publicKey: b.publicKey })).toThrow(/does not match/);
    expect(() => parsePersonKey({ ...a.file, type: "other" })).toThrow(/not a cutex identity/);
  });
});

describe("identity key string (main/personKey.ts)", () => {
  const codeOf = (text: string) => {
    try {
      parsePersonKeyString(text);
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(PersonKeyStringError);
      return (error as PersonKeyStringError).code;
    }
  };

  it("is cutex-id- + base64url(seed ‖ first 4 bytes of sha256(\"cutex-id-v1\" ‖ seed)), no padding", () => {
    const key = generatePersonKey();
    const text = encodePersonKeyString(key);
    expect(text).toMatch(/^cutex-id-[A-Za-z0-9_-]{48}$/);
    const seed = Buffer.from(key.file.privateKey, "base64url");
    const sum = createHash("sha256").update("cutex-id-v1").update(seed).digest().subarray(0, 4);
    expect(text).toBe(`cutex-id-${Buffer.concat([seed, sum]).toString("base64url")}`);
  });

  it("round trip: the same public key, fingerprint and signatures; createdAt = now", () => {
    const key = generatePersonKey(new Date("2026-01-01T00:00:00Z"));
    const now = new Date("2026-10-15T01:02:03Z");
    const back = parsePersonKeyString(encodePersonKeyString(key), now);
    expect(back.publicKey).toBe(key.publicKey);
    expect(back.fingerprint).toBe(key.fingerprint);
    expect(back.file.privateKey).toBe(key.file.privateKey);
    expect(back.file.createdAt).toBe(now.toISOString());
    expect(back.sign("m")).toBe(key.sign("m"));
    // …and the stored form of a pasted key reads back as the identity file.
    expect(parsePersonKey(JSON.parse(serializePersonKey(back))).publicKey).toBe(key.publicKey);
  });

  it("ignores whitespace and line breaks around and inside the string", () => {
    const key = generatePersonKey();
    const text = encodePersonKeyString(key);
    const wrapped = `  \n${text.slice(0, 5)}\r\n${text.slice(5, 20)} \t${text.slice(20, 40)}\n  ${text.slice(40)}\n\n`;
    expect(parsePersonKeyString(wrapped).publicKey).toBe(key.publicKey);
  });

  it("a truncated or padded string is incomplete", () => {
    const text = encodePersonKeyString(generatePersonKey());
    expect(codeOf(text.slice(0, -1))).toBe("length");
    expect(codeOf(text.slice(0, 30))).toBe("length");
    expect(codeOf("cutex-id-")).toBe("length");
    expect(codeOf(`${text}A`)).toBe("length");
    expect(codeOf(`${text.slice(0, -1)}=`)).toBe("length");
  });

  it("any one changed character fails the checksum", () => {
    const text = encodePersonKeyString(generatePersonKey());
    const body = "cutex-id-".length;
    for (const at of [body, body + 7, body + 31, body + 42, text.length - 1]) {
      const swapped = text[at] === "A" ? "B" : "A";
      expect(codeOf(text.slice(0, at) + swapped + text.slice(at + 1)), `position ${at}`).toBe("checksum");
    }
  });

  it("a wrong prefix is not an identity key", () => {
    const text = encodePersonKeyString(generatePersonKey());
    expect(codeOf(text.replace("cutex-id-", "cutex-key-"))).toBe("prefix");
    expect(codeOf(text.replace("cutex-id-", "CUTEX-ID-"))).toBe("prefix");
    expect(codeOf(text.slice("cutex-id-".length))).toBe("prefix");
    expect(codeOf("")).toBe("prefix");
    expect(codeOf(serializePersonKey(generatePersonKey()))).toBe("prefix");
  });
});

describe("identity key copy / paste and file import (main PersonIdentityService)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cutex-idkey-"));
    Object.assign(electronFake, { clipboard: "", confirmResponse: 1, confirms: 0, openPath: "" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });
  const texts = { title: "T", message: "{old} → {new}", detail: "", replace: "Replace", cancel: "Cancel" };
  const stored = () => JSON.parse(readFileSync(join(dir, "person-key.json"), "utf8")).publicKey as string;

  it("copy: the string goes to the clipboard (not the result) and is cleared after 60 s while unchanged", async () => {
    vi.useFakeTimers();
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    const r = await service.copyKeyString();
    expect(r).toEqual({ ok: true, clearAfterMs: 60_000 });
    expect(JSON.stringify(r)).not.toContain("cutex-id-");
    expect(parsePersonKeyString(electronFake.clipboard).publicKey).toBe(service.view().publicKey);
    await vi.advanceTimersByTimeAsync(IDENTITY_KEY_CLIPBOARD_MS - 1);
    expect(electronFake.clipboard).toMatch(/^cutex-id-/);
    await vi.advanceTimersByTimeAsync(1);
    expect(electronFake.clipboard).toBe("");
    expect(service.hasPendingKeyClears()).toBe(false);
  });

  it("copy: leaves the clipboard alone when the person copied something else meanwhile", async () => {
    vi.useFakeTimers();
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    await service.copyKeyString();
    electronFake.clipboard = "something else";
    await vi.advanceTimersByTimeAsync(IDENTITY_KEY_CLIPBOARD_MS);
    expect(electronFake.clipboard).toBe("something else");
  });

  it("copying again gives the latest copy a full minute", async () => {
    vi.useFakeTimers();
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    await service.copyKeyString();
    await vi.advanceTimersByTimeAsync(30_000);
    await service.copyKeyString();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(electronFake.clipboard.startsWith("cutex-id-")).toBe(true);
    expect(service.hasPendingKeyClears()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(electronFake.clipboard).toBe("");
    expect(service.hasPendingKeyClears()).toBe(false);
  });

  it("an old pending clipboard read cannot clear a newer copy of the same key", async () => {
    vi.useFakeTimers();
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    await service.copyKeyString();
    const oldText = electronFake.clipboard;
    let finishRead!: (text: string) => void;
    vi.spyOn(clipboard, "readText").mockImplementationOnce(() => new Promise<string>((resolve) => { finishRead = resolve; }));
    await vi.advanceTimersByTimeAsync(60_000);
    await service.copyKeyString();
    finishRead(oldText);
    await vi.advanceTimersByTimeAsync(0);
    expect(electronFake.clipboard.startsWith("cutex-id-")).toBe(true);
    expect(service.hasPendingKeyClears()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(electronFake.clipboard).toBe("");
  });

  it("a failed repeat write does not cancel the original clear", async () => {
    vi.useFakeTimers();
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    await service.copyKeyString();
    await vi.advanceTimersByTimeAsync(30_000);
    vi.spyOn(clipboard, "writeText").mockRejectedValueOnce(new Error("clipboard unavailable"));
    expect(await service.copyKeyString()).toEqual({ ok: false, error: "clipboard unavailable" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(electronFake.clipboard).toBe("");
  });

  it("quitting clears a copied key at once", async () => {
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    await service.copyKeyString();
    expect(service.hasPendingKeyClears()).toBe(true);
    await service.clearCopiedKeysNow();
    expect(electronFake.clipboard).toBe("");
    expect(service.hasPendingKeyClears()).toBe(false);
  });

  it("quit cleanup is bounded and a late read cannot clear the clipboard afterwards", async () => {
    vi.useFakeTimers();
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    await service.copyKeyString();
    const oldText = electronFake.clipboard;
    let finishRead!: (text: string) => void;
    vi.spyOn(clipboard, "readText").mockImplementationOnce(() => new Promise<string>((resolve) => { finishRead = resolve; }));
    const quit = service.clearCopiedKeysNow();
    await vi.advanceTimersByTimeAsync(1_000);
    await quit;
    expect(service.hasPendingKeyClears()).toBe(false);
    electronFake.clipboard = "something else";
    finishRead(oldText);
    await vi.advanceTimersByTimeAsync(0);
    expect(electronFake.clipboard).toBe("something else");
  });

  it("paste: the same identity is a no-op without a confirmation", async () => {
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    const before = stored();
    await service.copyKeyString();
    expect(await service.importKeyString(`\n${electronFake.clipboard}\n`, texts)).toEqual({ ok: true, changed: false });
    expect(electronFake.confirms).toBe(0);
    expect(stored()).toBe(before);
  });

  it("paste: another identity replaces this one after the confirmation; a cancel keeps it", async () => {
    const views: PersonIdentityView[] = [];
    const service = new PersonIdentityService(dir, (v) => views.push(v), () => null, () => []);
    const before = stored();
    const other = generatePersonKey();
    electronFake.confirmResponse = 0;
    expect(await service.importKeyString(encodePersonKeyString(other), texts)).toEqual({ ok: false, canceled: true });
    expect(stored()).toBe(before);
    electronFake.confirmResponse = 1;
    expect(await service.importKeyString(encodePersonKeyString(other), texts)).toEqual({ ok: true, changed: true });
    expect(electronFake.confirms).toBe(2);
    expect(stored()).toBe(other.publicKey);
    expect(service.view().fingerprint).toBe(other.fingerprint);
    expect(views.at(-1)?.publicKey).toBe(other.publicKey);
  });

  it("paste: a bad string is refused with its reason, before any confirmation", async () => {
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    const text = encodePersonKeyString(generatePersonKey());
    expect(await service.importKeyString(text.slice(0, -3), texts)).toMatchObject({ ok: false, errorCode: "length" });
    expect(await service.importKeyString(`x${text}`, texts)).toMatchObject({ ok: false, errorCode: "prefix" });
    expect(await service.importKeyString(null, texts)).toMatchObject({ ok: false, errorCode: "prefix" });
    expect(electronFake.confirms).toBe(0);
  });

  it("the legacy identity file still imports through the same replace path", async () => {
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    const other = generatePersonKey();
    electronFake.openPath = join(dir, "exported.json");
    writeFileSync(electronFake.openPath, serializePersonKey(other));
    expect(await service.importIdentity(texts)).toEqual({ ok: true, changed: true, path: electronFake.openPath });
    expect(stored()).toBe(other.publicKey);
    expect(electronFake.confirms).toBe(1);
    expect(await service.importIdentity(texts)).toEqual({ ok: true, changed: false, path: electronFake.openPath });
    expect(electronFake.confirms).toBe(1);
  });
});

describe("owner's person-key helpers (users module)", () => {
  const K = (c: string) => c.repeat(43);
  const list: Pick<UsersList, "users" | "tokens" | "tokenPersons"> = {
    users: [
      { id: "owner", name: "O", color: null, builtin: true, isOwner: true, grant: null, createdAt: "", updatedAt: "", personKeys: [{ publicKey: K("a"), fingerprint: "aaaa0000", addedAt: "" }] },
      { id: "u-mia", name: "Mia", color: null, builtin: false, isOwner: false, grant: null, createdAt: "", updatedAt: "", personKeys: [{ publicKey: K("m"), fingerprint: "mmmm0000", addedAt: "", label: "laptop" }] },
    ],
    tokens: [
      { tokenId: "t-own", label: "", kind: "client", createdAt: "", userId: "owner", pending: false },
      { tokenId: "t-new", label: "", kind: "client", createdAt: "", userId: "owner", pending: false },
      { tokenId: "t-swap", label: "", kind: "client", createdAt: "", userId: "owner", pending: false },
      { tokenId: "t-none", label: "", kind: "device", createdAt: "", userId: "owner", pending: false },
    ],
    tokenPersons: { "t-own": K("a"), "t-new": K("z"), "t-swap": K("m") },
  };
  it("classifies what each token presented against its binding", () => {
    const owners = personKeyOwners(list.users);
    expect(tokenPerson(list, list.tokens[0]!, owners).kind).toBe("matches");
    expect(tokenPerson(list, list.tokens[1]!, owners).kind).toBe("unknown");
    expect(tokenPerson(list, list.tokens[2]!, owners)).toMatchObject({ kind: "other", ownerId: "u-mia" });
    expect(tokenPerson(list, list.tokens[3]!, owners).kind).toBe("none");
  });
  it("prefers cutex's token.person: holder, name, fingerprint, previousPublicKey", () => {
    const token = { tokenId: "t-p", label: "", kind: "client", createdAt: "", userId: null, pending: true, person: { publicKey: K("q"), fingerprint: "0123456789abcdef", userId: null, displayName: "Kai (laptop)", claimedAt: "", previousPublicKey: null } };
    expect(tokenPerson(list, token)).toMatchObject({ kind: "unknown", displayName: "Kai (laptop)", fingerprint: "0123456789abcdef", changed: false });
    const swapped = { ...token, userId: "owner", pending: false, person: { ...token.person, userId: "owner", previousPublicKey: K("z") } };
    expect(tokenPerson(list, swapped)).toMatchObject({ kind: "matches", changed: true });
    expect(tokenPerson(list, { ...token, person: null })).toMatchObject({ kind: "none" });
  });
  it("person_key_in_use reads with the holder's name", () => {
    const t = (key: string, vars?: Record<string, string | number>) => `${key}:${vars?.name ?? ""}`;
    expect(refusalText({ code: "person_key_in_use", message: "", userId: "u-mia", publicKey: K("m") }, t, undefined, (id) => (id === "u-mia" ? "Mia" : id))).toBe("users.error.person_key_in_use:Mia");
  });
  it("offers each unknown key once per user", () => {
    expect(unknownKeysOf(list, "owner")).toEqual([{ publicKey: K("z"), tokenIds: ["t-new"] }]);
    expect(unknownKeysOf(list, "u-mia")).toEqual([]);
  });
  it("builds whole-list PUT bodies (labels kept, no duplicates)", () => {
    const mia = list.users[1]!;
    expect(withPersonKey(mia, { publicKey: K("z") })).toEqual([{ publicKey: K("m"), label: "laptop" }, { publicKey: K("z") }]);
    expect(withPersonKey(mia, { publicKey: K("m") })).toHaveLength(1);
    expect(withoutPersonKey(mia, K("m"))).toEqual([]);
    expect(personKeysBody([{ publicKey: K("m") }, { publicKey: K("m"), label: "x" }])).toEqual({ personKeys: [{ publicKey: K("m") }] });
    expect(() => personKeysBody([{ publicKey: "short" }])).toThrow();
  });
});

describe("你能访问的主机 rows", () => {
  const base = { connected: true, featuresKnown: true, projects: [{ id: "p1", name: "Desktop" }, { id: "p2", name: "Lab" }] };
  it("owner, older host, pending and unknown", () => {
    expect(myAccessRow({ ...base, access: { ...OWNER_ACCESS, known: true }, features: new Set(["users"]) })).toMatchObject({ role: "owner", send: true, projects: "all" });
    expect(myAccessRow({ ...base, access: { ...OWNER_ACCESS, known: true }, features: new Set() }).role).toBe("older");
    expect(myAccessRow({ ...base, access: { isOwner: false, pending: true, userId: null, name: null, grant: null, known: true }, features: new Set() })).toMatchObject({ role: "pending", send: null, projects: null });
    expect(myAccessRow({ ...base, connected: false, access: { ...OWNER_ACCESS, known: false }, features: new Set() }).role).toBe("unknown");
  });
  it("a member: your name there (the one you set, else the owner's label — as the banner), send / read-only, the granted projects shown", () => {
    const access = { isOwner: false, pending: false, userId: "u-1", name: "同事A", grant: { projects: ["p2", "gone"], standaloneAgents: ["s1"], send: false }, known: true };
    expect(myAccessRow({ ...base, access, features: new Set() })).toEqual({ role: "member", userName: "同事A", send: false, projects: ["Lab"], standalone: 1 });
    expect(myAccessRow({ ...base, access: { ...access, displayName: "Mia Chen" }, features: new Set() }).userName).toBe("Mia Chen");
    expect(myAccessRow({ ...base, access: { ...access, displayName: null, name: " " }, features: new Set() }).userName).toBe("u-1");
    expect(myAccessRow({ ...base, access: { ...access, grant: { projects: "all", standaloneAgents: [], send: true } }, features: new Set() })).toMatchObject({ send: true, projects: "all" });
  });
  it("folds long project lists after 5", () => {
    expect(foldNames(["a", "b", "c", "d", "e", "f", "g"])).toEqual({ shown: ["a", "b", "c", "d", "e"], more: 2 });
    expect(foldNames(["a", "b", "c", "d", "e", "f", "g"], 5, true).more).toBe(0);
  });
});

describe("你在各主机上: this desktop on the host", () => {
  const nameOf = (x: { name: string }) => x.name;
  const base = { local: false, tokenId: "mct-1", ownToken: undefined, listed: undefined, nameOf };
  it("the root credential: this machine's cutex (C1 null, or the local host without a token id)", () => {
    expect(myDeviceLine({ ...base, role: "owner", local: true, tokenId: null })).toEqual({ kind: "root" });
    expect(myDeviceLine({ ...base, role: "owner", ownToken: null })).toEqual({ kind: "root" });
    expect(myDeviceLine({ ...base, role: "owner", tokenId: null })).toBeNull();
  });
  it("a token's name from C1, else the owner's listing; a pending device is told what to say", () => {
    expect(myDeviceLine({ ...base, role: "owner", listed: { name: "host-a" } })).toEqual({ kind: "token", name: "host-a" });
    expect(myDeviceLine({ ...base, role: "member", ownToken: { name: "Mia 的笔记本" }, listed: { name: "x" } })).toEqual({ kind: "token", name: "Mia 的笔记本" });
    expect(myDeviceLine({ ...base, role: "pending", ownToken: { name: "kai-laptop" } })).toEqual({ kind: "tell", name: "kai-laptop" });
    expect(myDeviceLine({ ...base, role: "member" })).toBeNull(); // no C1: omitted
    expect(myDeviceLine({ ...base, role: "unknown", ownToken: { name: "x" } })).toBeNull();
  });
  it("reads C1's user.token: absent on older hosts, null for the root credential", () => {
    expect(selfTokenOf({ user: { id: "owner", isOwner: true } })).toBeUndefined();
    expect(selfTokenOf({ user: { id: "owner", isOwner: true, token: null } })).toBeNull();
    expect(selfTokenOf({ user: { isOwner: false, pending: true, token: { id: "mct-1", label: "desktop-x", deviceName: " ", ownerName: "Mia's", platform: null } } })).toEqual({ id: "mct-1", label: "desktop-x", deviceName: null, ownerName: "Mia's", platform: null });
    expect(hostUserAccessOf({ user: { id: null, isOwner: false, pending: true, grant: null, token: { id: "mct-2", label: "l" } } })).toMatchObject({ pending: true, token: { id: "mct-2" } });
    expect("token" in hostUserAccessOf({})).toBe(false);
  });
});

describe("你在各主机上: exceptions and claim moments", () => {
  it("shows at most one exception, failures first, nothing when all is well", () => {
    expect(hostIssue({ sync: { state: "synced" }, claim: { state: "claimed" }, selfUnknown: false })).toBeNull();
    expect(hostIssue({ sync: { state: "unsupported" }, claim: undefined, selfUnknown: false })).toMatchObject({ key: "me.access.issue.unsupported" });
    expect(hostIssue({ sync: { state: "unsupported" }, claim: undefined, selfUnknown: false, noUsers: true })).toBeNull();
    expect(hostIssue({ sync: { state: "failed", error: "e" }, claim: { state: "failed" }, selfUnknown: true })).toMatchObject({ key: "me.access.issue.syncFailed" });
    expect(hostIssue({ sync: { state: "changedElsewhere" }, claim: { state: "failed", error: "x" }, selfUnknown: true })).toEqual({ key: "me.access.issue.claimFailed", tone: "danger", error: "x" });
    expect(hostIssue({ sync: { state: "unsupported" }, claim: undefined, selfUnknown: true })).toMatchObject({ key: "me.access.issue.selfUnknown", remember: true });
    expect(hostIssue({ sync: { state: "changedElsewhere" }, claim: undefined, selfUnknown: false })?.key).toBe("me.access.issue.changedElsewhere");
  });
  it("a host that does not know this desktop's key (person-identity hosts only)", () => {
    const users = [{ personKeys: [{ publicKey: "A", fingerprint: "", addedAt: "" }] }, { personKeys: [] }];
    expect(selfKeyUnknown(users, "B")).toBe(true);
    expect(selfKeyUnknown(users, "A")).toBe(false);
    expect(selfKeyUnknown([{}], "B")).toBe(false);
    expect(selfKeyUnknown(users, null)).toBe(false);
  });
  it("toasts only new autoBound / ownerKeyAdded claims", () => {
    const before = { a: { state: "claiming" as const }, b: { state: "claimed" as const, outcome: "ownerKeyAdded" as const, at: "1" } };
    const after = { a: { state: "claimed" as const, outcome: "autoBound" as const, userId: "u-1", at: "2" }, b: { state: "claimed" as const, outcome: "ownerKeyAdded" as const, at: "1" }, c: { state: "claimed" as const, outcome: "recorded" as const, at: "3" } };
    expect(claimTransitions(before, after)).toEqual([{ hostId: "a", outcome: "autoBound", userId: "u-1" }]);
  });
});

describe("a claim in flight when the key or name changes (main PersonIdentityService)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cutex-rerun-"));
    Object.assign(electronFake, { clipboard: "", confirmResponse: 1, confirms: 0, openPath: "" });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const texts = { title: "T", message: "{old} → {new}", detail: "", replace: "Replace", cancel: "Cancel" };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  /** The first claim waits until `release()`; later ones answer at once. */
  function gatedClient() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const claims: { publicKey: string; displayName?: string | null }[] = [];
    const client = {
      capabilities: async () => ({ featureList: ["users", "person-identity"] }),
      identityChallenge: async () => ({ nonce: `n${claims.length + 1}`, hostId: "host-a", tokenId: "root", expiresAt: "" }),
      identityClaim: async (claim: { publicKey: string; signature: string; nonce: string; displayName?: string | null }) => {
        claims.push(claim);
        if (claims.length === 1) await gate;
        return { outcome: "pending" as const, tokenId: null, userId: "u1", pending: true, personUserId: null, publicKey: claim.publicKey, fingerprint: "" };
      },
    };
    return { client, claims, release };
  }

  it("claims the imported key after the old key's claim finishes", async () => {
    const { client, claims, release } = gatedClient();
    const target = { hostId: "ssh-1", credential: "mct-1", epoch: "e1", client };
    const service = new PersonIdentityService(dir, () => {}, () => null, () => [target]);
    const oldKey = service.view().publicKey;
    service.onConnected(target);
    await settle();
    expect(claims).toHaveLength(1);
    const next = generatePersonKey();
    expect(await service.importKeyString(encodePersonKeyString(next), texts)).toEqual({ ok: true, changed: true });
    release();
    await settle();
    expect(claims.map((c) => c.publicKey)).toEqual([oldKey, next.publicKey]);
    expect(service.view().claims["ssh-1"]?.state).toBe("claimed");
  });

  it("claims a pending device again with the name set during its claim", async () => {
    const { client, claims, release } = gatedClient();
    const target = { hostId: "ssh-1", credential: "mct-1", epoch: "e1", client };
    const service = new PersonIdentityService(dir, () => {}, () => null, () => [target]);
    service.setDisplayName("A");
    service.onConnected(target);
    await settle();
    service.setDisplayName("B");
    release();
    await settle();
    expect(claims.map((c) => c.displayName)).toEqual(["A", "B"]);
  });
});

describe.skipIf(process.platform === "win32")("identity export (main PersonIdentityService)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cutex-export-"));
  });
  afterEach(() => {
    electronFake.savePath = "";
    rmSync(dir, { recursive: true, force: true });
  });

  it("exporting over an existing world-readable file leaves it owner-only", async () => {
    const service = new PersonIdentityService(join(dir, "identity"), () => {}, () => null, () => []);
    const out = join(dir, "export.json");
    writeFileSync(out, "old", { mode: 0o644 });
    electronFake.savePath = out;
    expect(await service.exportIdentity("T")).toEqual({ ok: true, path: out });
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(parsePersonKey(JSON.parse(readFileSync(out, "utf8"))).publicKey).toBe(service.view().publicKey);
  });

  it("a new export file is owner-only too", async () => {
    const service = new PersonIdentityService(join(dir, "identity"), () => {}, () => null, () => []);
    electronFake.savePath = join(dir, "new.json");
    expect(await service.exportIdentity("T")).toMatchObject({ ok: true });
    expect(statSync(electronFake.savePath).mode & 0o777).toBe(0o600);
  });
});
