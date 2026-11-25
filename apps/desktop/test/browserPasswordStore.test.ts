// Saved browser passwords: the vault crypto, the store over a key guard + slots (dev guard and in-memory slots: no OS
// dialog, no Credential Manager), and the pure Windows helpers. The real Credential Manager test is
// browserPasswordsWincred.integration.test.ts (env-gated).
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { devMemoryGuard, memorySlots, safeStorageGuard, type FakeVerdict, type PromptReason } from "../src/main/browser/passwords/guards";
import { createPasswordStore, GRACE_MS } from "../src/main/browser/passwords/store";
import { generateVaultKeys, openFromVault, sealToVault, vaultAad } from "../src/main/browser/passwords/vault";
import { helloFailure, helloWrap, rsaPublicBlobToSpki } from "../src/main/browser/passwords/win32";
import { createPlatformPasswordStore } from "../src/main/browser/passwords";

const ORIGIN = "https://login.example.com";
const secret = (text: string) => Buffer.from(text, "utf8");

describe("vault", () => {
  const entry = { id: "a".repeat(32), identityId: "default", origin: ORIGIN };
  it("seals to the public key and opens only with the vault key and the same entry", () => {
    const pair = generateVaultKeys(), other = generateVaultKeys();
    const sealed = sealToVault(pair.publicKey, secret("hunter2"), vaultAad(entry));
    expect(sealed.includes(Buffer.from("hunter2"))).toBe(false);
    expect(openFromVault(pair, sealed, vaultAad(entry)).toString()).toBe("hunter2");
    expect(() => openFromVault(other, sealed, vaultAad(entry))).toThrow("unreadable");
    expect(() => openFromVault(pair, sealed, vaultAad({ ...entry, origin: "https://evil.example.com" }))).toThrow("unreadable");
    const tampered = Buffer.from(sealed); tampered[tampered.length - 1]! ^= 1;
    expect(() => openFromVault(pair, tampered, vaultAad(entry))).toThrow("unreadable");
  });
});

function harness(options: { verdict?: () => FakeVerdict; grace?: boolean } = {}) {
  let now = 1_000_000;
  let grace = options.grace ?? false;
  let indexText: string | null = null;
  const unlocked = vi.fn();
  const guard = devMemoryGuard(async () => options.verdict?.() ?? "ok");
  const slots = memorySlots();
  const make = () => createPasswordStore({ kind: "devMemory", guard, slots, index: { read: () => indexText, write: (t) => { indexText = t; } }, graceEnabled: () => grace, now: () => now, onUnlocked: unlocked });
  const store = make();
  return { store, make, guard, slots, unlocked, index: () => indexText, advance: (ms: number) => { now += ms; }, setGrace: (on: boolean) => { grace = on; } };
}

async function fillValue(store: ReturnType<typeof harness>["store"], id: string): Promise<string> {
  let seen = "";
  let held: Buffer | null = null;
  await store.useForFill(id, async (s) => { seen = s.toString(); held = s; });
  expect(held!.every((b) => b === 0)).toBe(true); // zeroed after use
  return seen;
}

