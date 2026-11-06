import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_BROWSER_CURSOR_COLOR, isBrowserCursorColor, type BrowserCursorPreferences } from "../../shared/browserCursor";
interface Io { read(path: string): string; write(path: string, text: string): void }
const io: Io = { read: path => readFileSync(path, "utf8"), write(path, text) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path);
} };
/** Main-owned appearance preference; invalid old data falls back to the owner-approved purple. */
export class BrowserCursorPreferencesStore {
  private value: string | undefined;
  constructor(private readonly file: string | null, private readonly storage: Io = io) {}
  get(): BrowserCursorPreferences {
    if (this.value === undefined) {
      try { const raw = JSON.parse(this.file ? this.storage.read(this.file) : "null"); this.value = isBrowserCursorColor(raw?.color) ? raw.color.toLowerCase() : DEFAULT_BROWSER_CURSOR_COLOR; }
      catch { this.value = DEFAULT_BROWSER_CURSOR_COLOR; }
    }
    return { color: this.value! };
  }
  set(color: string | null): BrowserCursorPreferences {
    if (color !== null && !isBrowserCursorColor(color)) throw Error("invalid_browser_request");
    const next = color?.toLowerCase() ?? DEFAULT_BROWSER_CURSOR_COLOR;
    if (this.file) this.storage.write(this.file, JSON.stringify({ color: next }, null, 2));
    this.value = next; return this.get();
  }
}
