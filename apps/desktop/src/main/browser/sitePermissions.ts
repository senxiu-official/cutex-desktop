// Per-origin site permissions for the in-app browser (0.1.3). Main-only: Chromium asks main, main
// asks the owner in a native dialog (agents and pages cannot click it), and only an owner-ticked
// 「记住」 is stored, per login pool + origin + permission, in userData/browser-site-permissions.json.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserPermissionDetails, BrowserSessionPermissions } from "./network";
import { BROWSER_SITE_PERMISSIONS, type BrowserSitePermission, type BrowserSitePermissionView } from "../../shared/browser";

export type BrowserPool = "owner" | "agent";
/** Electron permission name → the owner-facing permission(s) it needs. Anything else is denied
 * without asking (openExternal, fileSystem, display-capture, fullscreen, unknown, HID/serial/USB). */
const SIMPLE: Record<string, BrowserSitePermission> = {
  geolocation: "geolocation", notifications: "notifications", "clipboard-read": "clipboard-read", midi: "midi", midiSysex: "midi-sysex",
  pointerLock: "pointer-lock", keyboardLock: "keyboard-lock", "idle-detection": "idle-detection", "window-management": "window-management",
  "storage-access": "storage-access", "top-level-storage-access": "storage-access", "speaker-selection": "speaker-selection", mediaKeySystem: "protected-media",
};
/** Writing sanitized text to the clipboard after a click needs no prompt in Chromium; here too,
 * except while the agent is dispatching input. */
const AUTO = new Set(["clipboard-sanitized-write"]);

export function browserPermissionKeys(permission: string, details: BrowserPermissionDetails): BrowserSitePermission[] | "auto" | null {
  if (AUTO.has(permission)) return "auto";
  if (permission === "media") {
    const types = details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
    const keys = [...new Set(types.map(type => type === "video" ? "camera" : type === "audio" ? "microphone" : null))];
    return keys.length && keys.every(key => key !== null) ? keys as BrowserSitePermission[] : null;
  }
  return Object.hasOwn(SIMPLE, permission) ? [SIMPLE[permission]!] : null;
}
/** Chromium offers these APIs to secure contexts only: https, or http on a loopback name. */
export function browserPermissionOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost"))) return url.origin;
  } catch { /* not an origin */ }
  return null;
}

interface Io { read(path: string): string; write(path: string, text: string): void }
const defaultIo: Io = {
  read: path => readFileSync(path, "utf8"),
  write: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path); },
};
const MAX_ENTRIES = 512;
const key = (pool: BrowserPool, origin: string, permission: BrowserSitePermission) => `${pool}\n${origin}\n${permission}`;

/** Unreadable or malformed = nothing remembered (fail closed: every request asks again). */
export class BrowserSitePermissionStore {
  private entries: Map<string, BrowserSitePermissionView> | undefined;
  constructor(private readonly file: string | null, private readonly io: Io = defaultIo) {}
  private load(): Map<string, BrowserSitePermissionView> {
    if (this.entries) return this.entries;
    this.entries = new Map();
    if (!this.file) return this.entries;
    try {
      const parsed = JSON.parse(this.io.read(this.file)) as { version?: unknown; entries?: unknown };
      if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return this.entries;
      for (const raw of parsed.entries.slice(-MAX_ENTRIES)) {
        const entry = raw as Partial<BrowserSitePermissionView>;
        if ((entry.pool !== "owner" && entry.pool !== "agent") || typeof entry.allow !== "boolean" || browserPermissionOrigin(entry.origin) !== entry.origin
          || !(BROWSER_SITE_PERMISSIONS as readonly string[]).includes(entry.permission as string)) continue;
        this.entries.set(key(entry.pool, entry.origin!, entry.permission!), { pool: entry.pool, origin: entry.origin!, permission: entry.permission!, allow: entry.allow });
      }
    } catch { /* missing / malformed: empty */ }
    return this.entries;
  }
  private save(): void {
    if (this.file) this.io.write(this.file, `${JSON.stringify({ version: 1, entries: [...this.load().values()] }, null, 2)}\n`);
  }
  get(pool: BrowserPool, origin: string, permission: BrowserSitePermission): boolean | undefined { return this.load().get(key(pool, origin, permission))?.allow; }
  set(pool: BrowserPool, origin: string, permission: BrowserSitePermission, allow: boolean): void {
    const entries = this.load(), id = key(pool, origin, permission);
    entries.delete(id); entries.set(id, { pool, origin, permission, allow });
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    this.save();
  }
  list(): BrowserSitePermissionView[] { return [...this.load().values()].map(entry => ({ ...entry })); }
  /** Forget one origin (every permission) or everything. */
  forget(target: "all" | { pool: BrowserPool; origin: string }): void {
    const entries = this.load();
    if (target === "all") entries.clear();
    else for (const [id, entry] of entries) if (entry.pool === target.pool && entry.origin === target.origin) entries.delete(id);
    this.save();
  }
}

