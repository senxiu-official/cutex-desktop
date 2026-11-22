// 项目看板 (board window, owner 2026-11-17): a separate lightweight window for a second, portrait monitor — not the
// experimental 多窗口 desks (main/appWindows.ts, deskWindows.ts). It mounts no conversation or timeline: main reads
// summary data over the host connections the app already has (the sidebar catalog with its session deltas, the
// delegation lists, pending notices / approvals, services, quota), builds one view per project (shared/boardModel.ts)
// and sends it to the window. Reads happen only while the window is shown (main/boardSchedule.ts): hidden,
// minimised or closed = zero requests. A click asks main to show the main window at that project / agent.
//
// The window loads src/renderer/board.html with its own narrow preload (preload/board.ts): sandboxed,
// contextIsolation, no nodeIntegration, no navigation, no window.open. Its channel accepts calls only from it.
// Prefs (open on launch, always on top, big text, view, order / pins / hidden, bounds) live in userData/board-window.json.
import { readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, screen, type WebContents } from "electron";
import type { HostView } from "../shared/hosts";
import type { AskSummary, ServiceView } from "../shared/ipc";
import {
  applyBoardPatch, BOARD_CHANNEL, BOARD_DEFAULT_SIZE, BOARD_MIN_SIZE, BOARD_STATE, parseBoardPrefs, parseBoardTarget,
  type BoardHostView, type BoardPrefs, type BoardProjectView, type BoardRequest, type BoardState, type BoardTarget,
} from "../shared/board";
import { BOARD_SUMMARY_FEATURE, parseBoardSummary } from "../shared/boardBackend";
import { buildBoard, mergedBackendParts, quotaExhausted, type BoardHostInput } from "../shared/boardModel";
import { BoardSchedule, boardRelevantEvent, placeBoard } from "./boardSchedule";
import type { DaemonService } from "./daemon";
import { devRendererUrl } from "./devRenderer";
import type { DesktopShell } from "./shell";

export interface BoardDeps {
  hosts(): HostView[];
  daemonFor(hostId: string): DaemonService | null;
  shell: DesktopShell;
  /** Show the main window at this target (main/index.ts sends `boardOpen` to the app renderer). */
  openInApp(target: BoardTarget): void;
}

/** Quota is read at most this often per profile (it changes slowly; the app's own reads share cutex's cache). */
const QUOTA_EVERY_MS = 5 * 60_000;
const OPEN_LIMIT = 200;
const CLOSED_LIMIT = 100;

type HostCache = Omit<BoardHostInput, "label" | "state">;

export class BoardWindow {
  private win: BrowserWindow | null = null;
  private prefs: BoardPrefs;
  private cache = new Map<string, HostCache>();
  private quota = new Map<string, { out: boolean; at: number }>();
  private demo: BoardProjectView[] | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private boundsTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly schedule: BoardSchedule;

  constructor(private readonly deps: BoardDeps) {
    this.prefs = this.load();
    this.schedule = new BoardSchedule({
      read: (hostId, live) => this.readHost(hostId, live),
      hosts: () => this.liveHostIds(),
      now: () => Date.now(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
  }

  /** Register the window's IPC (once, after app ready). */
  start(): void {
    ipcMain.handle(BOARD_CHANNEL, (event, request: BoardRequest) => {
      if (!this.isBoardSender(event.sender)) throw new Error("untrusted sender");
      return this.handle(request);
    });
  }

  /** The board's webContents (main/index.ts refuses every app channel from it). */
  isBoardSender(sender: WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && sender === this.win.webContents;
  }

  get openOnLaunch(): boolean {
    return this.prefs.openOnLaunch;
  }

  /** Settings → 通用 → 项目看板 → 启动时打开. */
  setOpenOnLaunch(value: boolean): boolean {
    this.setPrefs({ ...this.prefs, openOnLaunch: value === true });
    return this.prefs.openOnLaunch;
  }

  /** Open (or bring up) the board. */
  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    this.createWindow();
  }

  /** Dev only: show sample projects without a daemon (CUTEX_DESKTOP_DEMO_BOARD=1). */
  showDemo(projects: BoardProjectView[]): void {
    this.demo = projects;
    this.open();
    this.push();
  }

  /** A host feed event (main/index.ts, every connected host). */
  onHostEvent(hostId: string, method: string | null | undefined): void {
    if (boardRelevantEvent(method)) this.schedule.poke(hostId);
  }

  /** Session catalog changes (session deltas: busy / idle / membership), connection changes. */
  onHostChanged(hostId: string): void {
    this.schedule.poke(hostId);
    this.queuePush();
  }

  /** A host's connection ended / was removed: keep its last read (shown as offline) until it is gone from the list. */
  forgetHost(hostId: string): void {
    if (!this.deps.hosts().some((h) => h.id === hostId)) this.cache.delete(hostId);
    this.queuePush();
  }

  onLocaleChanged(): void {
    this.push();
  }

  dispose(): void {
    this.schedule.setActive(false);
    this.win?.destroy();
    this.win = null;
  }

  // ---------- window ----------

  private createWindow(): void {
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea, primary: d.id === screen.getPrimaryDisplay().id }));
    const r = placeBoard(this.prefs.bounds, displays, BOARD_DEFAULT_SIZE);
    const win = new BrowserWindow({
      ...r,
      minWidth: BOARD_MIN_SIZE.width,
      minHeight: BOARD_MIN_SIZE.height,
      show: false,
      title: "Cutex",
      icon: this.deps.shell.appIcon(),
      backgroundColor: "#141416",
      autoHideMenuBar: true,
      alwaysOnTop: this.prefs.alwaysOnTop,
      webPreferences: {
        preload: join(__dirname, "../preload/board.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        // Throttled when hidden anyway; main stops reading then.
        backgroundThrottling: true,
      },
    });
    this.win = win;
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("did-finish-load", () => this.push());
    win.once("ready-to-show", () => {
      if (this.win === win) win.show();
    });
    const activity = () => this.syncActive();
    for (const e of ["show", "hide", "minimize", "restore"] as const) win.on(e as "show", activity);
    const remember = () => this.rememberBounds();
    win.on("move", remember);
    win.on("resize", remember);
    win.on("closed", () => {
      if (this.win !== win) return;
      this.win = null;
      this.syncActive();
    });
    const devUrl = devRendererUrl(app.isPackaged);
    if (devUrl) void win.loadURL(`${devUrl.replace(/\/$/, "")}/board.html`);
    else void win.loadFile(join(__dirname, "../renderer/board.html"));
  }

