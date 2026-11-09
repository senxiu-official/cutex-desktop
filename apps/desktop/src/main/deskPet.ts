// The desk pet's window (docs/desktop-modules.md §29): one transparent, frameless, always-on-top window, used both over
// cutex and over the desktop. Default off: nothing here runs (no window, no file read, no listener) until the module
// `desk-pet` calls `start`. No pet logic: what counts as a tap, the rhythm and the counters are the module's; this file only
// decides about the window (where it is, what it may be clicked on, whether it shows) and reads the art.
//
// The window loads only its own local document (renderer/desk-pet.html) with its own narrow preload, in a private
// session that refuses every request other than that document, sandboxed, no token. Its channels accept only that
// window; the module's channel accepts only the app window (main/index.ts). The renderer names settings and a listed
// character id, never a URL, path, coordinates or bytes.
//
// Transparent pixels pass clicks by the window's shape (setShape from the frames' alpha), not by
// setIgnoreMouseEvents(forward): that one installs a system-wide low-level mouse hook, paid on every mouse move even
// when nothing happens here.
import { readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, type MenuItemConstructorOptions, type WebContents } from "electron";
import {
  artDisplaySize,
  DESK_PET_BASE_DIP,
  DESK_PET_CHANNEL,
  DESK_PET_COUNT_HEIGHT,
  DESK_PET_COUNT_WIDTH,
  DESK_PET_DEFAULTS,
  DESK_PET_PLACEHOLDER_ID,
  DESK_PET_DEFAULT_CHARACTER,
  DESK_PET_SIZES,
  mirrorRects,
  DESK_PET_STAGE_SIDE,
  DESK_PET_STAGE_TOP,
  stageBounds,
  bubbleRect,
  DESK_PET_ICON_MS,
  overheadRect,
  type DeskPetStage,
  type DeskPetStageBox,
  DESK_PET_TRANSLUCENT,
  keepOnDisplays,
  parseDeskPetPatch,
  parseDeskPetRequest,
  petShapeRects,
  petWindowSize,
  type DeskPetArtProblem,
  type DeskPetCharacter,
  type DeskPetLabels,
  type DeskPetName,
  type DeskPetSettings,
  type DeskPetView,
  type DeskPetWindowRequest,
  type DeskPetWindowState,
  type DeskPetWindowTick,
  type PetRect,
} from "../shared/deskPet";
import { DESK_PET_PLACEHOLDER_SIZE, placeholderFrame } from "../shared/deskPetPlaceholder";
import { sceneDipPerUnit, type DeskPetBooks } from "../shared/deskPetScene";
import { DESK_PET_WINDOW_CHANNEL, DESK_PET_WINDOW_DRAG, DESK_PET_WINDOW_STATE, DESK_PET_WINDOW_TICK } from "../shared/deskPetWindow";
import { ensureArtDir, hasVisiblePixels, listCharacters, loadCharacter, restLayers, sceneAlpha, type DecodeImage, type LoadedCharacter, type Listed, type PackArt } from "./deskPetArt";

export interface DeskPetDeps {
  /** `<userData>/desk-pet`: state.json and art/. */
  dir: string;
  /** Is the renderer of the app window asking (main/index.ts isAppSender)? */
  isAppSender(event: Electron.IpcMainInvokeEvent): boolean;
  /** Art in the signed pack; null without an installed pack. */
  packArt(): PackArt | null;
  locale(): string;
  sendView(view: DeskPetView): void;
  /** 设置 in the pet's menu. */
  openSettings(): void;
  openPath(dir: string): Promise<unknown>;
  log?(message: string): void;
}

/** A module restart (every focus-host change, §4) must not make the pet flash: a stop waits this long for the next start. */
const STOP_GRACE_MS = 800;
const FOCUS_SETTLE_MS = 80;
const PARTITION = "desk-pet";
const MAX_WINDOW_SIDE = 640;
const MAX_LOADED = 8;
/** The app window's renderer reloaded or died: it did not say stop. Its module has this long to say start again. */
const RENDERER_GONE_GRACE_MS = 20_000;
const PREVIEW_SIDE = 192;

