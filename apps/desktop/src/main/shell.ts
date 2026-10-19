// Desktop shell: system tray (显示窗口 / 新聊天 / 退出), close-to-tray, attention badge, and the
// desktop-local prefs main needs (userData/desktop-prefs.json). Tray creation may fail: then closing
// the window quits as usual. On Linux a tray can also be created yet stay invisible (stock GNOME
// without the AppIndicator extension): until the owner picks 关闭窗口时, Linux quits on close when
// no StatusNotifier host is on the session bus, and otherwise asks once on the first close
// (shared/shell.ts closeAction).
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { userInfo } from "node:os";
import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, powerMonitor, safeStorage, Tray, type NativeImage } from "electron";
import { chromiumProxyRules, isProxyParseError, parseProxyUrl, type UpdateProxyRequest } from "../shared/proxy";
import type { UpdateProxyConfig } from "./updateNet";
import type { CloseBehavior, DesktopPrefs, ShellCommand, ShellLocale, ShellState } from "../shared/ipc";
import { parseDeviceOff, type DeviceOff } from "../shared/notificationLevels";
import { attentionCount, closeAction, editMenuLabels, effectiveCloseBehavior, overlayDescription, parseNameHasOwner, parsePrefs, parseTerms, resolveLocale, trayMenuLabels, trayNoticeText, trayTooltip, type TrayHost } from "../shared/shell";
import icon16 from "../../resources/icons/icon-16.png?asset";
import icon24 from "../../resources/icons/icon-24.png?asset";
import icon32 from "../../resources/icons/icon-32.png?asset";
import icon48 from "../../resources/icons/icon-48.png?asset";
import icon64 from "../../resources/icons/icon-64.png?asset";
import icon256 from "../../resources/icons/icon-256.png?asset";
import { addAttentionDot, overlayPng } from "./icon";

/** The owner's logo at the sizes built by scripts/make-icons.mjs. */
const LOGO: Record<number, string> = { 16: icon16, 24: icon24, 32: icon32, 48: icon48, 64: icon64, 256: icon256 };

/** One representation per size (first = scale 1); `dot` adds the attention dot. */
function iconImage(dot: boolean, sizes: number[]): NativeImage {
  const rep = (size: number): Buffer => {
    const logo = nativeImage.createFromPath(LOGO[size]!);
    if (!dot) return logo.toPNG();
    const bitmap = logo.toBitmap(); // BGRA on Windows / Linux
    addAttentionDot(bitmap, size, "bgra");
    return nativeImage.createFromBitmap(bitmap, { width: size, height: size }).toPNG();
  };
  const image = nativeImage.createFromBuffer(rep(sizes[0]!), { scaleFactor: 1 });
  for (const size of sizes.slice(1)) image.addRepresentation({ scaleFactor: size / sizes[0]!, buffer: rep(size) });
  return image;
}

/** Run one D-Bus probe command; resolves its stdout, or null when it is missing / fails / times out. */
function probe(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: 2000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout)));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Linux: is a StatusNotifier host (org.kde.StatusNotifierWatcher) on the session bus? Electron's tray
 * lives there; without it the icon is invisible on GNOME. Asked with gdbus (glib), else dbus-send;
 * neither available / no session bus = "unknown" (then the first close asks once instead).
 */
