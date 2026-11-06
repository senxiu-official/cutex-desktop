import { BROWSER_CURSOR_MOVE_MS, browserCursorView, DEFAULT_BROWSER_CURSOR_COLOR, type BrowserCursorCue } from "../../shared/browserCursor";
import type { WebContents } from "electron";
import { BrowserCdpExecutor, type BrowserSnapshot, type CdpTransport, type DispatchResult, type ExecutorOperation, type OperationOptions } from "@cutex-desktop/browser-cdp";
import { ProtocolError, type BrowserAction, type BrowserFindQuery, type BrowserScreenshotMetadata } from "@cutex-desktop/browser-protocol";
import { DEFAULT_BROWSER_CONTROL_SETTINGS, isBrowserControlSettings, type BrowserControlSettings, type BrowserControlView, type BrowserOwnerInputKind } from "../../shared/browser";
import { browserScreenshotDimensions } from "./capture";
import { busyError } from "./relayTypes";
import type { BrowserViewportBounds } from "./visibility";

export type BrowserProviderGuest = Pick<WebContents, "isDestroyed" | "debugger">;
/** The native keyboard hook remains internal pending D-G V3; it is not an IPC input kind. */
export type BrowserOwnerTakeoverSource = BrowserOwnerInputKind | "guest-keyboard" | "owner-pause";
/** Main-only downward override for automatic owner attachments; never supplied by an agent. */
export type BrowserProviderOperationOptions = OperationOptions & { hiddenTarget?: "reject" };
export interface BrowserNavigationPreparation {
  /** Main-only dispatch URL. This may contain a one-use ticket and must never be returned. */
  url: string;
  cancel(): void;
}
export interface BrowserNavigationGuard { check(): void; markEffect(): void }
export interface InAppProviderOptions {
  /** Returns only the currently admitted, same-host-identity guest. Never resolve by renderer id. */
  getGuest(guestId: string): BrowserProviderGuest | undefined;
  nextPageGeneration(guestId: string): number;
  ensureVisible(guestId: string, settings: BrowserControlSettings, options?: OperationOptions): Promise<BrowserViewportBounds>;
  allowUrl(guestId: string, url: string): boolean;
  /** Runs only inside the serialized, visible, granted operation. No renderer-supplied hook. */
  prepareNavigation?(guestId: string, url: string, guard: BrowserNavigationGuard): Promise<BrowserNavigationPreparation>;
  onChanged(guestId: string): void;
  /**
   * True only while the app document's keyboard focus is this exact guest. Chromium delivers CDP
   * key / text input (Input.dispatchKeyEvent, Input.insertText) to the app window's focused
   * element, not to the debugged guest (verified on Electron 44): without guest focus a fill or
   * press would type into the owner's composer, or hit the owner-input shield and pause the
   * grant. Control never moves focus, so keyboard actions are refused before dispatch instead.
   */
  keyboardFocused?(guestId: string): Promise<boolean>;
  /** After an agent pointer action moved app focus into this guest: hand it back to where the
   * owner had it (composer, address bar). Fixed main-owned app-document script; never the page. */
  restoreFocus?(guestId: string): Promise<void>;
  /** True for a guest that shares no input focus with the app (main's offscreen background carrier
   * of an agent tab): the owner typing in the app's composer cannot collide with it. */
  isolated?(guestId: string): boolean;
  /** Right before the provider attaches the guest's debugger / right after it let it go: a
   * background carrier's dialog guard hands the debugger over (carrier.ts). Never grants anything. */
  beforeAttach?(guestId: string): void;
  /** Right after the provider attached: a new CDP session, without the page-scheme emulation (pageScheme.ts) — send it again. */
  afterAttach?(guestId: string): void;
  afterDetach?(guestId: string): void;
  /** Main/test-only; renderer and agents cannot alter action timing. */
  cursorMoveMs?: number;
  /** Native guest zoom / embedding app zoom, independent of scrollbar-reduced CSS viewport width. */
  coordinateScale?(guestId: string): number;
  now?(): number;
}
/** Owner keyboard input this recent counts as "typing": agent writes wait for the quiet. */
export const BROWSER_OWNER_TYPING_QUIET_MS = 1200;
/** Guest input this soon after an agent dispatch is attributed to that dispatch (D-G: Electron
 * cannot tell CDP from native guest input). Errs toward NOT invalidating the agent's refs. */
