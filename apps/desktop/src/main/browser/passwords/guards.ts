// Key guards: what protects the vault's private key, and where sealed entries are kept.
//   hello        Windows: an RSA key inside Windows Hello wraps it; unwrapping shows Windows' own Hello prompt.
//   safeStorage  Linux (libsecret / kwallet only, never basic_text) and macOS (Keychain): no per-use verification yet.
//   devMemory    tests and the isolated dev runs: an injected verifier stands in for Hello; no OS dialog ever.
import type { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import type { BrowserPasswordStoreStatus } from "../../../shared/browserIdentity";

export type GuardFailure = "auth_cancelled" | "auth_unavailable" | "key_lost";
export class GuardError extends Error { constructor(readonly code: GuardFailure) { super(code); } }

export type PromptReason = "create" | "fill" | "show" | "copy" | "grace";

export interface KeyGuard {
  readonly kind: "hello" | "safeStorage" | "devMemory";
  availability(): Promise<{ available: true } | { available: false; reason: NonNullable<BrowserPasswordStoreStatus["reason"]> }>;
  /** Protects the vault key. Hello: creates the Hello key on first use (Windows prompts once). Returns the guard's id. */
  wrap(secret: Buffer, window: BrowserWindow | null): Promise<{ guardId: string; wrapped: Buffer }>;
  /** Asks the owner (Hello) and returns the vault key; GuardError on cancel / no Hello / key gone. */
  unwrap(wrapped: Buffer, guardId: string, reason: PromptReason, window: BrowserWindow | null): Promise<Buffer>;
  /** Without a prompt: does the key that wrapped `guardId` still exist (Hello reset / another PC → false)? */
  present(guardId: string): Promise<boolean>;
}

/** Where sealed entries live: Credential Manager on Windows; an app file elsewhere and in dev. */
export interface SecretSlots {
  write(name: string, username: string, comment: string, blob: Buffer): Promise<void>;
  read(name: string): Promise<Buffer | null>;
  remove(name: string): Promise<boolean>;
  list(): Promise<{ name: string; username: string; comment: string }[]>;
}

const fingerprint = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 32);

const PROMPT: Record<"zh" | "en", Record<PromptReason, string>> = {
  zh: {
    create: "Cutex 浏览器：建立保管已保存密码的钥匙",
    fill: "Cutex 浏览器：填写保存的密码",
    show: "Cutex 浏览器：显示保存的密码",
    grace: "Cutex 浏览器：开启「验证后 5 分钟内不再问」",
    copy: "Cutex 浏览器：复制保存的密码",
  },
  en: {
    create: "Cutex browser: set up the key that protects saved passwords",
    fill: "Cutex browser: fill a saved password",
    show: "Cutex browser: show a saved password",
    grace: "Cutex browser: turn on \"don't ask again for 5 minutes\"",
    copy: "Cutex browser: copy a saved password",
  },
};
export const promptText = (reason: PromptReason, locale: string) => PROMPT[locale.startsWith("zh") ? "zh" : "en"][reason];

const hwndOf = (window: BrowserWindow | null): bigint | null => {
  if (!window || window.isDestroyed()) return null;
  const handle = window.getNativeWindowHandle();
  return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
};

/**
 * Windows Hello guard (koffi, ./win32). `scope`: null for the app's own data folder; a short id for an instance
 * with its own CUTEX_DESKTOP_USER_DATA (rehearsals, isolated runs), so it never reuses or replaces the owner's key.
 */
export function helloGuard(locale: () => string, scope: string | null = null): KeyGuard {
  const HELLO_KEY = scope ? `vault-v1-${scope}` : "vault-v1";
  const win = () => import("./win32");
  return {
    kind: "hello",
    async availability() {
      try {
        const value = await (await win()).helloAvailability();
        return value === 0 ? { available: true } : { available: false, reason: "noHello" };
      } catch { return { available: false, reason: "unsupported" }; }
    },
    async wrap(secret, window) {
      const w = await win();
      let spki: Buffer;
      if (await w.helloKeyExists(HELLO_KEY)) spki = await w.helloKeyPublic(HELLO_KEY);
      else {
        // Brings the app forward so Windows' prompt sits on it (the prompt is owned by this window's handle too).
        if (window && !window.isDestroyed()) window.focus();
        try { spki = await w.helloKeyCreate(HELLO_KEY, hwndOf(window), promptText("create", locale())); }
        catch (error) { throw new GuardError(error instanceof w.Win32Error ? w.helloFailure(error.code) : "auth_unavailable"); }
      }
      return { guardId: fingerprint(spki), wrapped: w.helloWrap(spki, secret) };
    },
    async unwrap(wrapped, guardId, reason, window) {
      const w = await win();
      if (!(await this.present(guardId))) throw new GuardError("key_lost");
      if (window && !window.isDestroyed()) window.focus();
      try { return await w.helloUnwrap(HELLO_KEY, wrapped, hwndOf(window), promptText(reason, locale())); }
      catch (error) { throw new GuardError(error instanceof w.Win32Error ? w.helloFailure(error.code) : "auth_unavailable"); }
    },
    async present(guardId) {
      const w = await win();
      if (!(await w.helloKeyExists(HELLO_KEY))) return false;
      return fingerprint(await w.helloKeyPublic(HELLO_KEY)) === guardId;
    },
  };
}

/**
 * Credential Manager slots: `Cutex 浏览器/<name>` (another data folder: `Cutex 浏览器 (<scope>)/<name>`); the owner sees
 * them in Control Panel (Windows credentials).
 */
