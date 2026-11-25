// Which BrowserPasswordStore this run uses.
//   packaged build   Windows: Credential Manager + Windows Hello key; Linux: safeStorage only with libsecret / kwallet
//                    (basic_text → unavailable, never plaintext); macOS: safeStorage (Keychain).
//   dev build        the in-memory store with a stand-in for Windows Hello (no OS dialog in any test, E2E or dev run),
//                    unless CUTEX_DESKTOP_PASSWORD_STORE=secure asks for the real one. CUTEX_DESKTOP_PASSWORD_VERIFY=
//                    cancel | unavailable makes the stand-in refuse (E2E of the refusal paths).
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { credentialPrefix, credentialSlots, devMemoryGuard, fileSlots, helloGuard, memorySlots, safeStorageGuard, type FakeVerdict, type SafeStorageLike } from "./guards";
import { createPasswordStore, type BrowserPasswordStoreImpl } from "./store";

export const PASSWORD_INDEX_FILE = "browser-passwords.json";
export const PASSWORD_ENTRIES_FILE = "browser-password-entries.json";

/** Atomic, owner-only (0600 on POSIX) small file. */
export function writePrivateFile(path: string, text: string): void {
  const temp = `${path}.${process.pid}-${Date.now().toString(36)}.tmp`;
  writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
  try { renameSync(temp, path); } catch (error) { try { unlinkSync(temp); } catch { /* unchanged */ } throw error; }
}
const readOptional = (path: string): string | null => { try { return readFileSync(path, "utf8"); } catch { return null; } };

export interface PlatformStoreOptions {
  userData: string;
  packaged: boolean;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  locale(): string;
  graceEnabled(): boolean;
  /** Read only when the Linux / macOS store is first used. */
  safeStorage: SafeStorageLike | (() => SafeStorageLike);
  /** The 5-minute grace now holds an unlock (install the screen-lock / suspend listeners then). */
  onUnlocked?(): void;
  /** The data folder is not the app's default (CUTEX_DESKTOP_USER_DATA): keep its Windows credentials and Hello key apart. */
  separateData?: boolean;
}

/** 8 hex of the data folder path: the scope of an instance with its own data folder. */
export const dataScope = (userData: string) => createHash("sha256").update(userData.toLowerCase()).digest("hex").slice(0, 8);

export function createPlatformPasswordStore(o: PlatformStoreOptions): BrowserPasswordStoreImpl {
  const platform = o.platform ?? process.platform;
  if (!o.packaged && o.env.CUTEX_DESKTOP_PASSWORD_STORE !== "secure") {
    const raw = o.env.CUTEX_DESKTOP_PASSWORD_VERIFY;
    const verdict: FakeVerdict = raw === "cancel" || raw === "unavailable" ? raw : "ok";
    let text: string | null = null;
    return createPasswordStore({ kind: "devMemory", guard: devMemoryGuard(async () => verdict), slots: memorySlots(),
      index: { read: () => text, write: (t) => { text = t; } }, graceEnabled: o.graceEnabled, onUnlocked: o.onUnlocked });
  }
  const indexPath = join(o.userData, PASSWORD_INDEX_FILE);
  const index = { read: () => readOptional(indexPath), write: (t: string) => writePrivateFile(indexPath, t) };
  if (platform === "win32") {
    const scope = o.separateData ? dataScope(o.userData) : null;
    return createPasswordStore({ kind: "secure", guard: helloGuard(o.locale, scope), slots: credentialSlots(credentialPrefix(scope)), index, graceEnabled: o.graceEnabled, onUnlocked: o.onUnlocked });
  }
  const entries = join(o.userData, PASSWORD_ENTRIES_FILE);
  return createPasswordStore({ kind: "secure", guard: safeStorageGuard(o.safeStorage), slots: fileSlots(entries, { read: readOptional, write: writePrivateFile }), index, graceEnabled: o.graceEnabled, onUnlocked: o.onUnlocked });
}

export { createBrowserPasswordService, type PasswordTab } from "./service";