describe("password store", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("saves without the password in the index or the slot, and asks once to create the key", async () => {
    const h = harness();
    const input = secret("correct horse");
    const saved = await h.store.save("default", ORIGIN, "mika@example.com", input);
    expect(input.every((b) => b === 0)).toBe(true);
    expect(saved).toMatchObject({ identityId: "default", origin: ORIGIN, username: "mika@example.com", revision: 1 });
    expect(h.index()).not.toContain("correct horse");
    for (const { blob } of h.slots.map.values()) expect(blob.includes(Buffer.from("correct horse"))).toBe(false);
    expect(h.slots.map.get(`default/${saved.id}`)?.comment).toBe(`Cutex 浏览器保存 · ${ORIGIN}`);
    await h.store.save("default", "https://other.example.com", "x", secret("p2"));
    expect(h.guard.prompts).toEqual<PromptReason[]>(["create"]);
    expect((await h.store.list("default", ORIGIN)).map((l) => l.username)).toEqual(["mika@example.com"]);
  });

  it("asks before every fill / show / copy by default; refuses on cancel without handing the secret over", async () => {
    let verdict: FakeVerdict = "ok";
    const h = harness({ verdict: () => verdict });
    const { id } = await h.store.save("default", ORIGIN, "u", secret("pw-1"));
    expect(await fillValue(h.store, id)).toBe("pw-1");
    expect(await fillValue(h.store, id)).toBe("pw-1");
    const shown = await h.store.reveal(id, "show");
    expect(shown.toString()).toBe("pw-1");
    expect(h.guard.prompts).toEqual(["create", "fill", "fill", "show"]);
    verdict = "cancel";
    const use = vi.fn();
    await expect(h.store.useForFill(id, use)).rejects.toThrow("auth_cancelled");
    expect(use).not.toHaveBeenCalled();
    verdict = "unavailable";
    await expect(h.store.reveal(id, "copy")).rejects.toThrow("auth_unavailable");
  });

  it("「5 分钟内不再问」 remembers one unlock in memory for 5 minutes; lock() and the pref turning off forget it", async () => {
    const h = harness({ grace: true });
    const { id } = await h.store.save("default", ORIGIN, "u", secret("pw"));
    await Promise.all([fillValue(h.store, id), fillValue(h.store, id)]); // two at once: one prompt
    expect(h.guard.prompts).toEqual(["create", "fill"]);
    expect(h.unlocked).toHaveBeenCalledTimes(1); // install.ts starts listening for screen lock / suspend here
    h.advance(GRACE_MS - 1000);
    await fillValue(h.store, id);
    expect(h.guard.prompts.length).toBe(2);
    expect(h.store.unlocked()).toBe(true);
    h.advance(2000);
    await fillValue(h.store, id);
    expect(h.guard.prompts.length).toBe(3);
    h.store.lock();
    await fillValue(h.store, id);
    expect(h.guard.prompts.length).toBe(4);
    h.setGrace(false);
    expect(h.store.unlocked()).toBe(false);
    await fillValue(h.store, id);
    await fillValue(h.store, id);
    expect(h.guard.prompts.length).toBe(6);
  });

  it("after a Windows Hello reset the entries are unreadable (status says so); a new save starts a new key", async () => {
    const h = harness();
    const old = await h.store.save("default", ORIGIN, "old", secret("pw-old"));
    expect(await h.store.status()).toMatchObject({ available: true, keyLost: false, unreadable: 0, graceMinutes: 0 });
    h.guard.forget();
    expect(await h.store.status()).toMatchObject({ keyLost: true, unreadable: 1 });
    await expect(h.store.useForFill(old.id, async () => {})).rejects.toThrow("key_lost");
    const fresh = await h.store.save("default", ORIGIN, "new", secret("pw-new"));
    expect(h.guard.prompts.filter((p) => p === "create")).toHaveLength(2);
    expect(await fillValue(h.store, fresh.id)).toBe("pw-new");
    expect(await h.store.status()).toMatchObject({ keyLost: false, unreadable: 1 });
    await expect(h.store.useForFill(old.id, async () => {})).rejects.toThrow("key_lost");
    await h.store.remove(old.id);
    expect(await h.store.status()).toMatchObject({ keyLost: false, unreadable: 0 });
  });

  it("same identity + origin + user name updates in place; user name edits keep the sealed value", async () => {
    const h = harness();
    const a = await h.store.save("default", ORIGIN, "u", secret("one"));
    const b = await h.store.save("default", ORIGIN, "u", secret("two"));
    expect(b.id).toBe(a.id);
    expect(b.revision).toBe(2);
    const renamed = await h.store.update(a.id, { username: "u2" });
    expect(renamed).toMatchObject({ username: "u2", revision: 3 });
    expect(h.slots.map.get(`default/${a.id}`)?.username).toBe("u2");
    expect(await fillValue(h.store, a.id)).toBe("two");
    await h.store.update(a.id, { secret: secret("three") });
    expect(await fillValue(h.store, a.id)).toBe("three");
  });

  it("reconciles with the slots: deleted in Control Panel → gone; a slot the index lost → adopted", async () => {
    const h = harness();
    const keep = await h.store.save("default", ORIGIN, "keep", secret("k"));
    const gone = await h.store.save("default", ORIGIN, "gone", secret("g"));
    h.slots.map.delete(`default/${gone.id}`);
    const restarted = h.make();
    expect((await restarted.list("default")).map((l) => l.id)).toEqual([keep.id]);
    // Index lost: the slot's comment names its origin.
    const fresh = createPasswordStore({ kind: "devMemory", guard: h.guard, slots: h.slots, index: { read: () => null, write: () => {} }, graceEnabled: () => false });
    const adopted = await fresh.list("default");
    expect(adopted).toEqual([expect.objectContaining({ id: keep.id, origin: ORIGIN, username: "keep" })]);
    let value = "";
    await fresh.useForFill(keep.id, async (s) => { value = s.toString(); });
    expect(value).toBe("k");
  });

  it("removeIdentity deletes its slots and 「从不保存」 list only", async () => {
    const h = harness();
    const other = "0123456789abcdef0123456789abcdef";
    await h.store.save("default", ORIGIN, "a", secret("1"));
    await h.store.save(other, ORIGIN, "b", secret("2"));
    await h.store.neverSave.add(other, "https://never.example.com");
    expect(await h.store.removeIdentity(other)).toBe(1);
    expect(await h.store.list(other)).toEqual([]);
    expect(await h.store.neverSave.list(other)).toEqual([]);
    expect(await h.store.list("default")).toHaveLength(1);
    expect([...h.slots.map.keys()].filter((k) => k.startsWith(other))).toEqual([]);
    expect(JSON.parse(h.index()!).deleted).toEqual([expect.objectContaining({ identityId: other })]);
  });

  it("refuses bad input", async () => {
    const h = harness();
    await expect(h.store.save("default", "javascript:alert(1)", "u", secret("x"))).rejects.toThrow("invalid_request");
    await expect(h.store.save("nope", ORIGIN, "u", secret("x"))).rejects.toThrow("invalid_request");
    await expect(h.store.save("default", ORIGIN, "u", Buffer.alloc(0))).rejects.toThrow("invalid_password");
    await expect(h.store.save("default", ORIGIN, "u", Buffer.alloc(2000, 1))).rejects.toThrow("invalid_password");
    await expect(h.store.save("default", ORIGIN, "a\nb", secret("x"))).rejects.toThrow("invalid_request");
  });
});