export interface BrowserPermissionGuest { guestId: string; pool: BrowserPool; url: string; agentName?: string }
export interface BrowserPermissionPrompt { guestId: string; origin: string; permissions: BrowserSitePermission[]; pool: BrowserPool; agentName?: string; agentActing: boolean;
  /** Aborted when the asking page is gone (navigated to another origin, closed): the prompt closes as a deny. */
  signal?: AbortSignal }
export interface BrowserSitePermissionsDeps {
  store: Pick<BrowserSitePermissionStore, "get" | "set">;
  /** The accepted guest behind a webContents id, with its CURRENT main-frame URL. */
  guest(webContentsId: number): BrowserPermissionGuest | undefined;
  agentInput(guestId: string): boolean;
  /** The owner's answer; null when it cannot be shown (window hidden / closed): deny, remember nothing. */
  prompt(request: BrowserPermissionPrompt): Promise<{ allow: boolean; remember: boolean } | null>;
  /** Calls `gone` once the guest leaves `origin` (navigation, close); returns the unsubscribe. */
  watch?(webContentsId: number, guestId: string, origin: string, gone: () => void): () => void;
}

/** One serialized owner prompt at a time; identical concurrent requests share it. */
export function createBrowserSitePermissions(deps: BrowserSitePermissionsDeps): BrowserSessionPermissions {
  const pending = new Map<string, Promise<boolean>>();
  let queue: Promise<unknown> = Promise.resolve(), waiting = 0;
  const resolve = (webContentsId: number, permission: string, details: BrowserPermissionDetails, requesting?: string) => {
    const guest = deps.guest(webContentsId);
    if (!guest) return null;
    const keys = browserPermissionKeys(permission, details);
    const top = browserPermissionOrigin(guest.url);
    // Only the tab's own top-level origin may ask: a cross-origin iframe never borrows the
    // top page's permission, and the owner is never asked on its behalf.
    const origin = browserPermissionOrigin(requesting ?? details.requestingUrl ?? guest.url);
    if (!keys || !top || origin !== top) return null;
    return { guest, keys, origin };
  };
  return {
    check(webContentsId, permission, requestingOrigin, details) {
      const found = resolve(webContentsId, permission, details, requestingOrigin);
      if (!found) return false;
      if (found.keys === "auto") return !deps.agentInput(found.guest.guestId);
      return found.keys.every(permission => deps.store.get(found.guest.pool, found.origin, permission) === true);
    },
    request(webContentsId, permission, details) {
      const found = resolve(webContentsId, permission, details);
      if (!found) return false;
      const { guest, keys, origin } = found;
      if (keys === "auto") return !deps.agentInput(guest.guestId);
      const stored = keys.map(permission => deps.store.get(guest.pool, origin, permission));
      if (stored.some(value => value === false)) return false;
      if (stored.every(value => value === true)) return true;
      const id = `${webContentsId}\n${origin}\n${keys.join(",")}`;
      const existing = pending.get(id);
      if (existing) return existing;
      if (waiting >= 8) return false;
      waiting++;
      const agentActing = deps.agentInput(guest.guestId);
      const same = () => { const now = deps.guest(webContentsId); return !!now && now.guestId === guest.guestId && browserPermissionOrigin(now.url) === origin; };
      const run = queue.then(async () => {
        // Queued behind another prompt: a page that has gone meanwhile is never asked about.
        if (!same()) return false;
        const abort = new AbortController();
        const stop = deps.watch?.(webContentsId, guest.guestId, origin, () => abort.abort());
        try {
          const answer = await deps.prompt({ guestId: guest.guestId, origin, permissions: keys, pool: guest.pool, agentActing, ...(guest.agentName ? { agentName: guest.agentName } : {}),
            ...(deps.watch ? { signal: abort.signal } : {}) });
          // The page may have navigated (or the tab closed) while the dialog was open.
          if (!answer || abort.signal.aborted || !same()) return false;
          if (answer.remember) for (const permission of keys) deps.store.set(guest.pool, origin, permission, answer.allow);
          return answer.allow;
        } finally { stop?.(); }
      }).catch(() => false).finally(() => { waiting--; pending.delete(id); });
      queue = run; pending.set(id, run);
      return run;
    },
  };
}
