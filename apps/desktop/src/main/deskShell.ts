// Desk windows, the Electron side (multi-window P1; registry and admission rules in main/deskWindows.ts).
// A desk is an `about:blank` child of the main window that the main renderer draws into: no preload,
// sandboxed, context-isolated, its own window-open / navigation guards; opaque frames only from the one-use
// documents main prepared for this desk (P4; released with it). The in-app browser's <webview> (P5) only when the
// browser's hardening is installed: the desk becomes one of its embedders before anything else is wired. Its window is real: closing it closes it
// (the renderer takes its conversations back, DesktopEvents.deskWindow); hiding the main window to the
// tray hides the desks with it and showing it brings them back (shell.ts).
//
// The desks' drawing runs in the main window's renderer: while the main window is hidden / minimised /
// occluded and a desk is on screen, the main renderer must not be throttled (timers, rAF), so main's
// background throttling is off exactly while a desk is visible.
import { app, BrowserWindow, nativeTheme, screen, shell, type HandlerDetails, type NativeImage, type WindowOpenHandlerResponse } from "electron";
import { TITLEBAR_HEIGHT, type DeskWindowEvent } from "../shared/ipc";
import { initialCaption } from "../shared/windowChrome";
import { MIN_DESK_SIZE, MIN_WINDOW_SIZE, refitBounds } from "../shared/windowBounds";
import { DeskRegistry, isDeskId, type DeskEntry, type DeskTicket } from "./deskWindows";
import { forgetDeskBounds, initialDeskBounds, settleRestoredBounds, trackWindowState, workAreas } from "./windowState";

export interface DeskShellDeps {
  mainWindow(): BrowserWindow | null;
  /** The 多窗口 setting (main-owned, desktop-prefs.json): off = no tickets issued or admitted (open desks stay). */
  enabled(): boolean;
  icon(): NativeImage;
  /** The window colour the renderer last reported (theme + palette). */
  background(): string;
  /** Whether an opaque frame document URL is one of the live one-use documents leased to webContents `place`. */
  ownsFrameUrl(url: string, place: number): boolean;
  /** The desk's webContents `place` is gone (closed, destroyed, its document navigating, renderer gone): drop
   *  every frame document leased to it and the page channels bound to them (an open confirm closes as cancel). */
  releaseFrames(place: number): void;
  emit(event: DeskWindowEvent): void;
  /** The native edit menu on text fields / selections (as in the main window). */
  contextMenu(win: BrowserWindow): void;
  /** A desk window exists now (the shell gives it the attention badge). */
  created(win: BrowserWindow): void;
  /**
   * The in-app browser (multi-window P5, main/browser/install.ts): whether its hardening is installed (a desk
   * opened now gets the webview tag only then), and adding a desk as one of its embedders (false: not added).
   */
  browser?: { embeddable(): boolean; add(win: BrowserWindow): boolean };
}

/** Linux Wayland: the compositor places windows; an app can only ask for a size. */
const wayland = process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY) && process.env.ELECTRON_OZONE_PLATFORM_HINT !== "x11";

export class DeskShell {
  readonly registry: DeskRegistry<BrowserWindow>;
  private chrome: { color: string; symbolColor: string } | null = null;
  private background: string | null = null;
  /** The app's zoom (Settings → 外观 → 界面缩放, Ctrl+= / − / 0): every desk shows at the main window's (multi-window P3). */
  private zoom: number | null = null;
  /** Desks closed with the main window / its document (not by the owner): their bounds stay remembered. */
  private readonly keep = new Set<string>();
  /** The bounds each admitted desk starts with (openResponse → adopt). */
  private readonly initial = new Map<string, { bounds: { x: number; y: number; width: number; height: number }; maximized: boolean }>();

  /** Quitting: the desks close with the app and stay remembered (bounds here, the reopen list in the renderer). */
  private quitting = false;

  constructor(private readonly deps: DeskShellDeps) {
    this.registry = new DeskRegistry<BrowserWindow>(undefined, undefined, () => deps.enabled());
    app.on("before-quit", () => (this.quitting = true));
  }

  /** WINDOW_CHANNEL desk ticket for the main window's renderer. */
  ticket(senderId: number, requested: unknown): DeskTicket | null {
    return this.registry.issue(senderId, requested);
  }