/** Linux Wayland: the compositor places windows (same test as main/deskShell.ts). */
const wayland = process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY) && process.env.ELECTRON_OZONE_PLATFORM_HINT !== "x11";

const decodeWithNative: DecodeImage = (png, fit) => {
  let image = nativeImage.createFromBuffer(png);
  if (image.isEmpty()) return null;
  if (fit) {
    const { width, height } = image.getSize();
    const scale = Math.min(fit.width / width, fit.height / height);
    // Scaled down only: what the screen cannot show would only cost the window memory.
    if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "good" });
  }
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  if (bitmap.length !== width * height * 4) return null;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = bitmap[i * 4 + 3]!;
  return { width, height, alpha, dataUrl: `data:image/png;base64,${image.toPNG().toString("base64")}` };
};

function placeholderImage(frame: Parameters<typeof placeholderFrame>[0]): { dataUrl: string; rgba: Uint8ClampedArray } {
  const rgba = placeholderFrame(frame);
  const bgra = Buffer.alloc(rgba.length);
  // Native bitmaps are premultiplied BGRA.
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]! / 255;
    bgra[i] = rgba[i + 2]! * a;
    bgra[i + 1] = rgba[i + 1]! * a;
    bgra[i + 2] = rgba[i]! * a;
    bgra[i + 3] = rgba[i + 3]!;
  }
  const image = nativeImage.createFromBitmap(bgra, { width: DESK_PET_PLACEHOLDER_SIZE, height: DESK_PET_PLACEHOLDER_SIZE });
  return { dataUrl: `data:image/png;base64,${image.toPNG().toString("base64")}`, rgba };
}

function placeholderCharacter(): LoadedCharacter {
  const S = DESK_PET_PLACEHOLDER_SIZE;
  const alpha = new Uint8Array(S * S);
  const layer = (frame: Parameters<typeof placeholderFrame>[0]) => {
    const { dataUrl, rgba } = placeholderImage(frame);
    for (let i = 0; i < alpha.length; i++) if (rgba[i * 4 + 3]! > alpha[i]!) alpha[i] = rgba[i * 4 + 3]!;
    return dataUrl;
  };
  return { width: S, height: S, scale: 1,
    pixel: false, alpha, both: layer("both"), left: layer("left"), right: layer("right"), face: null, faceBlink: null, blink: layer("blink"), accessory: null, icons: {} };
}

const PLACEHOLDER: DeskPetCharacter = { id: DESK_PET_PLACEHOLDER_ID, name: { en: "Placeholder", "zh-CN": "占位" }, family: null, pixel: false, source: "placeholder", format: 1, books: null };
const NO_BOOKS: DeskPetBooks = { active: null, pile: [] };

function nameIn(name: DeskPetName, locale: string): string {
  if (typeof name === "string") return name;
  return name[locale] ?? name[locale.split("-")[0]!] ?? name.en ?? Object.values(name)[0] ?? "";
}

interface Stored extends DeskPetSettings { x?: number; y?: number }

export class DeskPetService {
  private running = false;
  private stored: Stored | null = null;
  private win: BrowserWindow | null = null;
  private stopTimer: NodeJS.Timeout | null = null;
  private focusTimer: NodeJS.Timeout | null = null;
  private labels: DeskPetLabels | null = null;
  private summary = "";
  private total = 0;
  private characters: DeskPetCharacter[] = [PLACEHOLDER];
  private problems: DeskPetArtProblem[] = [];
  /** `key`: the id, and for a scene the resolution its images were scaled to. */
  private current: { id: string; key: string; art: LoadedCharacter } | null = null;
  /** A scene's state from the module: agents at work, the books. */
  private work = false;
  private books: DeskPetBooks = NO_BOOKS;
  /** The scene the window was last sent in full (its images go once per window). */
  private sentScene: string | null = null;
  private shapeWorks = !wayland;
  private dragOffset: { x: number; y: number } | null = null;
  private watchingFocus = false;
  private watchingDisplays = false;
  private artGeneration = 0;
  private followFamily: string | null = null;
  private stage: { kind: "bubble" | "fan"; below: boolean } | null = null;
  /** The waiting mark is up (the module decides when). */
  private mark = false;
  /** Rising icons are drawn until then: the shape holds the room over the head only while something is there. */
  private overheadUntil = 0;
  private overheadTimer: NodeJS.Timeout | null = null;
  /** Decoded characters, so following a model back and forth does not decode again. Small: a window shows one. */
  private readonly loaded = new Map<string, LoadedCharacter>();
  private readonly previews = new Map<string, readonly string[]>();
  private sessionReady = false;
  private listedCache: Awaited<ReturnType<typeof listCharacters>>["listed"] = new Map();

