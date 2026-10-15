// Owner switch 「允许浏览外部网页」 (owner approval for packaged N2, 2026-10-14). Main-only state:
// the renderer can ask to read or flip it through the app-frame-only browser channel, but only main
// stores it and every browser request re-reads it (createBrowserEgress isEnabled).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_BROWSER_EXTERNAL_PAGES, type BrowserExternalPagesView } from "../../shared/browser";

export type BrowserExternalForce = "on" | "off";
/** Development-run override only. Packaged builds never honour the environment. */
export function browserExternalForce(packaged: boolean, flag: string | undefined): BrowserExternalForce | undefined {
  if (packaged) return;
  return flag === "n2" ? "on" : flag === "off" ? "off" : undefined;
}

interface Io { read(path: string): string; write(path: string, text: string): void }
const defaultIo: Io = {
  read: path => readFileSync(path, "utf8"),
  write: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path); },
};

/** userData/browser-external.json = { "externalPages": boolean }. Missing = the default (on);
 * present but unreadable or malformed = off (fail closed: never silently undo an owner "off"). */
export class BrowserExternalPagesStore {
  private value: boolean | undefined;
  constructor(private readonly file: string | null, private readonly io: Io = defaultIo) {}
  get(): boolean {
    if (this.value !== undefined) return this.value;
    if (!this.file) return this.value = DEFAULT_BROWSER_EXTERNAL_PAGES;
    let text: string;
    try { text = this.io.read(this.file); }
    catch (error) {
      return this.value = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? DEFAULT_BROWSER_EXTERNAL_PAGES : false;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      const stored = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).externalPages : undefined;
      return this.value = typeof stored === "boolean" ? stored : false;
    } catch { return this.value = false; }
  }
  set(enabled: boolean): void {
    // Turning off always takes effect in memory, even when the write fails.
    if (!enabled) this.value = false;
    if (this.file) this.io.write(this.file, `${JSON.stringify({ externalPages: enabled }, null, 2)}\n`);
    this.value = enabled;
  }
}

export function createBrowserExternalPages(options: { packaged: boolean; flag: string | undefined; store: BrowserExternalPagesStore }) {
  const forced = browserExternalForce(options.packaged, options.flag);
  const enabled = (): boolean => {
    if (forced) return forced === "on";
    try { return options.store.get() === true; } catch { return false; }
  };
  const view = (): BrowserExternalPagesView => {
    let stored = false;
    try { stored = options.store.get(); } catch { /* fail closed */ }
    return { enabled: enabled(), stored, ...(forced ? { forced } : {}) };
  };
  return { enabled, view, set(value: boolean): BrowserExternalPagesView { options.store.set(value); return view(); } };
}