export const credentialPrefix = (scope: string | null) => (scope ? `Cutex 浏览器 (${scope})/` : "Cutex 浏览器/");
export function credentialSlots(prefix = credentialPrefix(null)): SecretSlots {
  const win = () => import("./win32");
  return {
    async write(name, username, comment, blob) { await (await win()).credWrite(prefix + name, username, comment, blob); },
    async read(name) { return (await win()).credRead(prefix + name); },
    async remove(name) { return (await win()).credDelete(prefix + name); },
    async list() {
      return (await (await win()).credList(prefix)).map((c) => ({ name: c.target.slice(prefix.length), username: c.username, comment: c.comment }));
    },
  };
}

/** safeStorage guard (Linux / macOS). `basic_text` (no keyring) is refused: never a plaintext fallback. */
export type SafeStorageLike = Pick<Electron.SafeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString"> & { getSelectedStorageBackend?: () => string };
/** `source`: Electron's safeStorage, read when first used. */
export function safeStorageGuard(source: SafeStorageLike | (() => SafeStorageLike)): KeyGuard {
  const storage = () => (typeof source === "function" ? source() : source);
  const safeStorage = {
    isEncryptionAvailable: () => storage().isEncryptionAvailable(),
    encryptString: (text: string) => storage().encryptString(text),
    decryptString: (data: Buffer) => storage().decryptString(data),
    getSelectedStorageBackend: () => storage().getSelectedStorageBackend?.() ?? "unknown",
  };
  const usable = () => {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform !== "linux") return true;
    const backend = safeStorage.getSelectedStorageBackend?.() ?? "unknown";
    return backend === "gnome_libsecret" || backend.startsWith("kwallet");
  };
  return {
    kind: "safeStorage",
    async availability() { return usable() ? { available: true } : { available: false, reason: "noKeyring" }; },
    async wrap(secret) {
      if (!usable()) throw new GuardError("auth_unavailable");
      return { guardId: "safeStorage", wrapped: safeStorage.encryptString(secret.toString("base64")) };
    },
    async unwrap(wrapped) {
      if (!usable()) throw new GuardError("auth_unavailable");
      try { return Buffer.from(safeStorage.decryptString(wrapped), "base64"); } catch { throw new GuardError("key_lost"); }
    },
    async present() { return usable(); },
  };
}

export type FakeVerdict = "ok" | "cancel" | "unavailable";

/**
 * Dev / test only (never in a packaged build): the "key" is kept as is and `verify` stands in for Windows Hello.
 * `forget()` simulates a Hello reset.
 */
export function devMemoryGuard(verify: (reason: PromptReason) => Promise<FakeVerdict> = async () => "ok"): KeyGuard & { forget(): void; prompts: PromptReason[] } {
  let generation = 1;
  const prompts: PromptReason[] = [];
  const ask = async (reason: PromptReason) => {
    prompts.push(reason);
    const verdict = await verify(reason);
    if (verdict === "cancel") throw new GuardError("auth_cancelled");
    if (verdict === "unavailable") throw new GuardError("auth_unavailable");
  };
  let created = false;
  return {
    kind: "devMemory",
    prompts,
    forget() { generation++; created = false; },
    async availability() { return { available: true }; },
    async wrap(secret) {
      if (!created) { await ask("create"); created = true; }
      return { guardId: `dev-${generation}`, wrapped: Buffer.from(secret) };
    },
    async unwrap(wrapped, guardId, reason) {
      if (guardId !== `dev-${generation}`) throw new GuardError("key_lost");
      await ask(reason);
      return Buffer.from(wrapped);
    },
    async present(guardId) { return guardId === `dev-${generation}`; },
  };
}

/** In-memory slots (dev / tests) or a JSON file (Linux / macOS: entries are sealed already; the file adds no secret). */
export function memorySlots(initial?: Map<string, { username: string; comment: string; blob: Buffer }>): SecretSlots & { map: Map<string, { username: string; comment: string; blob: Buffer }> } {
  const map = initial ?? new Map();
  return {
    map,
    async write(name, username, comment, blob) { map.set(name, { username, comment, blob: Buffer.from(blob) }); },
    async read(name) { const v = map.get(name); return v ? Buffer.from(v.blob) : null; },
    async remove(name) { const had = map.get(name); if (had) had.blob.fill(0); return map.delete(name); },
    async list() { return [...map].map(([name, v]) => ({ name, username: v.username, comment: v.comment })); },
  };
}

/** Linux / macOS: sealed entries in one private JSON file beside the index (owner-only mode on POSIX). */
export function fileSlots(path: string, io: { read(path: string): string | null; write(path: string, text: string): void }): SecretSlots {
  type Row = { username: string; comment: string; blob: string };
  const load = (): Record<string, Row> => { try { const v = JSON.parse(io.read(path) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
  const save = (rows: Record<string, Row>) => io.write(path, JSON.stringify(rows));
  return {
    async write(name, username, comment, blob) { const rows = load(); rows[name] = { username, comment, blob: blob.toString("base64") }; save(rows); },
    async read(name) { const row = load()[name]; return row ? Buffer.from(row.blob, "base64") : null; },
    async remove(name) { const rows = load(); if (!(name in rows)) return false; delete rows[name]; save(rows); return true; },
    async list() { return Object.entries(load()).map(([name, row]) => ({ name, username: row.username, comment: row.comment })); },
  };
}
