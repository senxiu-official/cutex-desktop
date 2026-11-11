import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_BROWSER_CARRIER_FRAME_RATE, isBrowserCarrierFrameRate, type BrowserCarrierFrameRate, type BrowserCarrierPreferences } from "../../shared/browserCarrier";
interface Io { read(path: string): string; write(path: string, text: string): void }
const io: Io = { read: path => readFileSync(path, "utf8"), write(path, text) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path);
} };
/** userData/browser-carrier.json = { "frameRate": 15 | 30 }; missing or invalid = 15 (the lighter one). */
export class BrowserCarrierPreferencesStore {
  private value: BrowserCarrierFrameRate | undefined;
  constructor(private readonly file: string | null, private readonly storage: Io = io) {}
  get(): BrowserCarrierPreferences {
    if (this.value === undefined) {
      try { const raw = JSON.parse(this.file ? this.storage.read(this.file) : "null"); this.value = isBrowserCarrierFrameRate(raw?.frameRate) ? raw.frameRate : DEFAULT_BROWSER_CARRIER_FRAME_RATE; }
      catch { this.value = DEFAULT_BROWSER_CARRIER_FRAME_RATE; }
    }
    return { frameRate: this.value! };
  }
  set(frameRate: BrowserCarrierFrameRate): BrowserCarrierPreferences {
    if (!isBrowserCarrierFrameRate(frameRate)) throw Error("invalid_browser_request");
    if (this.file) this.storage.write(this.file, JSON.stringify({ frameRate }, null, 2));
    this.value = frameRate; return this.get();
  }
}