const AGENT_INPUT_GRACE_MS = 150;
const READ_OPERATIONS: ReadonlySet<ExecutorOperation> = new Set(["read", "find", "wait", "screenshot"]);
/** Reads that run without a visible card (minimized / hidden window). Screenshots still need it. */
const BACKGROUND_READS: ReadonlySet<ExecutorOperation> = new Set(["read", "find"]);
const KEYBOARD_OPERATIONS: ReadonlySet<ExecutorOperation> = new Set(["fill", "press"]);
type Binding = { alive: boolean; retiring: boolean; bounds: BrowserViewportBounds; emulated: boolean; executor?: BrowserCdpExecutor; cleanup: (() => void)[] };
type Entry = {
  id: string; guest: BrowserProviderGuest; settings: BrowserControlSettings; state: "granted" | "paused";
  grantee: string;
  busy: boolean; operating: boolean; blocked: number; binding?: Binding;
  /** Carrier hand-over in progress: new operations are refused (busy), the running one finishes. */
  draining: number;
  /** Co-control: last owner keyboard input in the guest / app, last owner guest input of any kind,
   * and the end of the agent's own dispatch window (input before then is the agent's). */
  typingAt: number; agentInputUntil: number; acting: boolean;
  operation?: BrowserProviderOperationOptions;
  cue?: BrowserCursorCue;
  cueSequence?: number;
  ownerInputVersion?: number;
  idle?: ReturnType<typeof setTimeout>; linger?: ReturnType<typeof setTimeout>;
};
const denied = () => new ProtocolError("permission_denied", "Browser control is not granted or is paused");
const closed = () => new ProtocolError("target_closed", "Browser target is no longer admitted");
function checkOperation(options: OperationOptions): void {
  if (options.signal?.aborted) throw new ProtocolError("cancelled", "Browser operation was cancelled before dispatch");
  if (options.deadline !== undefined && (!Number.isFinite(options.deadline) || Date.now() >= options.deadline))
    throw new ProtocolError("deadline_exceeded", "Browser operation deadline expired");
}
async function waitOperation<T>(promise: Promise<T> | undefined, options: OperationOptions): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined, abort = () => {};
  const pending = Promise.resolve(promise);
  void pending.catch(() => {});
  try {
    checkOperation(options);
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      abort = () => reject(new ProtocolError("cancelled", "Browser preflight was cancelled"));
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      if (options.deadline !== undefined) {
        timer = setTimeout(() => reject(new ProtocolError("deadline_exceeded", "Browser preflight deadline expired")),
          Math.max(0, Math.min(2_147_483_647, options.deadline - Date.now())));
        timer.unref?.();
      }
    })]);
  } finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
async function bounded<T>(promise: Promise<T>, timeout = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ProtocolError("transport_error", "Debugger setup or cleanup timed out")), timeout);
      timer.unref?.();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Main-only execution. Lease authority is admitted by the caller; no public evaluator or focus API. */
export class InAppProvider {
  private readonly entries = new Map<string, Entry>();
  private readonly retiring = new WeakMap<BrowserProviderGuest, Promise<void>>();
  private disposed = false;
  constructor(private readonly options: InAppProviderOptions) {}

  controlView(guestId: string): BrowserControlView | undefined {
    const entry = this.entries.get(guestId);
    return entry ? { grantee: entry.grantee, state: entry.state, operating: entry.operating } : undefined;
  }
  cursorView(guestId: string): BrowserCursorCue | undefined {
    const entry = this.entries.get(guestId);
    return entry?.state === "granted" && entry.binding?.alive && !entry.binding.emulated ? entry.cue : undefined;
  }
  hasGrant(guestId: string): boolean { return this.entries.has(guestId); }