  /** Reads run only while the window is on screen. */
  private syncActive(): void {
    const win = this.win;
    const on = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && !this.demo;
    this.schedule.setActive(on);
  }

  private rememberBounds(): void {
    if (this.boundsTimer) clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => {
      this.boundsTimer = null;
      const win = this.win;
      if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
      this.setPrefs({ ...this.prefs, bounds: win.getBounds() }, false);
    }, 600);
  }

  // ---------- data ----------

  /** Hosts with a connection (connected or trying); hosts the owner keeps off are not on the board. */
  private liveHostIds(): string[] {
    return this.deps.hosts().filter((h) => h.conn?.epoch && this.deps.daemonFor(h.id)).map((h) => h.id);
  }

  private hostState(h: HostView): BoardHostView["state"] {
    const kind = h.conn?.daemon.kind;
    return kind === "connected" ? "connected" : kind === "connecting" ? "connecting" : "offline";
  }

  /**
   * One host's summary reads; each part keeps its last value when its read fails. `live` (the schedule's) turns false
   * once the window is hidden / minimised / closed: no further request starts and nothing is stored after that, and a
   * read over a connection that has since been replaced is dropped the same way.
   */
  private async readHost(hostId: string, live: () => boolean): Promise<void> {
    const daemon = this.deps.daemonFor(hostId);
    if (!daemon || daemon.currentState.kind !== "connected") {
      this.queuePush();
      return;
    }
    const current = () => live() && this.deps.daemonFor(hostId) === daemon;
    const prev = this.cache.get(hostId);
    const settle = async <T>(p: () => Promise<T>, keep: T | null): Promise<T | null> => {
      try {
        return await p();
      } catch {
        return keep;
      }
    };
    const caps = await settle(() => daemon.capabilities(), null);
    if (!current()) return;
    const features = caps?.featureList ? new Set(caps.featureList) : (prev?.features ?? null);
    if (features?.has(BOARD_SUMMARY_FEATURE)) {
      // G1: the summary replaces the list reads; member tiles still come from the sidebar catalog (session deltas).
      const [sidebar, raw] = await Promise.all([settle(() => daemon.sidebar(), prev?.sidebar ?? null), settle(() => daemon.projectBoard(), null)]);
      if (!current()) return;
      const summary = raw === null ? (prev?.summary ?? null) : parseBoardSummary(raw);
      if (summary) {
        this.cache.set(hostId, { hostId, readAt: Date.now(), features, sidebar, openAsks: null, closedAsks: null, notifications: null, approvals: null, services: null, quotaOut: null, summary });
        this.queuePush();
        return;
      }
    }
    const [sidebar, openAsks, closedAsks, notifications, approvals, services] = await Promise.all([
      settle(() => daemon.sidebar(), prev?.sidebar ?? null),
      settle(async () => (await daemon.asks({ state: "open", limit: OPEN_LIMIT, background: true })) ?? null, prev?.openAsks ?? null),
      settle(async () => (await daemon.asks({ state: "closed", limit: CLOSED_LIMIT, background: true })) ?? null, prev?.closedAsks ?? null),
      settle(() => daemon.ownerNotifications({ filter: "pending", limit: 500 }), prev?.notifications ?? null),
      settle(() => daemon.approvals("pending"), prev?.approvals ?? null),
      settle(async () => (await daemon.services()).services as ServiceView[], prev?.services ?? null),
    ]);
    if (!current()) return;
    const quotaOut = await this.readQuota(daemon, hostId, sidebar, current);
    if (!current()) return;
    this.cache.set(hostId, {
      hostId, readAt: Date.now(), features, sidebar, openAsks: openAsks as AskSummary[] | null, closedAsks: closedAsks as AskSummary[] | null, notifications, approvals, services, quotaOut,
      // A full page may not be every delegation: counts / today / problems from it are partial (shown as unknown).
      openAsksTruncated: !!openAsks && openAsks.length >= OPEN_LIMIT,
      closedAsksTruncated: !!closedAsks && closedAsks.length >= CLOSED_LIMIT,
    });
    this.queuePush();
  }

  /** Profiles of online agents whose quota cutex reports at 0 %; each profile read at most every 5 minutes. */
  private async readQuota(daemon: DaemonService, hostId: string, sidebar: BoardHostInput["sidebar"], current: () => boolean): Promise<string[]> {
    const profiles = new Set<string>();
    for (const s of sidebar?.active ?? []) if (s.profile && s.activityStatus !== "offline" && s.runtime?.status !== "offline") profiles.add(s.profile);
    const now = Date.now();
    const out: string[] = [];
    for (const profile of profiles) {
      const key = `${hostId}\n${profile}`;
      let q = this.quota.get(key);
      if (!q || now - q.at > QUOTA_EVERY_MS) {
        if (!current()) break;
        try {
          q = { out: quotaExhausted(await daemon.profileQuota(profile)), at: now };
        } catch {
          q = { out: q?.out ?? false, at: now };
        }
        this.quota.set(key, q);
      }
      if (q.out) out.push(profile);
    }
    return out;
  }

  private queuePush(): void {
    if (!this.win || this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.push();
    }, 150);
  }

  private state(): BoardState {
    const hostViews = this.deps.hosts();
    const inputs: BoardHostInput[] = [];
    const hosts: BoardHostView[] = [];
    for (const h of hostViews) {
      const cached = this.cache.get(h.id);
      if (!h.conn?.epoch && !cached) continue;
      const state = this.hostState(h);
      hosts.push({ hostId: h.id, label: h.label, state, readAt: cached?.readAt ?? null });
      if (cached) inputs.push({ ...cached, label: h.label, state });
    }
    const base = { locale: this.deps.shell.locale, terms: this.deps.shell.terms, prefs: this.prefs };
    if (this.demo) return { ...base, hosts: [{ hostId: "demo-eva", label: "host-a", state: "connected", readAt: Date.now() - 4_000 }, { hostId: "demo-remote", label: "remote", state: "connected", readAt: Date.now() - 6_000 }], projects: this.demo, backend: { summary: false, steps: false, stalled: false, plan: false }, demo: true };
    return { ...base, hosts, projects: buildBoard(inputs, Date.now()), backend: mergedBackendParts(inputs) };
  }

  private push(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(BOARD_STATE, this.state());
  }

  private async handle(request: BoardRequest): Promise<BoardState | void> {
    switch (request?.op) {
      case "state":
        return this.state();
      case "prefs": {
        const next = applyBoardPatch(this.prefs, request.patch);
        if (next.alwaysOnTop !== this.prefs.alwaysOnTop && this.win && !this.win.isDestroyed()) this.win.setAlwaysOnTop(next.alwaysOnTop, "floating");
        this.setPrefs(next);
        return this.state();
      }
      case "open": {
        const target = parseBoardTarget(request.target);
        if (!target) throw new Error("bad board target");
        if (target.kind !== "needsYou" && target.hostId.startsWith("demo-")) return;
        this.deps.shell.show();
        this.deps.openInApp(target);
        return;
      }
      case "refresh":
        this.schedule.readNow();
        return;
      default:
        throw new Error("unknown board op");
    }
  }

  // ---------- prefs ----------

  private get file(): string {
    return join(app.getPath("userData"), "board-window.json");
  }

  private load(): BoardPrefs {
    try {
      return parseBoardPrefs(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      return parseBoardPrefs(null);
    }
  }

  private saving: Promise<void> = Promise.resolve();
  private setPrefs(next: BoardPrefs, pushState = true): void {
    this.prefs = next;
    const body = `${JSON.stringify(next, null, 2)}\n`;
    const file = this.file;
    this.saving = this.saving
      .then(async () => {
        await writeFile(`${file}.tmp`, body, "utf8");
        await rename(`${file}.tmp`, file);
      })
      .catch((error: unknown) => console.warn("[cutex-desktop] saving board prefs failed", error));
    if (pushState) this.push();
  }
}

/** Demo hook only in dev runs (never in a packaged build). */
export function demoBoardRequested(): boolean {
  return process.env.CUTEX_DESKTOP_DEMO_BOARD === "1" && !app.isPackaged;
}