describe("platform choice", () => {
  const base = { userData: "unused", locale: () => "zh-CN", graceEnabled: () => false, safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" } };
  it("a dev build uses the in-memory store with the stand-in verifier (no OS dialog in tests)", async () => {
    const store = createPlatformPasswordStore({ ...base, packaged: false, env: {} });
    expect(store.kind).toBe("devMemory");
    const cancel = createPlatformPasswordStore({ ...base, packaged: false, env: { CUTEX_DESKTOP_PASSWORD_VERIFY: "cancel" } });
    const { id } = await cancel.save("default", ORIGIN, "u", secret("x")).catch(() => ({ id: "" }));
    expect(id).toBe(""); // creating the key already asks, and the stand-in cancels
  });
  it("a packaged build never uses the in-memory store", () => {
    expect(createPlatformPasswordStore({ ...base, packaged: true, env: { CUTEX_DESKTOP_PASSWORD_STORE: "devMemory" }, platform: "linux" }).kind).toBe("secure");
  });
  it("Linux without a keyring (basic_text) is unavailable, never plaintext", async () => {
    const guard = safeStorageGuard({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text", encryptString: () => Buffer.alloc(0), decryptString: () => "" });
    if (process.platform === "linux") expect(await guard.availability()).toEqual({ available: false, reason: "noKeyring" });
    await expect(safeStorageGuard({ isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" }).wrap(Buffer.from("k"), null)).rejects.toThrow("auth_unavailable");
  });
});

describe("Windows helpers (pure)", () => {
  it("converts a BCRYPT_RSAPUBLIC_BLOB and wraps with PKCS#1 v1.5 for the Passport provider", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
    const e = Buffer.from(jwk.e, "base64url"), n = Buffer.from(jwk.n, "base64url");
    const header = Buffer.alloc(24);
    header.writeUInt32LE(0x31415352, 0); header.writeUInt32LE(2048, 4); header.writeUInt32LE(e.length, 8); header.writeUInt32LE(n.length, 12);
    const spki = rsaPublicBlobToSpki(Buffer.concat([header, e, n]));
    expect(spki.equals(publicKey.export({ type: "spki", format: "der" }) as Buffer)).toBe(true);
    const wrapped = helloWrap(spki, Buffer.from("vault-key"));
    // Node refuses PKCS#1 v1.5 private decryption by default (Marvin); the Passport provider does it. Check the padding type only.
    expect(wrapped.length).toBe(256);
    expect(() => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING }, wrapped)).toThrow();
  });
  it("maps NCrypt failures to the contract's refusals", () => {
    expect(helloFailure(0x80090036)).toBe("auth_cancelled"); // NTE_USER_CANCELLED
    expect(helloFailure(0x800704c7 | 0)).toBe("auth_cancelled");
    expect(helloFailure(0x8009000d | 0)).toBe("key_lost"); // NTE_NO_KEY
    expect(helloFailure(0x80090016)).toBe("key_lost");
    expect(helloFailure(0x80090027)).toBe("auth_unavailable");
  });
});

describe("data-folder scope (Windows)", () => {
  it("the app's own data folder uses 「Cutex 浏览器/」; another data folder never shares the owner's credentials or Hello key", async () => {
    const { credentialPrefix } = await import("../src/main/browser/passwords/guards");
    const { dataScope } = await import("../src/main/browser/passwords");
    expect(credentialPrefix(null)).toBe("Cutex 浏览器/");
    const scope = dataScope("D:/Rehearsal/userdata");
    expect(scope).toMatch(/^[a-f0-9]{8}$/);
    expect(dataScope("d:/rehearsal/USERDATA")).toBe(scope);
    expect(credentialPrefix(scope)).toBe(`Cutex 浏览器 (${scope})/`);
    expect(credentialPrefix(scope).startsWith(credentialPrefix(null))).toBe(false); // CredEnumerate "Cutex 浏览器/*" never lists it
  });
});
