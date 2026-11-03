/** Desktop-local diagnostics. No daemon methods, credentials or caller-selected file paths. */
export const DEBUG_CHANNEL = "cutex-desktop:debug";
export const DEBUG_WINDOW_MS = 30_000;
export const DEBUG_MEMORY_BYTES = 48 * 1024 * 1024;
export interface DebugEntry {
  time: number;
  kind: string;
  source: string;
  message?: string;
  code?: string;
  stack?: string;
  data?: unknown;
}
export interface DebugState {
  enabled: boolean;
  since: number | null;
  frames: number;
  bytes: number;
  windows: number;
  lastBundle: string | null;
  error: string | null;
}
export type DebugEvent = { state: DebugState } | { error: DebugEntry };
export type DebugRequest = { op: "state" | "save" | "reveal" | "devtools" } | { op: "enable"; value: boolean } | { op: "report"; entries: DebugEntry[] };
export interface DebugBridge {
  initiallyEnabled: boolean;
  state(): Promise<DebugState>;
  enable(value: boolean): Promise<DebugState>;
  save(): Promise<DebugState>;
  reveal(): Promise<void>;
  devtools(): Promise<void>;
  report(entries: DebugEntry[]): Promise<void>;
}

/** byte and age limits apply together, including after a long quiet period. */
export class DebugRing<T extends { time: number }> {
  private items: { item: T; bytes: number }[] = [];
  bytes = 0;
  constructor(readonly maxBytes = DEBUG_MEMORY_BYTES, readonly age = DEBUG_WINDOW_MS) {}
  push(item: T, bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes) return;
    this.items.push({ item, bytes });
    this.bytes += bytes;
    this.prune(item.time);
  }
  prune(now: number): void {
    while (this.items.length && (this.bytes > this.maxBytes || this.items[0]!.item.time < now - this.age)) this.bytes -= this.items.shift()!.bytes;
  }
  snapshot(now = Date.now()): T[] { this.prune(now); return this.items.map(e => e.item); }
  clear(): void { this.items = []; this.bytes = 0; }
}

export function debugShortcut(platform: string, input: { type: string; key: string; code?: string; control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean; isAutoRepeat?: boolean }): "save" | "devtools" | null {
  if (input.type !== "keyDown" || input.isAutoRepeat) return null;
  const mac = platform === "darwin", mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (!mod) return null;
  const key = input.code?.startsWith("Key") ? input.code.slice(3).toLowerCase() : input.key.toLowerCase();
  if (key === "f" && input.alt && input.shift) return "save";
  if (key === "i" && (mac ? input.alt && !input.shift : input.shift && !input.alt)) return "devtools";
  return null;
}

export function debugError(error: unknown, source: string, time = Date.now()): DebugEntry {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof value.message === "string" ? value.message : String(error);
  const parsed = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+):/.exec(message);
  return { time, kind: "error", source, message, ...(typeof value.code === "string" ? { code: value.code } : parsed ? { code: parsed[1] } : {}), ...(typeof value.stack === "string" ? { stack: value.stack } : {}) };
}
export function debugErrorText(error: DebugEntry): string {
  return `[${error.source}]${error.code ? ` ${error.code}` : ""}\n${error.message ?? ""}${error.stack ? `\n${error.stack}` : ""}`;
}

/** Bound telemetry before retaining/serializing it; only trusted app senders reach this. */
export function debugEntries(raw: unknown, now = Date.now()): DebugEntry[] {
  if (!Array.isArray(raw) || raw.length > 128) throw new Error("invalid debug entries");
  return raw.map(e => {
    if (!e || typeof e !== "object" || typeof e.kind !== "string" || typeof e.source !== "string" || !Number.isFinite(e.time) || Math.abs(e.time - now) > 60_000) throw new Error("invalid debug entry");
    const text = JSON.stringify(e);
    if (text.length > 24_000) throw new Error("debug entry too large");
    return JSON.parse(text) as DebugEntry;
  });
}