  /** Explicit owner re-grant is the only resume path. Old debugger cleanup is serialized first. */
  async grant(guestId: string, settings: BrowserControlSettings = DEFAULT_BROWSER_CONTROL_SETTINGS,
    options: { grantee?: string; deferBinding?: boolean } = {}): Promise<void> {
    if (this.disposed) throw closed();
    if (!isBrowserControlSettings(settings)) throw new ProtocolError("invalid_request", "Invalid browser control settings");
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => key !== "grantee" && key !== "deferBinding")
      || (options.deferBinding !== undefined && typeof options.deferBinding !== "boolean")
      || (options.grantee !== undefined && (typeof options.grantee !== "string" || !options.grantee.trim() || [...options.grantee].length > 200
        || /[\u0000-\u001f\u007f-\u009f]/.test(options.grantee))))
      throw new ProtocolError("invalid_request", "Invalid browser grant options");
    const guest = this.options.getGuest(guestId);
    if (!guest || guest.isDestroyed()) throw closed();
    this.release(guestId);
    const entry: Entry = { id: guestId, guest, settings: { ...settings, viewport: { ...settings.viewport } },
      state: "granted", grantee: options.grantee ?? "Agent", busy: true, operating: false, blocked: 0, draining: 0, typingAt: -Infinity, agentInputUntil: -Infinity, acting: false };
    this.entries.set(guestId, entry);
    this.changed(entry);
    try {
      // A held background agent-open card may be mounted but invisible. Granting authority
      // must not reveal it, attach a debugger or run CDP. Every real operation still enters
      // ensureBinding, waits for old cleanup, and passes the complete visibility guard.
      if (!options.deferBinding) await this.ensureBinding(entry);
      this.authorize(entry);
    } catch (error) {
      // A concurrent owner pause remains visible instead of silently removing its resume UI.
      if (this.entries.get(guestId) === entry && entry.state !== "paused") this.release(guestId);
      throw error;
    } finally {
      entry.busy = false;
      if (this.entries.get(guestId) === entry && entry.state === "granted") this.scheduleIdle(entry);
    }
  }

  /**
   * Co-control (0.1.3): the owner's own clicks, scrolls and reading never pause the agent. Owner
   * input in the guest makes the agent's earlier snapshot stale (it must read again before a ref
   * action); owner typing (guest or app) makes agent writes wait for a short quiet.
   * kind: where the input happened. Never grants, resumes or forwards anything.
   */
  ownerActivity(guestId: string | undefined, kind: "guest-keyboard" | "guest-pointer" | "app-keyboard"): void {
    const now = this.now();
    for (const entry of guestId === undefined ? this.entries.values() : [this.entries.get(guestId)].filter(e => !!e) as Entry[]) {
      if (kind === "app-keyboard" && this.options.isolated?.(entry.id)) continue;
      const agentEcho = kind !== "app-keyboard" && (entry.acting || now <= entry.agentInputUntil);
      if (kind !== "guest-pointer" && !agentEcho) entry.typingAt = now;
      if (kind !== "app-keyboard" && !agentEcho) {
        entry.ownerInputVersion = (entry.ownerInputVersion ?? 0) + 1;
        entry.cue = undefined; entry.binding?.executor?.expireRefs(); this.changed(entry);
      }
    }
  }
  /** Input arriving now is the agent's own dispatch (during it or within its short echo window). */
  agentInput(guestId: string): boolean {
    const entry = this.entries.get(guestId);
    return !!entry && (entry.acting || this.now() <= entry.agentInputUntil);
  }
  /** True while the owner typed within the quiet window (renderer/tests may read it). */
  ownerTyping(guestId: string): boolean {
    const entry = this.entries.get(guestId);
    return !!entry && this.now() - entry.typingAt < BROWSER_OWNER_TYPING_QUIET_MS;
  }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  /**
   * The owner's explicit 「暂停智能体」 (and the legacy capture input kinds, now only from an old
   * renderer): downgrade only. Revoke before cleanup so duplicates cannot stop a binding twice.
   */
  ownerTakeover(guestId: string, _source: BrowserOwnerTakeoverSource): void {
    const entry = this.entries.get(guestId);
    if (!entry || entry.state !== "granted") return;
    entry.state = "paused";
    entry.operating = false;
    this.clearTimers(entry);
    this.detach(entry);
    this.changed(entry);
  }
  /** Main navigation-policy rejection, not a generic resource/network error. */
  policyBlocked(guestId: string): void {
    const entry = this.entries.get(guestId);
    if (!entry) return;
    entry.blocked++;
    this.detach(entry);
  }
  release(guestId: string): void {
    const entry = this.entries.get(guestId);
    if (!entry) return;
    this.entries.delete(guestId); // Revoke before any cleanup command/callback can re-enter.
    this.clearTimers(entry);
    this.detach(entry);
    this.changed(entry);
  }
  /**
   * Carrier hand-over (background carrier <-> visible webview): wait until the operation now running
   * on this guest has finished (it is never split across two pages), and refuse new ones with busy
   * until the returned release is called (or the entry is released / re-granted). No grant: no-op.
   */
  async drain(guestId: string, deadline: number): Promise<() => void> {
    const entry = this.entries.get(guestId);
    if (!entry) return () => {};
    entry.draining++;
    let released = false;
    const release = () => { if (!released) { released = true; entry.draining = Math.max(0, entry.draining - 1); } };
    try {
      while (entry.busy && this.entries.get(guestId) === entry) {
        if (Date.now() >= deadline) throw busyError(new ProtocolError("busy", "The agent's current browser action did not finish in time; try again shortly"), "previous_action_running");
        await new Promise<void>(resolve => { const timer = setTimeout(resolve, 20); timer.unref?.(); });
      }
      return release;
    } catch (error) { release(); throw error; }
  }
  /** Registry owns closing WebContents. This hook only revokes its main-owned control binding. */
  close(guestId: string): void { this.release(guestId); }
  dispose(): void {
    this.disposed = true;
    for (const id of [...this.entries.keys()]) this.release(id);
  }

  snapshot(guestId: string, options?: OperationOptions): Promise<BrowserSnapshot> {
    return this.run(guestId, "read", options, (executor, control) => executor.read(control));
  }
  find(guestId: string, query: BrowserFindQuery, options?: OperationOptions): Promise<BrowserSnapshot> {
    return this.run(guestId, "find", options, (executor, control) => executor.find(query, control));
  }
  action(guestId: string, action: BrowserAction, options?: OperationOptions): Promise<DispatchResult> {
    return this.run(guestId, action.kind, options, (executor, control) => executor.action(action, control));
  }
  act(guestId: string, ref: string, action: "click" | "fill" | "press", value = "", options?: OperationOptions): Promise<DispatchResult> {
    return this.run(guestId, action, options, (executor, control) => executor.act(ref, action, value, control));
  }
  navigate(guestId: string, url: string, options?: OperationOptions): Promise<DispatchResult> {
    return this.run(guestId, "navigate", options, async (executor, control) => {
      if (!this.options.prepareNavigation) return executor.navigate(url, control);
      const entry = this.entries.get(guestId)!;
      let active = true, effects = false, prepared: BrowserNavigationPreparation | undefined;
      const check = () => {
        if (!active) throw new ProtocolError("cancelled", "Browser navigation preparation expired");
        checkOperation(control); this.authorize(entry);
        if (!entry.binding?.alive || entry.binding.executor !== executor) throw closed();
      };
      try {
        check();
        const preparing = this.options.prepareNavigation(guestId, url, { check, markEffect() { check(); effects = true; } });
        // A bounded wait must not let a late bootstrap resurrect its service lease.
        void preparing.then(value => { if (!active) value.cancel(); }, () => {});
        prepared = (await waitOperation(preparing, control))!;
        check();
        // The executor rechecks the complete visibility guard after any ticket/lease RPC.
        return await executor.navigate(prepared.url, control);
      } catch (error) {
        prepared?.cancel();
        const code = (error as { code?: unknown })?.code;
        if (effects && ["cancelled", "deadline_exceeded", "target_closed", "permission_denied"].includes(String(code)))
          throw new ProtocolError("outcome_unknown", "Service preparation may have changed state; never replay automatically");
        throw error;
      } finally { active = false; }
    });
  }
  screenshot(guestId: string, options?: BrowserProviderOperationOptions & { ref?: string; format?: "png" | "jpeg"; quality?: number }): Promise<BrowserScreenshotMetadata & { mimeType: "image/png" | "image/jpeg"; data: string; pageGeneration: number; width: number; height: number }> {
    return this.run(guestId, "screenshot", options, async (executor, control) => {
      const result = await executor.screenshot({ ...options, ...control });
      const binding = this.entries.get(guestId)?.binding;
      if (!binding?.alive || binding.executor !== executor) throw closed();
      const size = browserScreenshotDimensions(result.mimeType, result.data);
      return { ...result, ...size, displayScale: 1,
        imageScale: { x: size.width / result.captureRect.width, y: size.height / result.captureRect.height } };
    });
  }

  private async ownerQuiet(entry: Entry, control: OperationOptions): Promise<void> {
    for (;;) {
      const wait = entry.typingAt + BROWSER_OWNER_TYPING_QUIET_MS - this.now();
      if (wait <= 0) return;
      if (control.deadline !== undefined && this.now() + wait >= control.deadline)
        throw busyError(new ProtocolError("busy", "The owner is typing in the app; try this action again shortly"), "owner_typing");
      await waitOperation(new Promise<void>(resolve => { const timer = setTimeout(resolve, Math.min(wait, 100)); timer.unref?.(); }), control);
      this.authorize(entry);
    }
  }
  private authorize(entry: Entry): void {
    if (this.disposed || this.options.getGuest(entry.id) !== entry.guest || entry.guest.isDestroyed()) throw closed();
    if (this.entries.get(entry.id) !== entry || entry.state !== "granted") throw denied();
  }
  private changed(entry: Entry): void { try { this.options.onChanged(entry.id); } catch { /* Observers cannot restore authority. */ } }
  private clearTimers(entry: Entry): void {
    if (entry.idle) clearTimeout(entry.idle);
    if (entry.linger) clearTimeout(entry.linger);
    entry.idle = entry.linger = undefined;
  }
  private async ensureBinding(entry: Entry, operation: BrowserProviderOperationOptions = {}, background = false): Promise<BrowserCdpExecutor> {
    checkOperation(operation);
    await waitOperation(this.retiring.get(entry.guest), operation);
    this.authorize(entry);
    checkOperation(operation);
    const visibleSettings = operation.hiddenTarget === "reject" ? { ...entry.settings, hiddenTarget: "reject" as const } : entry.settings;
    let bounds: BrowserViewportBounds | undefined;
    let emulated = this.options.isolated?.(entry.id) === true;
    try { bounds = await waitOperation(this.options.ensureVisible(entry.id, background ? { ...visibleSettings, hiddenTarget: "reject" } : visibleSettings, operation), operation); }
    catch (error) {
      // A minimized / hidden window still answers read and find (DOM only, no input, no reveal).
      if (!background || (error as { code?: unknown })?.code !== "target_hidden") throw error;
      this.authorize(entry);
      checkOperation(operation);
      // Covered by an app overlay / clipped / not ready, but laid out: read at the page's own
      // size. Only a truly hidden page gets the fixed emulated viewport (at DPR 1), which on a
      // visible card would show the owner a rescaled, blurry page.
      const layout = (error as { layout?: BrowserViewportBounds }).layout;
      if (layout) bounds = { ...layout };
      else { emulated = true; bounds = { ...entry.settings.viewport }; }
    }
    this.authorize(entry);
    checkOperation(operation);
    if (emulated) bounds = { ...entry.settings.viewport };
    this.checkBounds(bounds!);
    if (entry.binding?.alive && entry.binding.executor) {
      const binding = entry.binding;
      const resized = bounds!.width !== binding.bounds.width || bounds!.height !== binding.bounds.height;
      const changedMode = binding.emulated !== emulated;
      if (changedMode || emulated && resized) {
        try {
          const command = emulated
            ? entry.guest.debugger.sendCommand("Emulation.setDeviceMetricsOverride", this.metrics(bounds!))
            : entry.guest.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
          await waitOperation(bounded(command), operation);
          this.authorize(entry);
          checkOperation(operation);
          if (!binding.alive || entry.binding !== binding) throw closed();
        } catch (error) { if (entry.binding === binding) this.detach(entry); throw error; }
      }
      if (changedMode || resized) { entry.cue = undefined; binding.executor!.expireRefs(); this.changed(entry); }
      binding.bounds = { ...bounds! };
      binding.emulated = emulated;
      return binding.executor!;
    }
    const debug = entry.guest.debugger;
    try { this.options.beforeAttach?.(entry.id); } catch { /* The attach below decides. */ }
    if (debug.isAttached()) throw busyError(new ProtocolError("tab_busy", "A different debugger already controls this guest"), "debugger_attached");
    try { debug.attach("1.3"); } catch { throw busyError(new ProtocolError("tab_busy", "Could not attach the browser debugger"), "debugger_attach_failed"); }
    try { this.options.afterAttach?.(entry.id); } catch { /* Observers cannot block the binding. */ }
    const binding: Binding = { alive: true, retiring: false, bounds: { ...bounds! }, emulated, cleanup: [] };
    entry.binding = binding;
    const transport: CdpTransport = {
      send: (method, params) => {
        // Includes late executor finally/reset callbacks: they cannot touch a replacement binding.
        if (!binding.alive || entry.guest.isDestroyed() || !debug.isAttached()) return Promise.reject(closed());
        return debug.sendCommand(method, params);
      },
      onEvent: callback => {
        const listener = (_event: unknown, method: string, params: Record<string, unknown>) => callback({ method, params });
        debug.on("message", listener);
        return () => debug.removeListener("message", listener);
      },
      onDetach: callback => {
        const listener = (_event: unknown, reason: string) => callback(reason);
        debug.on("detach", listener);
        return () => debug.removeListener("detach", listener);
      },
    };
    const detached = () => {
      if (binding.retiring || !binding.alive) return;
      binding.alive = false;
      if (entry.binding === binding) entry.binding = undefined;
      binding.executor?.dispose();
      for (const clean of binding.cleanup.splice(0)) clean();
      if (entry.idle) clearTimeout(entry.idle);
      entry.idle = undefined;
      this.changed(entry);
      this.afterDetach(entry);
    };
    debug.on("detach", detached);
    binding.cleanup.push(() => debug.removeListener("detach", detached));
    try {
      binding.executor = new BrowserCdpExecutor(transport, {
        nextPageGeneration: () => { const hadCue = !!entry.cue; entry.cue = undefined; const generation = this.options.nextPageGeneration(entry.id); if (hadCue && entry.state === "granted" && entry.binding === binding && binding.alive) this.changed(entry); return generation; },
        authorize: () => this.authorize(entry),
        ensureVisible: async () => {
          this.authorize(entry);
          const settings = entry.operation?.hiddenTarget === "reject" ? { ...entry.settings, hiddenTarget: "reject" as const } : entry.settings;
          const current = await this.options.ensureVisible(entry.id, settings, entry.operation);
          this.authorize(entry);
          this.checkBounds(current);
          if (current.width !== binding.bounds.width || current.height !== binding.bounds.height)
            throw new ProtocolError("target_hidden", "Browser card resized during operation; inspect again before acting");
        },
        canShowAction: () => binding.alive && entry.binding === binding && !binding.emulated,
        onAction: async feedback => {
          this.authorize(entry); checkOperation(entry.operation ?? {});
          if (!binding.alive || entry.binding !== binding) throw closed();
          if (binding.emulated) return false;
          const scale = this.options.coordinateScale?.(entry.id) ?? 1;
          if (!Number.isFinite(scale) || scale <= 0 || scale > 10) return false;
          const sx = scale, sy = scale;
          const candidate = browserCursorView({ sequence: (entry.cueSequence ?? 0) + 1, kind: feedback.kind, phase: feedback.phase,
            x: feedback.x * sx, y: feedback.y * sy, viewport: { ...binding.bounds }, color: DEFAULT_BROWSER_CURSOR_COLOR,
            ...(feedback.rect ? { rect: { x: feedback.rect.x * sx, y: feedback.rect.y * sy, width: feedback.rect.width * sx, height: feedback.rect.height * sy } } : {}) });
          if (!candidate) return false;
          const ownerInputVersion = entry.ownerInputVersion ?? 0;
          if (feedback.phase === "move") entry.acting = false; // real owner input during the animation is never an agent echo
          if (feedback.phase === "dispatch") {
            if (this.ownerTyping(entry.id)) throw busyError(new ProtocolError("busy", "Owner started typing before dispatch; inspect again"), "owner_typing");
            if (feedback.kind === "type" && this.options.keyboardFocused && !await waitOperation(this.options.keyboardFocused(entry.id), entry.operation ?? {}))
              throw new ProtocolError("unsupported_operation", "Keyboard focus changed before input; inspect again");
            this.authorize(entry); checkOperation(entry.operation ?? {});
            if (!binding.alive || entry.binding !== binding) throw closed();
            if (this.ownerTyping(entry.id)) throw busyError(new ProtocolError("busy", "Owner started typing before dispatch; inspect again"), "owner_typing");
            entry.acting = true;
          }
          const { color: _color, ...cue } = candidate;
          entry.cueSequence = cue.sequence; entry.cue = cue; this.changed(entry);
          if (feedback.phase === "move") {
            const ms = this.options.cursorMoveMs ?? BROWSER_CURSOR_MOVE_MS;
            if (ms > 0) await waitOperation(new Promise<void>(resolve => { const timer = setTimeout(resolve, Math.min(ms, 300)); timer.unref?.(); }), entry.operation ?? {});
            this.authorize(entry); checkOperation(entry.operation ?? {});
            if (!binding.alive || entry.binding !== binding) throw closed();
            if ((entry.ownerInputVersion ?? 0) !== ownerInputVersion) throw new ProtocolError("stale_ref", "Owner used the page during feedback; inspect again");
            // All long waits finish before the executor re-inspects the target geometry.
            await this.ownerQuiet(entry, entry.operation ?? {});
            this.authorize(entry); checkOperation(entry.operation ?? {});
            if (!binding.alive || entry.binding !== binding) throw closed();
            if ((entry.ownerInputVersion ?? 0) !== ownerInputVersion) throw new ProtocolError("stale_ref", "Owner used the page during feedback; inspect again");
          }
          return true;
        },
        allowUrl: url => this.options.allowUrl(entry.id, url),
        // Deliberately no focusTarget: control never focuses the guest or native window.
      });
      // Visible cards keep their native viewport, zoom and DPR. Only hidden/offscreen targets
      // need a fallback layout; image budgets are applied to screenshot pixels, never to the page.
      if (emulated) await waitOperation(bounded(transport.send("Emulation.setDeviceMetricsOverride", this.metrics(bounds!))), operation);
      this.authorize(entry);
      checkOperation(operation);
      if (!binding.alive || entry.binding !== binding) throw closed();
      return binding.executor;
    } catch (error) { if (entry.binding === binding) this.detach(entry); throw error; }
  }
  private afterDetach(entry: Entry): void { try { this.options.afterDetach?.(entry.id); } catch { /* Observers cannot restore authority. */ } }
  private checkBounds(bounds: BrowserViewportBounds): void {
    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width < 1 || bounds.height < 1)
      throw new ProtocolError("target_hidden", "Browser card bounds are unavailable");
  }
  private metrics(bounds: BrowserViewportBounds): Record<string, unknown> {
    return { width: bounds.width, height: bounds.height, deviceScaleFactor: 1, mobile: false, scale: 1 };
  }
  private detach(entry: Entry): void {
    entry.cue = undefined;
    const binding = entry.binding;
    if (!binding) return;
    entry.binding = undefined;
    binding.retiring = true;
    // stop/dispose are synchronous, cancelling in-flight input with executor outcome semantics.
    binding.executor?.dispose();
    const debug = entry.guest.debugger;
    const cleanup = (async () => {
      try {
        if (binding.alive && !entry.guest.isDestroyed() && debug.isAttached())
          await bounded(Promise.resolve(debug.sendCommand("Emulation.clearDeviceMetricsOverride")));
      } catch { /* Detach is the terminal fallback when an override reset cannot be confirmed. */ }
      finally {
        binding.alive = false;
        for (const clean of binding.cleanup.splice(0)) clean();
        try { if (!entry.guest.isDestroyed() && debug.isAttached()) debug.detach(); } catch { /* Already detached/closed. */ }
        this.afterDetach(entry);
      }
    })();
    this.retiring.set(entry.guest, cleanup);
    void cleanup.then(() => { if (this.retiring.get(entry.guest) === cleanup) this.retiring.delete(entry.guest); });
  }
  private scheduleIdle(entry: Entry): void {
    if (entry.idle) clearTimeout(entry.idle);
    if (!entry.binding || entry.state !== "granted" || entry.busy) return;
    entry.idle = setTimeout(() => {
      entry.idle = undefined;
      if (this.entries.get(entry.id) === entry && !entry.busy) this.detach(entry);
    }, entry.settings.idleDetachSeconds * 1000);
    entry.idle.unref?.();
  }
  private async run<T>(guestId: string, operation: ExecutorOperation, options: BrowserProviderOperationOptions | undefined,
    body: (executor: BrowserCdpExecutor, options: OperationOptions) => Promise<T>): Promise<T> {
    const entry = this.entries.get(guestId);
    if (!entry) throw denied();
    this.authorize(entry);
    const control = { ...options, deadline: options?.deadline ?? Date.now() + 10_000 };
    checkOperation(control);
    if (entry.busy) throw busyError(new ProtocolError("busy", "One operation per guest is allowed"), "tab_operation_running");
    if (entry.draining > 0) throw busyError(new ProtocolError("busy", "This tab is moving between background and front; try again shortly"), "tab_moving");
    entry.busy = true;
    entry.operation = control;
    this.clearTimers(entry);
    entry.operating = true;
    this.changed(entry);
    const blocked = entry.blocked;
    const write = !READ_OPERATIONS.has(operation);
    let focusedBefore: boolean | undefined;
    try {
      // Co-control: a write waits while the owner is typing (guest or app), never past its deadline.
      if (write) await this.ownerQuiet(entry, control);
      if (KEYBOARD_OPERATIONS.has(operation) && this.options.keyboardFocused) {
        const focused = await waitOperation(this.options.keyboardFocused(guestId), control);
        this.authorize(entry);
        if (focused !== true) throw new ProtocolError("unsupported_operation",
          "Keyboard input needs this page to hold the app's keyboard focus; the in-app browser never moves focus, so fill/press are unavailable here");
      } else if (write && this.options.restoreFocus && this.options.keyboardFocused)
        focusedBefore = await waitOperation(this.options.keyboardFocused(guestId), control).catch(() => undefined);
      const executor = await this.ensureBinding(entry, control, BACKGROUND_READS.has(operation));
      checkOperation(control);
      if (write) await this.ownerQuiet(entry, control); // owner may have started typing meanwhile
      let result: T;
      entry.acting = write;
      try { result = await body(executor, control); }
      finally {
        entry.acting = false;
        if (write) entry.agentInputUntil = this.now() + AGENT_INPUT_GRACE_MS;
        // A pointer action of the agent can move app focus into the page; give it back.
        if (focusedBefore === false) void this.options.restoreFocus!(guestId).catch(() => {});
      }
      // A completed mutating executor result racing owner revocation is not safe to replay.
      try { this.authorize(entry); } catch (error) {
        if (!["read", "find", "wait", "screenshot"].includes(operation))
          throw new ProtocolError("outcome_unknown", "Control was revoked after possible side effects; never replay automatically");
        throw error;
      }
      if (operation === "navigate" && entry.blocked !== blocked) throw denied();
      return result;
    } catch (error) {
      if (write) { entry.cue = undefined; this.changed(entry); }
      // Only a host-proven navigation denial maps S6. Click/fill may already have changed data.
      if (operation === "navigate" && entry.blocked !== blocked) throw denied();
      throw error;
    } finally {
      entry.busy = false;
      entry.operation = undefined;
      if (this.entries.get(entry.id) === entry && entry.state === "granted") {
        entry.linger = setTimeout(() => { entry.linger = undefined; entry.operating = false; this.changed(entry); }, 5000);
        entry.linger.unref?.();
        this.scheduleIdle(entry);
      }
    }
  }
}