async function detectTrayHost(): Promise<TrayHost> {
  if (process.platform !== "linux" || !process.env.DBUS_SESSION_BUS_ADDRESS) return "unknown";
  const name = "org.kde.StatusNotifierWatcher";
  const gdbus = await probe("gdbus", ["call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", name]);
  if (gdbus !== null && parseNameHasOwner(gdbus) !== "unknown") return parseNameHasOwner(gdbus);
  const send = await probe("dbus-send", ["--session", "--print-reply", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", `string:${name}`]);
  return send === null ? "unknown" : parseNameHasOwner(send);
}

/** The OS account name (the identity menu's default name; stays on this machine). */
function osUserName(): string | null {
  try {
    return userInfo().username || null;
  } catch {
    return null;
  }
}

export class DesktopShell {
  private prefs: DesktopPrefs;
  private tray: Tray | null = null;
  private trayHost: TrayHost = "unknown";
  private noticeOpen = false;
  private quitting = false;
  private attention = 0;
  private lastBlur = 0;
  private icons: { normal: NativeImage; dot: NativeImage; overlay: NativeImage } | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    /** Recreate the window if it was destroyed (macOS / after a crash). */
    private readonly createWindow: () => void,
    private readonly sendCommand: (command: ShellCommand) => void,
  ) {
    this.prefs = this.load();
    app.on("before-quit", () => (this.quitting = true));
  }

  get locale(): ShellLocale {
    return resolveLocale(this.prefs.locale, app.getLocale());
  }

  get editLabels() {
    return editMenuLabels(this.locale);
  }

  /** Window icon (same art as the tray). */
  appIcon(): NativeImage {
    return iconImage(false, [32, 64, 256]);
  }

  /** Call once after app ready. */
  start(): void {
    // Linux / macOS shutdown or logout: let close→hide through.
    powerMonitor.on("shutdown", () => (this.quitting = true));
    try {
      this.icons = { normal: iconImage(false, [16, 24, 32, 48]), dot: iconImage(true, [16, 24, 32, 48]), overlay: nativeImage.createFromBuffer(overlayPng(16)) };
      this.tray = new Tray(this.icons.normal);
      this.tray.setToolTip(trayTooltip(0, this.locale, this.prefs.terms));
      this.rebuildMenu();
      // Windows: left click toggles the window. (Linux AppIndicator only offers the menu;
      // macOS opens the menu on click.)
      this.tray.on("click", () => {
        if (process.platform !== "win32") return;
        const win = this.getWindow();
        // Clicking the tray focuses the taskbar first, so "focused" = focused until just now.
        const focused = win && (win.isFocused() || Date.now() - this.lastBlur < 400);
        if (win && focused && win.isVisible() && !win.isMinimized()) win.hide();
        else this.show();
      });
    } catch (error) {
      console.warn("[cutex-desktop] tray unavailable; closing the window will quit", error);
      this.tray = null;
    }
    if (process.platform === "linux") {
      void detectTrayHost().then((host) => {
        this.trayHost = host;
        if (host === "absent" && !this.prefs.closeBehaviorChosen) console.warn("[cutex-desktop] no StatusNotifier host on the session bus; closing the window will quit until 关闭窗口时 is chosen");
      });
    }
  }

  /** Wire close→hide on a window (call for every new main window). */
  attach(win: BrowserWindow): void {
    win.on("close", (event) => {
      const action = closeAction({
        quitting: this.quitting,
        trayAvailable: this.tray !== null,
        closeBehavior: this.prefs.closeBehavior,
        closeBehaviorChosen: !!this.prefs.closeBehaviorChosen,
        platform: process.platform,
        trayHost: this.trayHost,
        trayNoticeShown: !!this.prefs.trayNoticeShown,
      });
      if (action === "close") return;
      event.preventDefault();
      if (action === "hide") this.hideWindow(win);
      else void this.askOnFirstClose(win);
    });
    win.on("blur", () => (this.lastBlur = Date.now()));
    // Windows logoff / shutdown (before-quit isn't emitted then).
    win.on("query-session-end", () => (this.quitting = true));
    win.on("session-end", () => (this.quitting = true));
    win.webContents.once("did-finish-load", () => this.applyAttention());
  }

  private hideWindow(win: BrowserWindow): void {
    // macOS native full screen: hiding the window there leaves its full-screen Space behind as a
    // black screen (only the Dock's 退出 got out). Leave full screen first, then hide.
    if (win.isFullScreen()) {
      win.once("leave-full-screen", () => {
        if (!win.isDestroyed()) win.hide();
      });
      win.setFullScreen(false);
    } else win.hide();
  }

  /** Linux, first close with the default pref: say where the app went and let the owner choose. */
  private async askOnFirstClose(win: BrowserWindow): Promise<void> {
    if (this.noticeOpen) return;
    this.noticeOpen = true;
    const text = trayNoticeText(this.locale, this.prefs.terms);
    let keep = true;
    try {
      const { response } = await dialog.showMessageBox(win, { type: "info", title: text.title, message: text.message, detail: text.detail, buttons: [text.keep, text.quit], defaultId: 0, cancelId: 0, noLink: true });
      keep = response === 0;
    } catch (error) {
      console.warn("[cutex-desktop] first-close notice failed; keeping the tray default", error);
    } finally {
      this.noticeOpen = false;
    }
    this.prefs = { ...this.prefs, closeBehavior: keep ? "tray" : "quit", closeBehaviorChosen: true, trayNoticeShown: true };
    this.save();
    if (win.isDestroyed()) return;
    if (keep) this.hideWindow(win);
    else win.close();
  }

  show(): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) {
      this.createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  quit(): void {
    this.quitting = true;
    app.quit();
  }

  state(): ShellState {
    let notificationsSupported = false;
    try {
      notificationsSupported = Notification.isSupported();
    } catch {
      // not available on this platform
    }
    const trayHostMissing = process.platform === "linux" && this.trayHost === "absent";
    const { updateProxyAuth: _auth, ...stored } = this.prefs;
    const prefs = { ...stored, closeBehavior: effectiveCloseBehavior(this.prefs, process.platform, this.trayHost) };
    return { prefs, trayAvailable: this.tray !== null, ...(trayHostMissing ? { trayHostMissing } : {}), notificationsSupported, osUserName: osUserName() };
  }

  /** This device's off switches (Settings → 通知 → 本设备). */
  get notifyOff(): DeviceOff {
    return this.prefs.notifyOff;
  }

  setNotifyOff(value: unknown): ShellState {
    this.prefs = { ...this.prefs, notifyOff: parseDeviceOff(value) };
    this.save();
    return this.state();
  }

  /** Settings → 通用 → 允许远程关闭这个桌面 (absent = allowed). */
  get allowRemoteClose(): boolean {
    return this.prefs.allowRemoteClose !== false;
  }

  setAllowRemoteClose(value: boolean): ShellState {
    const { allowRemoteClose: _old, ...rest } = this.prefs;
    this.prefs = value ? rest : { ...rest, allowRemoteClose: false };
    this.save();
    this.onAllowRemoteCloseChanged?.(value);
    return this.state();
  }

  /** Main wires this to the client presence (re-sent to every host at once). */
  onAllowRemoteCloseChanged: ((allowed: boolean) => void) | null = null;

  setCloseBehavior(value: CloseBehavior): ShellState {
    this.prefs = { ...this.prefs, closeBehavior: value, closeBehaviorChosen: true };
    this.save();
    return this.state();
  }

  setUpdateCheckMinutes(value: number): ShellState {
    this.prefs = { ...this.prefs, updateCheckMinutes: value };
    this.save();
    this.onPrefsChanged?.(this.prefs);
    return this.state();
  }

  /** Main wires this to the updater (interval changes). */
  onPrefsChanged: ((prefs: DesktopPrefs) => void) | null = null;

  /**
   * This desktop's update proxy (Settings → 网络代理): system (default) / none / manual URL. Basic
   * credentials in a manual URL are kept with safeStorage (never in the clear, never sent back to the
   * renderer); without a keyring a URL with credentials is refused.
   */
  setUpdateProxy(value: UpdateProxyRequest): ShellState {
    const { updateProxy: old, updateProxyAuth: oldAuth, ...rest } = this.prefs;
    // The manual URL (and its login) stays when switching to system / none (owner Q16 ②).
    const kept = old?.url ? { url: old.url, ...(old.hasCredentials && oldAuth ? { hasCredentials: true } : {}) } : null;
    const keptAuth = kept?.hasCredentials ? { updateProxyAuth: oldAuth! } : {};
    if (value?.mode === "manual") {
      const parsed = parseProxyUrl(value.url ?? old?.url ?? "");
      if (isProxyParseError(parsed)) throw new Error(`invalid proxy URL (${parsed.error})`);
      let auth: string | undefined;
      if (parsed.username !== null || parsed.password !== null) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("noKeyring: proxy credentials need the system keyring");
        auth = safeStorage.encryptString(JSON.stringify({ username: parsed.username ?? "", password: parsed.password ?? "" })).toString("base64");
      } else if (kept?.hasCredentials && kept.url === parsed.display) {
        // The same proxy re-saved from its shown (credential-free) URL keeps the stored credentials.
        auth = oldAuth;
      }
      this.prefs = { ...rest, updateProxy: { mode: "manual", url: parsed.display, ...(auth ? { hasCredentials: true } : {}) }, ...(auth ? { updateProxyAuth: auth } : {}) };
    } else if (value?.mode === "none") {
      this.prefs = { ...rest, updateProxy: { mode: "none", ...kept }, ...keptAuth };
    } else {
      this.prefs = kept ? { ...rest, updateProxy: { mode: "system", ...kept }, ...keptAuth } : { ...rest };
    }
    this.save();
    this.onUpdateProxyChanged?.();
    return this.state();
  }

  /** Main wires this to the updater (its session re-applies the proxy). */
  onUpdateProxyChanged: (() => void) | null = null;

  /** The update proxy as the updater applies it (credentials decrypted here, main only). */
  updateProxyConfig(): UpdateProxyConfig {
    const pref = this.prefs.updateProxy;
    if (pref?.mode === "none") return { mode: "none" };
    if (pref?.mode !== "manual" || !pref.url) return { mode: "system" };
    const parsed = parseProxyUrl(pref.url);
    if (isProxyParseError(parsed)) return { mode: "system" };
    let auth: { username: string; password: string } | undefined;
    if (this.prefs.updateProxyAuth && safeStorage.isEncryptionAvailable()) {
      try {
        const value = JSON.parse(safeStorage.decryptString(Buffer.from(this.prefs.updateProxyAuth, "base64"))) as { username?: unknown; password?: unknown };
        if (typeof value.username === "string" && typeof value.password === "string") auth = { username: value.username, password: value.password };
      } catch {
        // unreadable (other keyring / profile): the proxy then answers 407 and the check says so
      }
    }
    return { mode: "manual", rules: chromiumProxyRules(parsed), server: { scheme: parsed.scheme, host: parsed.host, port: parsed.port, ...(auth ? { auth } : {}) } };
  }

  setLocale(value: ShellLocale): void {
    if (this.prefs.locale === value) return;
    this.prefs = { ...this.prefs, locale: value };
    this.save();
    this.rebuildMenu();
    this.applyAttention();
  }

  /** The renderer's resolved terms (Settings → 通用 → 称呼): the tray / taskbar text follows them. */
  setTerms(value: unknown): ShellState {
    const terms = parseTerms(value);
    if (value !== null && terms === null) return this.state();
    if (JSON.stringify(terms) === JSON.stringify(this.prefs.terms ?? null)) return this.state();
    this.prefs = { ...this.prefs, terms };
    this.save();
    this.applyAttention();
    return this.state();
  }

  setAttention(value: unknown): void {
    const count = attentionCount(value);
    if (count === this.attention) return;
    this.attention = count;
    this.applyAttention();
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private applyAttention(): void {
    const count = this.attention;
    if (this.tray && this.icons) {
      this.tray.setImage(count > 0 ? this.icons.dot : this.icons.normal);
      this.tray.setToolTip(trayTooltip(count, this.locale, this.prefs.terms));
    }
    const win = this.getWindow();
    if (process.platform === "win32" && win && !win.isDestroyed()) {
      win.setOverlayIcon(count > 0 ? (this.icons?.overlay ?? nativeImage.createFromBuffer(overlayPng(16))) : null, count > 0 ? overlayDescription(count, this.locale, this.prefs.terms) : "");
    }
    // macOS dock / Linux Unity launcher; a no-op (returns false) elsewhere.
    if (process.platform !== "win32") app.setBadgeCount(count);
  }

  private rebuildMenu(): void {
    if (!this.tray) return;
    const labels = trayMenuLabels(this.locale);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: labels.show, click: () => this.show() },
        {
          label: labels.newChat,
          click: () => {
            this.show();
            this.sendCommand("newChat");
          },
        },
        { type: "separator" },
        { label: labels.quit, click: () => this.quit() },
      ]),
    );
  }

  private get file(): string {
    return join(app.getPath("userData"), "desktop-prefs.json");
  }

  private load(): DesktopPrefs {
    try {
      return parsePrefs(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      return parsePrefs(null);
    }
  }

  private saving: Promise<void> = Promise.resolve();
  private save(): void {
    const body = `${JSON.stringify(this.prefs, null, 2)}\n`;
    const file = this.file;
    // Serialize writes; write-then-rename so a crash never leaves a truncated file.
    this.saving = this.saving
      .then(async () => {
        await writeFile(`${file}.tmp`, body, "utf8");
        await rename(`${file}.tmp`, file);
      })
      .catch((error: unknown) => console.warn("[cutex-desktop] saving desktop prefs failed", error));
  }
}