  /**
   * The main window's setWindowOpenHandler: the options for an admitted desk (one-use ticket), else null
   * (the caller denies). The webPreferences are written out, never inherited by accident.
   */
  openResponse(main: BrowserWindow, details: Pick<HandlerDetails, "url" | "frameName">): WindowOpenHandlerResponse | null {
    const deskId = this.registry.admit({ url: details.url, frameName: details.frameName, openerId: main.webContents.id });
    if (!deskId) return null;
    // A new desk cascades from the newest open desk (else the main window), so two never open on top of each other.
    const anchor = this.windows().at(-1) ?? (main.isDestroyed() ? null : main);
    const initial = initialDeskBounds(deskId, anchor ? anchor.getNormalBounds() : null);
    this.initial.set(deskId, initial);
    const bounds = wayland ? { width: initial.bounds.width, height: initial.bounds.height } : initial.bounds;
    return {
      action: "allow",
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        ...bounds,
        minWidth: MIN_DESK_SIZE.width,
        minHeight: MIN_DESK_SIZE.height,
        show: false,
        // Not a child window: it lives on another display, minimises and stacks on its own.
        parent: undefined,
        backgroundColor: this.background ?? this.deps.background(),
        title: "Cutex",
        icon: this.deps.icon(),
        autoHideMenuBar: true,
        ...(process.platform === "win32"
          ? { titleBarStyle: "hidden" as const, titleBarOverlay: { ...(this.chrome ?? initialCaption(nativeTheme.shouldUseDarkColors)), height: TITLEBAR_HEIGHT } }
          : process.platform === "darwin"
            ? { titleBarStyle: "hiddenInset" as const }
            : { frame: false }),
        webPreferences: {
          // No bridge: the desk's code is the main window's code (its document is drawn from there).
          preload: undefined,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          // The in-app browser (P5): only with its hardening installed; adopt adds this desk as an embedder
          // before anything else, and the browser refuses every attach in a window it has not added.
          webviewTag: this.deps.browser?.embeddable() === true,
          // The desk window's own compositor keeps drawing while the main window is hidden.
          backgroundThrottling: false,
          spellcheck: true,
        },
      },
    };
  }

  /** The main window's did-create-window: register an admitted desk and harden it; anything else is destroyed. */
  adopt(main: BrowserWindow, win: BrowserWindow, frameName: string): DeskEntry<BrowserWindow> | null {
    const entry = this.registry.register(frameName, main.webContents.id, win, win.webContents.id);
    if (!entry) {
      win.destroy();
      return null;
    }
    const { deskId } = entry;
    const contents = win.webContents;
    // First: the browser's per-window hardening (will-attach / did-attach checks, prompt parent, input). Without
    // it every <webview> attach in this desk is refused here too.
    if (this.deps.browser?.add(win) !== true) contents.on("will-attach-webview", (event) => event.preventDefault());
    const initial = this.initial.get(deskId) ?? initialDeskBounds(deskId, null);
    this.initial.delete(deskId);
    // Nothing navigates the desk document away; links open in the system browser, no window opens from here.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-redirect", (event) => event.preventDefault());
    // Sub-frames: only the one-use opaque documents main prepared for THIS desk (multi-window P4; the main
    // window's and other desks' leases are not valid here, main/deskWindows.ts).
    const place = entry.contentsId;
    contents.on("will-frame-navigate", (event) => {
      if (event.isMainFrame || !this.deps.ownsFrameUrl(event.url, place)) event.preventDefault();
    });
    // Its leases go with its document: never left for a later window (webContents ids are not reused).
    const releaseFrames = () => this.deps.releaseFrames(place);
    contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) releaseFrames();
    });
    contents.on("render-process-gone", releaseFrames);
    contents.on("destroyed", releaseFrames);
    this.deps.contextMenu(win);
    this.deps.created(win);
    trackWindowState(win, { kind: "desk", deskId });
    win.once("ready-to-show", () => {
      // Windows, mixed DPI: a window created at a position on another display can come up with its size
      // scaled by the wrong factor once; setting the bounds again on that display fixes it. Then exactly those bounds
      // (the hidden title bar reads back a little larger at 125 / 150 %, main/windowState settleRestoredBounds).
      if (process.platform === "win32" && !wayland) {
        win.setBounds(initial.bounds);
        settleRestoredBounds(win, initial.bounds);
      }
      if (initial.maximized) win.maximize();
      win.show();
    });
    const sync = () => this.syncThrottling();
    for (const event of ["show", "hide", "minimize", "restore"] as const) win.on(event as "show", sync);
    win.on("focus", () => this.deps.emit({ deskId, kind: "focus" }));
    win.on("closed", () => {
      this.registry.remove(deskId);
      releaseFrames();
      this.syncThrottling();
      // Closed with the app / the main document: not the owner's close, nothing is handed back or forgotten.
      if (this.keep.delete(deskId) || this.quitting) return;
      forgetDeskBounds(deskId);
      this.deps.emit({ deskId, kind: "closed" });
    });
    this.applyChrome(win);
    if (this.zoom !== null) contents.setZoomFactor(this.zoom);
    this.syncThrottling();
    return entry;
  }

  /** The desk windows, open now. */
  windows(): BrowserWindow[] {
    return this.registry.list().map((d) => d.window).filter((w) => !w.isDestroyed());
  }

  /** A desk the main renderer names (window controls, focus): only one it opened and still open. */
  resolve(senderId: number, deskId: unknown): BrowserWindow | null {
    const window = this.registry.resolve(senderId, deskId)?.window;
    return window && !window.isDestroyed() ? window : null;
  }

  focus(senderId: number, deskId: unknown): boolean {
    const win = this.resolve(senderId, deskId);
    if (!win) return false;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  }

  close(senderId: number, deskId: unknown): void {
    if (isDeskId(deskId)) this.resolve(senderId, deskId)?.close();
  }

  /** Hide to tray: every desk goes with the main window. */
  hideAll(): void {
    for (const win of this.windows()) win.hide();
  }

  /** Back from the tray: every desk comes back (behind the main window, which takes the focus). */
  showAll(): void {
    for (const win of this.windows()) {
      if (win.isMinimized()) win.restore();
      win.showInactive();
    }
  }

  /** The main window is going away (closed, reloading, renderer gone): its desks cannot be drawn any more. */
  closeAll(): void {
    for (const desk of this.registry.list()) {
      if (desk.window.isDestroyed()) continue;
      this.keep.add(desk.deskId);
      desk.window.destroy();
    }
  }

  /** The theme's caption colours (Windows overlay) for every desk, now and for the next ones. */
  setChrome(colors: { color: string; symbolColor: string }): void {
    this.chrome = colors;
    for (const win of this.windows()) this.applyChrome(win);
  }

  /** The renderer set the app's zoom (it is the main window's webContents'): the desks follow, now and when they open. */
  setZoom(factor: number): void {
    this.zoom = factor;
    for (const win of this.windows()) win.webContents.setZoomFactor(factor);
  }

  setBackground(color: string): void {
    this.background = color;
    for (const win of this.windows()) win.setBackgroundColor(color);
  }

  /** Displays changed: an app window no longer on any display moves to the primary one. */
  refit(main: BrowserWindow | null): void {
    const areas = workAreas();
    for (const [win, min] of [...(main && !main.isDestroyed() ? [[main, MIN_WINDOW_SIZE] as const] : []), ...this.windows().map((w) => [w, MIN_DESK_SIZE] as const)]) {
      if (win.isMinimized() || win.isFullScreen()) continue;
      const moved = refitBounds(win.getNormalBounds(), areas, min);
      if (moved) win.setBounds(moved);
    }
  }

  /** Call once after app ready. */
  watchDisplays(): void {
    const refit = () => this.refit(this.deps.mainWindow());
    screen.on("display-removed", refit);
    screen.on("display-metrics-changed", refit);
  }

  private applyChrome(win: BrowserWindow): void {
    if (process.platform === "win32" && this.chrome && !win.isDestroyed()) win.setTitleBarOverlay({ ...this.chrome, height: TITLEBAR_HEIGHT });
  }

  /** The main renderer draws the desks: not throttled while a desk is on screen. */
  private syncThrottling(): void {
    const main = this.deps.mainWindow();
    if (!main || main.isDestroyed()) return;
    const deskShown = this.windows().some((w) => w.isVisible() && !w.isMinimized());
    main.webContents.setBackgroundThrottling(!deskShown);
  }
}