  constructor(private readonly deps: DeskPetDeps) {}

  /** Registers the channels (once, after app ready). No other work until `start`. */
  register(): void {
    ipcMain.handle(DESK_PET_CHANNEL, (event, raw: unknown) => {
      if (!this.deps.isAppSender(event)) throw new Error("untrusted sender");
      return this.handle(raw);
    });
    ipcMain.handle(DESK_PET_WINDOW_CHANNEL, (event, raw: DeskPetWindowRequest) => {
      if (!this.isPetSender(event.sender)) throw new Error("untrusted sender");
      return this.handleWindow(raw);
    });
    ipcMain.on(DESK_PET_WINDOW_DRAG, (event) => {
      if (this.isPetSender(event.sender)) this.dragMove();
    });
  }

  /** The pet window's webContents (the app channels refuse it: isAppSender only accepts the app window). */
  isPetSender(sender: WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && sender === this.win.webContents;
  }

  /** The app is closing: the pet must not keep it alive (window-all-closed counts every window). */
  dispose(): void {
    this.running = false;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.closeWindow();
    this.unwatch();
  }

  private async handle(raw: unknown): Promise<unknown> {
    const request = parseDeskPetRequest(raw);
    switch (request.op) {
      case "state":
        return this.view();
      case "start":
        return this.start(request.labels);
      case "stop":
        this.stop();
        return;
      case "set":
        await this.set(request.patch);
        return this.view();
      case "tick": {
        if (request.summary !== undefined) this.summary = request.summary;
        if (request.total !== undefined) this.total = request.total;
        const tick: DeskPetWindowTick = {};
        if (request.pose) tick.pose = request.pose;
        if (request.total !== undefined) tick.total = request.total;
        if (request.work !== undefined) this.work = tick.work = request.work;
        if (request.books) {
          const reshape = request.books.pile.length !== this.books.pile.length && !!this.current?.art.scene?.scene.pile;
          this.books = tick.books = request.books;
          if (reshape) this.applyInput();
        }
        const overhead = this.overheadShown();
        if (request.mark !== undefined && request.mark !== this.mark) {
          this.mark = request.mark;
          tick.mark = request.mark;
        }
        if (request.icon && this.win && !this.win.isDestroyed() && !wayland) {
          tick.icon = request.icon;
          this.overheadUntil = Date.now() + DESK_PET_ICON_MS;
          if (this.overheadTimer) clearTimeout(this.overheadTimer);
          this.overheadTimer = setTimeout(() => {
            this.overheadTimer = null;
            if (!this.overheadShown()) this.applyInput();
          }, DESK_PET_ICON_MS + 50);
        }
        if (this.overheadShown() !== overhead) this.applyInput();
        if (this.win && !this.win.isDestroyed()) this.win.webContents.send(DESK_PET_WINDOW_TICK, tick);
        return;
      }
      case "reloadArt":
        await this.reloadArt();
        return this.view();
      case "preview":
        return this.preview(request.id);
      case "follow":
        await this.follow(request.family);
        return;
      case "openFolder": {
        const dir = this.artDir();
        await ensureArtDir(dir);
        await this.deps.openPath(dir);
        return;
      }
    }
  }

