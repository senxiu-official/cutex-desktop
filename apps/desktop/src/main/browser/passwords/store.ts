// BrowserPasswordStore (contract: ../identity/contract.ts). One implementation over a KeyGuard + SecretSlots:
//   - index (`userData/browser-passwords.json`): ids, identity, exact origin, user name, times, revision, vault id,
//     deletions and 「从不保存」 sites. Never a password. Lists and fill candidates read only this.
//   - slots: one sealed blob per login (Windows: a Credential Manager entry `Cutex 浏览器/<identity>/<id>`), plus the
//     vault record (`vault`: public key + the guard-wrapped private key).
//   - reading a password = the guard unwraps the vault key (Windows Hello prompt) → open the blob → hand it over → zero.
//     「验证后 5 分钟内不再问」 keeps the unwrapped vault key in main memory for 5 minutes; lock(), the pref turning off,
//     screen lock and suspend drop it.
// Reconciliation on first use: a login whose slot is gone (deleted in Control Panel) leaves the index; a slot the
// index lacks but whose comment names its origin is adopted back.
import { randomBytes } from "node:crypto";
import type { BrowserWindow } from "electron";
import { isBrowserIdentityId, isBrowserOrigin, type BrowserPasswordStoreStatus } from "../../../shared/browserIdentity";
import type { BrowserPasswordStore, SavedLogin, SecretBuffer } from "../identity/contract";
import { GuardError, type KeyGuard, type PromptReason, type SecretSlots } from "./guards";
import { generateVaultKeys, openFromVault, sealToVault, vaultAad, type VaultKeyPair } from "./vault";

export const PASSWORD_MAX_BYTES = 1024;
export const USERNAME_MAX = 256;
export const GRACE_MS = 5 * 60_000;
const DELETED_KEEP = 500;
const VAULT_SLOT = "vault";
const ENTRY_SLOT = /^(default|[a-f0-9]{8}|[a-f0-9]{32})\/([a-f0-9]{32})$/;
const COMMENT_PREFIX = "Cutex 浏览器保存 · ";

interface IndexEntry extends SavedLogin { vault: string }
interface IndexData {
  version: 1;
  entries: IndexEntry[];
  deleted: { id: string; identityId: string; revision: number; at: number }[];
  neverSave: Record<string, string[]>;
}
interface VaultRecord { v: 1; id: string; publicKey: string; guardId: string; wrapped: string }

export interface IndexIo { read(): string | null; write(text: string): void }

export interface PasswordStoreDeps {
  kind: BrowserPasswordStore["kind"];
  guard: KeyGuard;
  slots: SecretSlots;
  index: IndexIo;
  /** 「验证后 5 分钟内不再问」 (prefs.passwordHelloGrace). */
  graceEnabled(): boolean;
  /** The grace cache now holds an unlock. */
  onUnlocked?(): void;
  now?(): number;
}

export interface BrowserPasswordStoreImpl extends BrowserPasswordStore {
  /** `window`: owner of the one Hello prompt that creates the key on the very first save. */
  save(identityId: string, origin: string, username: string, secret: SecretBuffer, options?: { window?: BrowserWindow | null }): Promise<SavedLogin>;
  get(id: string): Promise<SavedLogin | null>;
  /** Windows Hello once, outside the grace (turning 「验证后 5 分钟内不再问」 on). Nothing saved yet: nothing to unlock. */
  verify(options?: { window?: BrowserWindow | null }): Promise<void>;
  /** Drops the remembered unlock (screen lock, suspend, pref off). */
  lock(): void;
  /** True when a fill / show would not ask again right now. */
  unlocked(): boolean;
}

const fail = (code: string): never => { throw new Error(code); };
const slotName = (e: { identityId: string; id: string }) => `${e.identityId}/${e.id}`;
const view = (e: IndexEntry): SavedLogin => ({ id: e.id, identityId: e.identityId, origin: e.origin, username: e.username, createdAt: e.createdAt, updatedAt: e.updatedAt, revision: e.revision });

