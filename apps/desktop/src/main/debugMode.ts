import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow, Event, Input } from "electron";
import { DEBUG_MEMORY_BYTES, DebugRing, debugError, debugShortcut, type DebugEntry, type DebugEvent, type DebugState } from "../shared/debug";

interface Frame { time: number; window: number; jpeg: Buffer; source?: "cdp" | "native"; rect: { x: number; y: number; width: number; height: number } }
/** Main owns the capture and output directory. No external debugging port or Python. */
export class DebugMode {
  private enabled = false;
  private since: number | null = null;
  private frames = new DebugRing<Frame>(DEBUG_MEMORY_BYTES - 2 * 1024 * 1024);
  private entries = new DebugRing<DebugEntry>(2 * 1024 * 1024);
  private windows = new Map<number, BrowserWindow>();
  private stops = new Map<number, () => void>();
  private lastBundle: string | null = null;
  private error: string | null = null;
  private saving: Promise<DebugState> | null = null;
  constructor(private deps: { logs: () => string; emit: (event: DebugEvent) => void; platform: string; version?: () => string; flush?: () => Promise<unknown> }) {}
  state(): DebugState {
    const frames = this.frames.snapshot();
    return { enabled: this.enabled, since: this.since, frames: frames.length, bytes: this.frames.bytes + this.entries.bytes, windows: this.stops.size, lastBundle: this.lastBundle, error: this.error };
  }
  register(win: BrowserWindow): void {
    this.windows.set(win.webContents.id, win);
    const id = win.webContents.id;
    win.once("closed", () => { this.stops.get(id)?.(); this.windows.delete(id); });
    if (this.enabled) this.start(win);
  }
  setEnabled(value: boolean): DebugState {
    if (value === this.enabled) return this.state();
    this.enabled = value;
    this.error = null;
    this.since = value ? Date.now() : null;
    if (value) for (const win of this.windows.values()) this.start(win);
    else {
      for (const stop of [...this.stops.values()]) stop();
      this.frames.clear(); this.entries.clear();
    }
    const state = this.state(); this.deps.emit({ state }); return state;
  }
  private start(win: BrowserWindow): void {
    const wc = win.webContents;
    if (wc.isDestroyed() || this.stops.has(wc.id)) return;
    let previous: Buffer | null = null;
    // A millisecond/nth-frame throttle can discard the only blank frame of a flash.
    // Keep every delivered visual change; byte/age caps bound the retained filmstrip.
    const keep = (frame: Frame) => {
      if (previous?.equals(frame.jpeg)) return;
      previous = frame.jpeg;
      this.frames.push(frame, frame.jpeg.length + 128);
    };
    const input = (event: Event, key: Input) => {
      const action = debugShortcut(this.deps.platform, key);
      if (!action) return;
      event.preventDefault();
      if (action === "devtools") wc.openDevTools({ mode: "detach" });
      else void this.save().catch(error => this.recordError(error, "debug.save"));
    };
    let active = true, native = false, ownedDebugger = false;
    const nativeCapture = () => {
      if (!active || native || wc.isDestroyed()) return;
      try {
        // Fallback while DevTools owns the debugger. Full image: dirty-only would be cropped.
        wc.beginFrameSubscription(false, (image, rect) => {
          const time = Date.now();
          if (!this.enabled || image.isEmpty()) return;
          const size = image.getSize(), scale = Math.min(1, 480 / size.width, 300 / size.height);
          const jpeg = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: "good" }).toJPEG(45);
          keep({ time, window: wc.id, jpeg, rect, source: "native" });
        });
        native = true;
        if (this.error) { this.error = null; this.deps.emit({ state: this.state() }); }
      } catch (error) { this.error = String(error); this.deps.emit({ state: this.state() }); }
    };
    const message = (_event: Event, method: string, raw: unknown) => {
      if (method !== "Page.screencastFrame" || !active) return;
      const frame = raw as { data: string; sessionId: number; metadata: { timestamp: number; deviceWidth: number; deviceHeight: number } };
      void wc.debugger.sendCommand("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      const time = Number.isFinite(frame.metadata.timestamp) ? frame.metadata.timestamp * 1000 : Date.now();
      if (typeof frame.data !== "string") return;
      const jpeg = Buffer.from(frame.data, "base64");
      // Screencast does not expose damage: keep a null-sized rect rather than claiming a full repaint.
      keep({ time, window: wc.id, jpeg, rect: { x: 0, y: 0, width: 0, height: 0 }, source: "cdp" });
    };
    const detached = () => { ownedDebugger = false; wc.debugger.removeListener("message", message); wc.debugger.removeListener("detach", detached); if (active) nativeCapture(); };
    const startCDP = async () => {
      if (!active || wc.isDestroyed()) return;
      try {
        if (wc.debugger.isAttached()) { if (!ownedDebugger) nativeCapture(); return; }
        wc.debugger.attach("1.3"); ownedDebugger = true;
        wc.debugger.on("message", message); wc.debugger.on("detach", detached);
        await wc.debugger.sendCommand("Page.enable");
        if (!active) return;
        await wc.debugger.sendCommand("Page.startScreencast", { format: "jpeg", quality: 50, maxWidth: 560, maxHeight: 350, everyNthFrame: 1 });
        if (native) { wc.endFrameSubscription(); native = false; }
        if (this.error) { this.error = null; this.deps.emit({ state: this.state() }); }
      } catch { nativeCapture(); }
    };
    const closedTools = () => { void startCDP(); };
    const loaded = () => { if (active && native && !wc.isDestroyed()) { wc.endFrameSubscription(); native = false; nativeCapture(); } };
    wc.on("before-input-event", input);
    wc.on("devtools-closed", closedTools);
    wc.on("did-finish-load", loaded);
    this.stops.set(wc.id, () => {
      active = false;
      if (!wc.isDestroyed()) {
        if (native) wc.endFrameSubscription();
        wc.removeListener("before-input-event", input); wc.removeListener("devtools-closed", closedTools); wc.removeListener("did-finish-load", loaded);
        wc.debugger?.removeListener("message", message); wc.debugger?.removeListener("detach", detached);
        if (ownedDebugger && wc.debugger.isAttached()) wc.debugger.detach();
      }
      this.stops.delete(wc.id);
    });
    if (wc.debugger) void startCDP(); else nativeCapture();
  }

  report(entries: DebugEntry[]): void {
    if (!this.enabled) return;
    for (const entry of entries) { this.entries.push(entry, Buffer.byteLength(JSON.stringify(entry))); if (entry.kind === "error") this.deps.emit({ error: entry }); }
  }
  recordError(error: unknown, source: string): void {
    if (!this.enabled) return;
    const entry = debugError(error, source);
    this.report([entry]);
  }
  save(): Promise<DebugState> {
    if (!this.enabled) return Promise.reject(new Error("debug mode is off"));
    if (this.saving) return this.saving;
    this.saving = this.writeBundle().finally(() => { this.saving = null; });
    return this.saving;
  }
  private async writeBundle(): Promise<DebugState> {
    if (this.deps.flush) { let timer: ReturnType<typeof setTimeout> | undefined; await Promise.race([this.deps.flush().catch(() => {}), new Promise(r => { timer = setTimeout(r, 500); })]); clearTimeout(timer); }
    const now = Date.now(), frames = this.frames.snapshot(now), entries = this.entries.snapshot(now);
    const dir = join(this.deps.logs(), "debug", new Date(now).toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(16).slice(2, 8));
    await mkdir(dir, { recursive: true });
    const manifest = frames.map(({ jpeg: _, ...meta }, i) => ({ ...meta, file: `frame-${String(i).padStart(5, "0")}.jpg` }));
    for (let i = 0; i < frames.length; i++) await writeFile(join(dir, manifest[i]!.file), frames[i]!.jpeg);
    await writeFile(join(dir, "events.json"), JSON.stringify(entries, null, 2));
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ schema: 1, version: this.deps.version?.() ?? "unknown", chromium: process.versions.chrome, electron: process.versions.electron, savedAt: now, requestedSeconds: 30, platform: this.deps.platform, frameLimitBytes: this.frames.maxBytes, frames: manifest }, null, 2));
    await writeFile(join(dir, "index.html"), bundleViewer(manifest));
    this.lastBundle = dir;
    const state = this.state(); this.deps.emit({ state }); return state;
  }
  bundlePath(): string | null { return this.lastBundle; }
}

export function bundleViewer(frames: { time: number; window: number; file: string }[]): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>Cutex debug recording</title><style>body{font:16px system-ui;background:#15161a;color:#eee;margin:24px}img{max-width:100%;max-height:80vh;display:block}input{width:70%}pre{white-space:pre-wrap}</style><h1>Cutex · last 30 seconds</h1><p>Local recording. See events.json for errors, React commits, long animation frames and layout shifts. Manifest timestamps are epoch milliseconds. The memory cap or a quiet window can shorten the filmstrip.</p><input id="seek" type="range" min="0" max="${Math.max(0, frames.length - 1)}" value="0"><span id="stamp"></span><img id="frame"><script>const frames=${JSON.stringify(frames)};const seek=document.getElementById('seek');function draw(){const f=frames[+seek.value];if(!f){document.getElementById('stamp').textContent='No presented frames';return}document.getElementById('stamp').textContent=new Date(f.time).toISOString()+' · window '+f.window;document.getElementById('frame').src=f.file}seek.oninput=draw;draw()</script>`;
}