  private handleWindow(raw: DeskPetWindowRequest): unknown {
    switch (raw?.op) {
      case "state":
        // The document asks once it listens: whatever was pushed before may have been missed.
        this.sentScene = null;
        return this.windowState();
      case "dragStart":
        this.dragStart();
        return;
      case "dragEnd":
        this.dragEnd();
        return;
      case "menu":
        this.popupMenu();
        return;
      case "stage":
        return this.setStage(raw.kind);
      default:
        throw new Error("unknown desk pet window op");
    }
  }

  private artDir(): string {
    return join(this.deps.dir, "art");
  }

  private settings(): Stored {
    if (this.stored) return this.stored;
    let saved: unknown = null;
    try {
      saved = JSON.parse(readFileSync(join(this.deps.dir, "state.json"), "utf8"));
    } catch {
      saved = null;
    }
    const record = saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
    const position = typeof record.x === "number" && typeof record.y === "number" && Number.isFinite(record.x) && Number.isFinite(record.y) ? { x: Math.round(record.x), y: Math.round(record.y) } : {};
    this.stored = { ...DESK_PET_DEFAULTS, ...parseDeskPetPatch(record), ...position };
    return this.stored;
  }

  private save(): void {
    const path = join(this.deps.dir, "state.json");
    const tmp = `${path}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(tmp, JSON.stringify(this.settings(), null, 2));
      renameSync(tmp, path);
    } catch (error) {
      this.deps.log?.(`desk pet: saving its state failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  view(): DeskPetView {
    const { x: _x, y: _y, ...settings } = this.settings();
    return {
      running: this.running,
      settings,
      characters: this.characters,
      current: this.current?.id ?? DESK_PET_PLACEHOLDER_ID,
      problems: this.problems,
      artDir: this.artDir(),
      scenes: true,
      placement: wayland ? "limited" : "full",
      shape: this.shapeWorks,
    };
  }

  private async start(labels: DeskPetLabels): Promise<DeskPetView> {
    this.labels = labels;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (!this.running) {
      this.running = true;
      await this.reloadArt(false);
    }
    this.apply();
    const view = this.view();
    this.deps.sendView(view);
    return view;
  }

  /** The app window's renderer reloaded or died: if nothing starts the pet again, it goes. */
  rendererGone(): void {
    if (this.running) this.stop(RENDERER_GONE_GRACE_MS);
  }

  private stop(grace = STOP_GRACE_MS): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      this.running = false;
      this.closeWindow();
      this.unwatch();
      this.deps.sendView(this.view());
    }, grace);
  }

  private async set(patch: Partial<DeskPetSettings>): Promise<void> {
    const before = this.settings();
    const next: Stored = { ...before, ...patch };
    this.stored = next;
    this.save();
    // A scene's images are scaled for the size on screen.
    const resized = patch.size !== undefined && patch.size !== before.size && !!this.current?.art.scene;
    if ((patch.character !== undefined && patch.character !== before.character) || (patch.followModel !== undefined && patch.followModel !== before.followModel) || resized) await this.pickCharacter();
    if (this.running) this.apply();
    this.deps.sendView(this.view());
  }

  private async follow(family: string | null): Promise<void> {
    if (family === this.followFamily) return;
    this.followFamily = family;
    if (!this.settings().followModel || !this.running) return;
    const before = this.current?.id;
    await this.pickCharacter();
    if (this.current?.id !== before) {
      this.apply();
      this.deps.sendView(this.view());
    }
  }

  private async preview(id: string): Promise<readonly string[]> {
    const cached = this.previews.get(id);
    if (cached) return cached;
    const small = (image: Electron.NativeImage) => {
      const { width, height } = image.getSize();
      const scale = PREVIEW_SIDE / Math.max(width, height);
      return (scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: "good" }) : image).toDataURL();
    };
    let layers: string[];
    if (id === DESK_PET_PLACEHOLDER_ID) layers = [placeholderImage("both").dataUrl];
    else {
      const entry = this.listedCache.get(id);
      if (!entry) return [];
      // Pixel art stays at full size: the page scales it by nearest neighbour.
      layers = (await restLayers(entry)).map((png) => (entry.character.pixel ? nativeImage.createFromBuffer(png).toDataURL() : small(nativeImage.createFromBuffer(png)))).filter((url) => url !== "data:image/png;base64,");
    }
    this.previews.set(id, layers);
    return layers;
  }

  private async reloadArt(notify = true): Promise<void> {
    const generation = ++this.artGeneration;
    const { listed, problems } = await listCharacters(this.artDir(), this.deps.packArt());
    if (generation !== this.artGeneration) return;
    this.listedCache = listed;
    this.loaded.clear();
    this.previews.clear();
    this.problems = problems;
    this.characters = [...[...listed.values()].map((l) => l.character), PLACEHOLDER];
    await this.pickCharacter(true);
    if (notify) {
      if (this.running) this.apply();
      this.deps.sendView(this.view());
    }
  }

  /** The chosen character, or the first one that decodes; the placeholder always does. */
  private async pickCharacter(fresh = false): Promise<void> {
    const settings = this.settings();
    const followed = settings.followModel && this.followFamily ? this.characters.find((c) => c.family === this.followFamily)?.id : undefined;
    const wanted = followed ?? settings.character ?? (this.listedCache.has(DESK_PET_DEFAULT_CHARACTER) ? DESK_PET_DEFAULT_CHARACTER : null);
    const order = [...(wanted ? [wanted] : []), ...this.characters.map((c) => c.id).filter((id) => id !== wanted)];
    for (const id of order) {
      if (id === DESK_PET_PLACEHOLDER_ID) break;
      const entry = this.listedCache.get(id);
      if (!entry) continue;
      const perUnit = this.perUnit(entry);
      const key = Number.isFinite(perUnit) ? `${id}@${perUnit}` : id;
      if (!fresh && this.current?.key === key) return;
      const art = this.loaded.get(key) ?? (await loadCharacter(entry, decodeWithNative, this.problems, perUnit));
      if (art && hasVisiblePixels(art)) {
        if (this.loaded.size >= MAX_LOADED) this.loaded.delete(this.loaded.keys().next().value!);
        this.loaded.set(key, art);
        this.current = { id, key, art };
        return;
      }
      if (art) this.problems.push({ character: id, file: null, code: "undecodable" });
      this.characters = this.characters.filter((c) => c.id !== id);
    }
    if (this.current?.id !== DESK_PET_PLACEHOLDER_ID) this.current = { id: DESK_PET_PLACEHOLDER_ID, key: DESK_PET_PLACEHOLDER_ID, art: placeholderCharacter() };
  }

  /** Image pixels per canvas unit a scene needs at the current size on the sharpest display, in quarter steps; Infinity = not a scene. */
  private perUnit(entry: Listed): number {
    const scene = entry.manifest.scene;
    if (!scene) return Infinity;
    const dip = sceneDipPerUnit(scene, DESK_PET_BASE_DIP, this.settings().size, entry.manifest.scale, MAX_WINDOW_SIDE);
    const sharpest = Math.max(1, ...screen.getAllDisplays().map((d) => d.scaleFactor));
    return Math.ceil(dip * sharpest * 4) / 4;
  }

  /** Brings the window in line with the settings. */
  private apply(): void {
    const settings = this.settings();
    this.watchFocus(this.running && settings.onlyInFront);
    this.watchDisplays(this.running);
    if (!this.shouldShow()) {
      // Hidden: no window at all rather than a hidden one that keeps a renderer alive.
      this.closeWindow();
      return;
    }
    if (!this.win || this.win.isDestroyed()) {
      this.createWindow();
      return;
    }
    this.placeWindow();
    this.applyInput();
    this.pushState();
  }

  private shouldShow(): boolean {
    if (!this.running) return false;
    const settings = this.settings();
    if (settings.hidden) return false;
    return !settings.onlyInFront || BrowserWindow.getFocusedWindow() !== null;
  }

  private artSize(): { width: number; height: number } {
    const art = this.current!.art;
    const area = screen.getPrimaryDisplay().workArea;
    const maxSide = Math.min(MAX_WINDOW_SIDE, area.width, area.height);
    const scene = art.scene?.scene;
    if (scene) {
      const dip = sceneDipPerUnit(scene, DESK_PET_BASE_DIP, this.settings().size, art.scale, maxSide);
      return { width: Math.max(1, Math.round(scene.canvas.width * dip)), height: Math.max(1, Math.round(scene.canvas.height * dip)) };
    }
    return artDisplaySize(art.width, art.height, this.settings().size, art.scale, maxSide);
  }

  /** Top-left of the window: where the owner left it, kept on a display; first time the bottom right of the main display. */
  private position(size: { width: number; height: number }): { x: number; y: number } {
    const saved = this.settings();
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    const kept = saved.x !== undefined && saved.y !== undefined ? keepOnDisplays({ x: saved.x, y: saved.y }, size, areas) : null;
    if (kept) return kept;
    const area = screen.getPrimaryDisplay().workArea;
    return { x: area.x + area.width - size.width - 24, y: area.y + area.height - size.height - 24 };
  }

  private placeWindow(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const size = petWindowSize(this.artSize(), this.settings().showCount);
    if (wayland) win.setContentSize(size.width, size.height);
    else win.setBounds(stageBounds(this.position(size), size));
  }

  /** What the page may draw round the pet: only the shape changes, the window and the pet stay. */
  private setStage(kind: DeskPetStage): DeskPetStageBox | null {
    if (kind !== "none" && kind !== "bubble" && kind !== "fan") throw new Error("unknown desk pet stage");
    const win = this.win;
    if (!win || win.isDestroyed() || wayland) return null;
    if (kind === "none") {
      if (!this.stage) return null;
      this.stage = null;
    } else {
      const size = petWindowSize(this.artSize(), this.settings().showCount);
      const at = this.position(size);
      this.stage = { kind, below: at.y - DESK_PET_STAGE_TOP < screen.getDisplayNearestPoint(at).workArea.y };
    }
    this.applyInput();
    return this.stage && { below: this.stage.below };
  }

  /** Something is drawn over the head: the waiting mark, or an icon still rising. */
  private overheadShown(): boolean {
    return this.mark || Date.now() < this.overheadUntil;
  }

  /** The window's shape from the art's alpha, plus the count below it; click-through on top. */
  private applyInput(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const settings = this.settings();
    win.setIgnoreMouseEvents(settings.clickThrough);
    if (wayland) return;
    const display = this.artSize();
    const window = petWindowSize(display, settings.showCount);
    const art = this.current!.art;
    const dx = Math.floor((window.width - display.width) / 2);
    const alpha = art.scene ? sceneAlpha(art, this.books.pile.length) : art.alpha;
    const picture = petShapeRects(alpha, art.width, art.height, display.width, display.height);
    const rects: PetRect[] = (settings.mirror ? mirrorRects(picture, display.width) : picture).map((r) => ({ ...r, x: r.x + dx }));
    if (settings.showCount) rects.push({ x: Math.floor((window.width - DESK_PET_COUNT_WIDTH) / 2), y: display.height, width: DESK_PET_COUNT_WIDTH, height: DESK_PET_COUNT_HEIGHT });
    const room = stageBounds({ x: 0, y: 0 }, window);
    const stage = this.stage;
    const shape: PetRect[] = stage?.kind === "fan" ? [{ x: 0, y: 0, width: room.width, height: room.height }]
      : rects.map((r) => ({ ...r, x: r.x + DESK_PET_STAGE_SIDE, y: r.y + DESK_PET_STAGE_TOP }));
    if (stage?.kind === "bubble") shape.push(bubbleRect(window, stage.below));
    // Clicks there land on the window too, like on the count; only while something is drawn.
    const scene = art.scene?.scene;
    const share = scene ? (scene.character.x + scene.character.width / 2) / scene.canvas.width : 0.5;
    if (stage?.kind !== "fan" && this.overheadShown()) shape.push(overheadRect(window, dx + display.width * (settings.mirror ? 1 - share : share)));
    try {
      win.setShape(shape);
      this.shapeWorks = true;
    } catch (error) {
      this.shapeWorks = false;
      this.deps.log?.(`desk pet: window shape refused: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private windowState(): DeskPetWindowState | null {
    if (!this.current) return null;
    const { art } = this.current;
    const display = this.artSize();
    const settings = this.settings();
    return {
      frames: { both: art.both, left: art.left, right: art.right },
      face: art.face,
      faceBlink: art.faceBlink,
      blink: art.blink,
      accessory: art.accessory,
      icons: art.icons,
      mark: this.mark,
      idleBlink: settings.idleBlink,
      artWidth: display.width,
      artHeight: display.height,
      showCount: settings.showCount,
      opacity: settings.opacity,
      mirror: settings.mirror,
      pixel: art.pixel,
      insetX: wayland ? 0 : DESK_PET_STAGE_SIDE,
      insetY: wayland ? 0 : DESK_PET_STAGE_TOP,
      total: this.total,
      nativeDrag: wayland,
      scene: this.sceneState(),
      work: this.work,
      books: this.books,
    };
  }

  /** The scene in full the first time this window gets it, then only its key. */
  private sceneState(): DeskPetWindowState["scene"] {
    const scene = this.current?.art.scene;
    if (!scene) return null;
    const key = this.current!.key;
    if (this.sentScene === key) return { key };
    this.sentScene = key;
    return { key, art: { scene: scene.scene, images: scene.images } };
  }

  private pushState(): void {
    const state = this.windowState();
    if (state && this.win && !this.win.isDestroyed()) this.win.webContents.send(DESK_PET_WINDOW_STATE, state);
  }

  private closeWindow(): void {
    const win = this.win;
    this.win = null;
    this.sentScene = null;
    this.stage = null;
    this.overheadUntil = 0;
    this.mark = false;
    if (this.overheadTimer) clearTimeout(this.overheadTimer);
    this.overheadTimer = null;
    this.dragOffset = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  /** A private session: nothing but this window's own document, whatever the page might ask for. */
  private lockedSession(): Electron.Session {
    const locked = session.fromPartition(PARTITION);
    if (!this.sessionReady) {
      this.sessionReady = true;
      const dev = process.env.ELECTRON_RENDERER_URL;
      const devBase = dev && !app.isPackaged ? dev.replace(/\/$/, "") : null;
      const allowed = (url: string) => url.startsWith("file://") || url.startsWith("data:") || (!!devBase && (url === devBase || url.startsWith(`${devBase}/`)));
      locked.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed(details.url) }));
      locked.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      locked.setPermissionCheckHandler(() => false);
    }
    return locked;
  }

  private createWindow(): void {
    const size = petWindowSize(this.artSize(), this.settings().showCount);
    const win = new BrowserWindow({
      ...(wayland ? size : stageBounds(this.position(size), size)),
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: true,
      skipTaskbar: true,
      // Never takes the keyboard from what the owner is typing in.
      focusable: false,
      alwaysOnTop: true,
      show: false,
      title: "Cutex",
      webPreferences: {
        preload: join(__dirname, "../preload/deskPet.cjs"),
        session: this.lockedSession(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        // backgroundThrottling stays on. Off, the page is never marked hidden while something covers the window, so
        // uncovering it never restores Chromium's input child, and this window, which cannot activate, eats left presses.
      },
    });
    this.win = win;
    win.setMenu(null);
    // Not the default level: with a full-screen app in front, it leaves the window not topmost at all, under that app.
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());
    win.once("ready-to-show", () => {
      if (this.win !== win) return;
      this.applyInput();
      win.showInactive();
    });
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
    const dev = process.env.ELECTRON_RENDERER_URL;
    if (dev && !app.isPackaged) void win.loadURL(`${dev.replace(/\/$/, "")}/desk-pet.html`);
    else void win.loadFile(join(__dirname, "../renderer/desk-pet.html"));
  }

  // ---- drag: main reads the cursor itself; the page only says a drag goes on ----

  private dragStart(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || wayland) return;
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = win.getPosition() as [number, number];
    this.dragOffset = { x: cursor.x - x, y: cursor.y - y };
  }

  private dragMove(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.dragOffset) return;
    const cursor = screen.getCursorScreenPoint();
    const size = petWindowSize(this.artSize(), this.settings().showCount);
    // Fixed size on every step: crossing displays of different scale must not grow the window.
    win.setBounds(stageBounds({ x: cursor.x - this.dragOffset.x + DESK_PET_STAGE_SIDE, y: cursor.y - this.dragOffset.y + DESK_PET_STAGE_TOP }, size));
  }

  private dragEnd(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.dragOffset) return;
    this.dragOffset = null;
    const [left, top] = win.getPosition() as [number, number];
    const at = { x: left + DESK_PET_STAGE_SIDE, y: top + DESK_PET_STAGE_TOP };
    const size = petWindowSize(this.artSize(), this.settings().showCount);
    const kept = keepOnDisplays(at, size, screen.getAllDisplays().map((d) => d.workArea)) ?? at;
    this.stored = { ...this.settings(), x: kept.x, y: kept.y };
    this.save();
    win.setBounds(stageBounds(kept, size));
    // A new display may have another scale: the shape goes again.
    this.applyInput();
  }

  // ---- menu ----

  private popupMenu(): void {
    const win = this.win;
    const labels = this.labels;
    if (!win || win.isDestroyed() || !labels) return;
    const settings = this.settings();
    const toggle = (key: "clickThrough" | "mirror" | "onlyInFront" | "showCount"): MenuItemConstructorOptions => ({
      label: labels[key],
      type: "checkbox",
      checked: settings[key],
      click: () => void this.set({ [key]: !settings[key] }),
    });
    const locale = this.deps.locale();
    const template: MenuItemConstructorOptions[] = [
      ...(this.summary ? [{ label: this.summary, enabled: false } as MenuItemConstructorOptions, { type: "separator" } as MenuItemConstructorOptions] : []),
      toggle("clickThrough"),
      { label: labels.translucent, type: "checkbox", checked: settings.opacity < 1, click: () => void this.set({ opacity: settings.opacity < 1 ? 1 : DESK_PET_TRANSLUCENT }) },
      toggle("mirror"),
      toggle("onlyInFront"),
      toggle("showCount"),
      {
        label: labels.size,
        submenu: DESK_PET_SIZES.map((size): MenuItemConstructorOptions => ({ label: `${Math.round(size * 100)}%`, type: "radio", checked: settings.size === size, click: () => void this.set({ size }) })),
      },
      ...(this.characters.length > 1
        ? [{
            label: labels.character,
            submenu: this.characters.map((c): MenuItemConstructorOptions => ({ label: nameIn(c.name, locale), type: "radio", checked: this.current?.id === c.id, click: () => void this.set({ character: c.id }) })),
          } as MenuItemConstructorOptions]
        : []),
      { type: "separator" },
      { label: labels.hide, click: () => void this.set({ hidden: true }) },
      { label: labels.settings, click: () => this.deps.openSettings() },
    ];
    Menu.buildFromTemplate(template).popup({ window: win });
  }

  // ---- only while nothing else needs it ----

  private readonly onFocusChange = (): void => {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    // Focus moving between two cutex windows is a blur then a focus: only the settled state counts.
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      if (this.running) this.apply();
    }, FOCUS_SETTLE_MS);
  };

  private watchFocus(on: boolean): void {
    if (on === this.watchingFocus) return;
    this.watchingFocus = on;
    if (on) {
      app.on("browser-window-focus", this.onFocusChange);
      app.on("browser-window-blur", this.onFocusChange);
    } else {
      app.off("browser-window-focus", this.onFocusChange);
      app.off("browser-window-blur", this.onFocusChange);
      if (this.focusTimer) clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private readonly onDisplays = (): void => {
    if (this.running) this.apply();
  };

  private watchDisplays(on: boolean): void {
    if (on === this.watchingDisplays) return;
    this.watchingDisplays = on;
    if (on) {
      screen.on("display-metrics-changed", this.onDisplays);
      screen.on("display-removed", this.onDisplays);
    } else {
      screen.off("display-metrics-changed", this.onDisplays);
      screen.off("display-removed", this.onDisplays);
    }
  }

  private unwatch(): void {
    this.watchFocus(false);
    this.watchDisplays(false);
  }
}