function parseIndex(text: string | null): IndexData {
  const empty: IndexData = { version: 1, entries: [], deleted: [], neverSave: {} };
  if (!text) return empty;
  try {
    const raw = JSON.parse(text) as Partial<IndexData>;
    if (raw?.version !== 1) return empty;
    const entries = (Array.isArray(raw.entries) ? raw.entries : []).filter((e): e is IndexEntry =>
      !!e && typeof e.id === "string" && /^[a-f0-9]{32}$/.test(e.id) && isBrowserIdentityId(e.identityId) && isBrowserOrigin(e.origin)
      && typeof e.username === "string" && typeof e.createdAt === "number" && typeof e.updatedAt === "number" && typeof e.revision === "number" && typeof e.vault === "string");
    const deleted = (Array.isArray(raw.deleted) ? raw.deleted : []).filter((d) => !!d && typeof d.id === "string" && typeof d.revision === "number");
    const neverSave: Record<string, string[]> = {};
    for (const [id, list] of Object.entries(raw.neverSave ?? {})) if (isBrowserIdentityId(id) && Array.isArray(list)) neverSave[id] = list.filter(isBrowserOrigin);
    return { version: 1, entries, deleted, neverSave };
  } catch { return empty; }
}

export function createPasswordStore(deps: PasswordStoreDeps): BrowserPasswordStoreImpl {
  const now = deps.now ?? Date.now;
  let data: IndexData | null = null;
  let ready: Promise<void> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let cached: { vaultId: string; pair: VaultKeyPair; until: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let unlocking: { vaultId: string; promise: Promise<VaultKeyPair> } | null = null;

  const persist = () => deps.index.write(JSON.stringify(data));
  /** Mutations run one at a time (index + slots stay in step). */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  async function init(): Promise<IndexData> {
    ready ??= (async () => {
      data = parseIndex(deps.index.read());
      let slots: { name: string; username: string; comment: string }[];
      try { slots = await deps.slots.list(); } catch { return; } // store unavailable: keep the index as it is
      const present = new Set(slots.map((s) => s.name));
      data.entries = data.entries.filter((e) => present.has(slotName(e)));
      const known = new Set(data.entries.map(slotName));
      const vault = await readVault();
      for (const slot of slots) {
        const m = ENTRY_SLOT.exec(slot.name);
        const origin = slot.comment.startsWith(COMMENT_PREFIX) ? slot.comment.slice(COMMENT_PREFIX.length) : "";
        if (!m || known.has(slot.name) || !isBrowserOrigin(origin)) continue;
        const at = now();
        // Adopted (index lost / restored): vault unknown until it opens; assume the current one.
        data.entries.push({ id: m[2]!, identityId: m[1]!, origin, username: slot.username.slice(0, USERNAME_MAX), createdAt: at, updatedAt: at, revision: 1, vault: vault?.id ?? "" });
      }
      persist();
    })();
    await ready;
    return data!;
  }

  async function readVault(): Promise<VaultRecord | null> {
    const blob = await deps.slots.read(VAULT_SLOT);
    if (!blob) return null;
    try {
      const v = JSON.parse(blob.toString("utf8")) as VaultRecord;
      return v?.v === 1 && typeof v.id === "string" && typeof v.publicKey === "string" && typeof v.wrapped === "string" && typeof v.guardId === "string" ? v : null;
    } catch { return null; }
  }

  /** The vault to seal into: the current one if its guard key still exists, else a new one (Hello may ask once). */
  async function vaultForWrite(window: BrowserWindow | null): Promise<VaultRecord> {
    const current = await readVault();
    if (current && await deps.guard.present(current.guardId)) return current;
    const pair = generateVaultKeys();
    try {
      const { guardId, wrapped } = await deps.guard.wrap(pair.privateKey, window);
      const record: VaultRecord = { v: 1, id: randomBytes(16).toString("hex"), publicKey: pair.publicKey.toString("base64"), guardId, wrapped: wrapped.toString("base64") };
      await deps.slots.write(VAULT_SLOT, "vault", "Cutex 浏览器保存的密码的钥匙（需要 Windows Hello 才能解开）", Buffer.from(JSON.stringify(record)));
      forget();
      return record;
    } finally { pair.privateKey.fill(0); }
  }

  function forget(): void {
    if (!cached) return;
    clearTimeout(cached.timer);
    cached.pair.privateKey.fill(0);
    cached = null;
  }

  /**
   * Runs `use` with the unwrapped vault key. Grace on: from the 5-minute cache, else one prompt shared by the callers in
   * flight, then cached. Grace off: every call asks, and the key is zeroed right after its one use.
   */
  async function withVault<T>(vault: VaultRecord, reason: PromptReason, window: BrowserWindow | null, use: (pair: VaultKeyPair) => Promise<T>): Promise<T> {
    const unwrap = async (): Promise<VaultKeyPair> => ({ publicKey: Buffer.from(vault.publicKey, "base64"),
      privateKey: await deps.guard.unwrap(Buffer.from(vault.wrapped, "base64"), vault.guardId, reason, window) });
    if (cached && (cached.vaultId !== vault.id || cached.until <= now() || !deps.graceEnabled())) forget();
    // Copy always asks (the clipboard is readable by any program of this Windows user); so does turning the grace on.
    if (!deps.graceEnabled() || reason === "copy" || reason === "grace") {
      const pair = await unwrap();
      try { return await use(pair); } finally { pair.privateKey.fill(0); }
    }
    if (cached) return use(cached.pair);
    let pending = unlocking?.vaultId === vault.id ? unlocking.promise : null;
    if (!pending) {
      const mine = { vaultId: vault.id, promise: unwrap().then((pair) => {
        forget();
        const timer = setTimeout(forget, GRACE_MS);
        timer.unref?.();
        cached = { vaultId: vault.id, pair, until: now() + GRACE_MS, timer };
        deps.onUnlocked?.();
        return pair;
      }) };
      unlocking = mine;
      void mine.promise.finally(() => { if (unlocking === mine) unlocking = null; }).catch(() => {});
      pending = mine.promise;
    }
    return use(await pending);
  }

  async function readSecret(id: string, reason: PromptReason, window: BrowserWindow | null): Promise<SecretBuffer> {
    const index = await init();
    const entry = index.entries.find((e) => e.id === id) ?? fail("not_found");
    const vault = await readVault();
    if (!vault || (entry.vault && entry.vault !== vault.id)) throw new GuardError("key_lost");
    const blob = (await deps.slots.read(slotName(entry))) ?? fail("not_found");
    return withVault(vault, reason, window, async (pair) => {
      try { return openFromVault(pair, blob, vaultAad(entry)); }
      catch { throw new GuardError("key_lost"); }
      finally { blob.fill(0); }
    });
  }

  function checkSecret(secret: Buffer): void {
    if (!secret.length || secret.length > PASSWORD_MAX_BYTES) fail("invalid_password");
  }

  async function writeEntry(entry: IndexEntry, secret: Buffer, window: BrowserWindow | null): Promise<void> {
    const vault = await vaultForWrite(window);
    entry.vault = vault.id;
    const sealed = sealToVault(Buffer.from(vault.publicKey, "base64"), secret, vaultAad(entry));
    await deps.slots.write(slotName(entry), entry.username, COMMENT_PREFIX + entry.origin, sealed);
  }

  function tombstone(index: IndexData, entry: IndexEntry): void {
    index.deleted.push({ id: entry.id, identityId: entry.identityId, revision: entry.revision + 1, at: now() });
    if (index.deleted.length > DELETED_KEEP) index.deleted.splice(0, index.deleted.length - DELETED_KEEP);
  }

  const store: BrowserPasswordStoreImpl = {
    kind: deps.kind,

    async list(identityId, origin) {
      const index = await init();
      return index.entries.filter((e) => e.identityId === identityId && (origin === undefined || e.origin === origin)).map(view);
    },

    save(identityId, origin, username, secret, options) {
      return serial(async () => {
        try {
          if (!isBrowserIdentityId(identityId) || !isBrowserOrigin(origin) || username.length > USERNAME_MAX || /[\x00-\x1f\x7f]/.test(username)) fail("invalid_request");
          checkSecret(secret);
          const index = await init();
          const at = now();
          const existing = index.entries.find((e) => e.identityId === identityId && e.origin === origin && e.username === username);
          const entry: IndexEntry = existing ? { ...existing, updatedAt: at, revision: existing.revision + 1 }
            : { id: randomBytes(16).toString("hex"), identityId, origin, username, createdAt: at, updatedAt: at, revision: 1, vault: "" };
          await writeEntry(entry, secret, options?.window ?? null);
          index.entries = [...index.entries.filter((e) => e.id !== entry.id), entry];
          persist();
          return view(entry);
        } finally { secret.fill(0); }
      });
    },

    update(id, change) {
      return serial(async () => {
        try {
          const index = await init();
          const current = index.entries.find((e) => e.id === id) ?? fail("not_found");
          if (change.username !== undefined && (change.username.length > USERNAME_MAX || /[\x00-\x1f\x7f]/.test(change.username))) fail("invalid_request");
          const entry: IndexEntry = { ...current, username: change.username ?? current.username, updatedAt: now(), revision: current.revision + 1 };
          if (change.secret) { checkSecret(change.secret); await writeEntry(entry, change.secret, null); }
          else if (entry.username !== current.username) {
            // The slot's user name follows (Control Panel shows it); the sealed blob is untouched.
            const blob = (await deps.slots.read(slotName(current))) ?? fail("not_found");
            try { await deps.slots.write(slotName(entry), entry.username, COMMENT_PREFIX + entry.origin, blob); } finally { blob.fill(0); }
          }
          index.entries = index.entries.map((e) => (e.id === id ? entry : e));
          persist();
          return view(entry);
        } finally { change.secret?.fill(0); }
      });
    },

    remove(id) {
      return serial(async () => {
        const index = await init();
        const entry = index.entries.find((e) => e.id === id);
        if (!entry) return;
        await deps.slots.remove(slotName(entry));
        index.entries = index.entries.filter((e) => e.id !== id);
        tombstone(index, entry);
        persist();
      });
    },

    removeIdentity(identityId) {
      return serial(async () => {
        const index = await init();
        const gone = index.entries.filter((e) => e.identityId === identityId);
        for (const entry of gone) { await deps.slots.remove(slotName(entry)); tombstone(index, entry); }
        index.entries = index.entries.filter((e) => e.identityId !== identityId);
        delete index.neverSave[identityId];
        persist();
        return gone.length;
      });
    },

    async useForFill(id, use, options) {
      const secret = await readSecret(id, "fill", options?.window ?? null);
      try { await use(secret); } finally { secret.fill(0); }
    },

    async reveal(id, reason, options) {
      return readSecret(id, reason, options?.window ?? null);
    },

    async status(): Promise<BrowserPasswordStoreStatus> {
      const graceMinutes = deps.graceEnabled() ? 5 : 0;
      const availability = await deps.guard.availability();
      let index: IndexData;
      try { index = await init(); } catch { return { available: false, reason: "unsupported", keyLost: false, unreadable: 0, graceMinutes }; }
      let vault: VaultRecord | null = null, present = false;
      try { vault = await readVault(); present = !!vault && await deps.guard.present(vault.guardId); } catch { /* treated as lost below */ }
      const keyLost = index.entries.length > 0 && (!vault || !present);
      const unreadable = keyLost ? index.entries.length : index.entries.filter((e) => !!e.vault && e.vault !== vault!.id).length;
      return { available: availability.available, ...(availability.available ? {} : { reason: availability.reason }), keyLost, unreadable, graceMinutes };
    },

    neverSave: {
      async list(identityId) { return [...((await init()).neverSave[identityId] ?? [])]; },
      add(identityId, origin) {
        return serial(async () => {
          if (!isBrowserIdentityId(identityId) || !isBrowserOrigin(origin)) fail("invalid_request");
          const index = await init();
          const list = index.neverSave[identityId] ?? [];
          if (!list.includes(origin)) index.neverSave[identityId] = [...list, origin].slice(-500);
          persist();
        });
      },
      remove(identityId, origin) {
        return serial(async () => {
          const index = await init();
          index.neverSave[identityId] = (index.neverSave[identityId] ?? []).filter((o) => o !== origin);
          persist();
        });
      },
    },

    async get(id) { const e = (await init()).entries.find((x) => x.id === id); return e ? view(e) : null; },

    async verify(options) {
      await init();
      const vault = await readVault();
      if (!vault || !(await deps.guard.present(vault.guardId))) return;
      await withVault(vault, "grace", options?.window ?? null, async () => undefined);
    },

    lock: forget,
    unlocked: () => !!cached && cached.until > now() && deps.graceEnabled(),
  };
  return store;
}
