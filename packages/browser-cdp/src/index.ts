import { BROWSER_ERROR_CODES, isBrowserUrl, MAX_FILL_TEXT_CODE_POINTS, MAX_SCREENSHOT_BASE64_LENGTH,
  MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_NODES, ProtocolError } from '@cutex-desktop/browser-protocol';
import { parseBrowserAction, parseBrowserFindQuery, DEFAULT_FIND_LIMIT, DEFAULT_SCROLL_AMOUNT, MAX_DIALOG_POLICY_MS } from '@cutex-desktop/browser-protocol';
import type { BrowserErrorCode, BrowserAction, BrowserFindQuery } from '@cutex-desktop/browser-protocol';
import { ARM_RECEIPT, CHECK_FOCUS, FRAME_IDENTITY, INSPECT, SELECT_VALUE, SCROLL_INTO_VIEW, SELECT_OPTIONS, CHECKED_STATE, ARM_MOTION } from './page-functions.js';
import { imageDimensions } from './image.js';
import { exceedsCodePointLimit, serializedBytes, snapshotNode } from './limits.js';
import type { SnapshotNode } from './limits.js';
export type { SnapshotNode } from './limits.js';

export interface CdpEvent { method: string; params?: Record<string, unknown> }
export interface CdpTransport {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onEvent(callback: (event: CdpEvent) => void): () => void;
  onDetach(callback: (reason?: string) => void): () => void;
}
export type ExecutorOperation = 'read' | 'find' | BrowserAction['kind'] | 'navigate' | 'screenshot';
export interface ExecutorOptions {
  /** Guest registry allocator, persistent across executor replacement/LRU reload/regrant. */
  nextPageGeneration(): number;
  /** Check lease/permission; called before every CDP command, not just at operation entry. */
  authorize(operation: ExecutorOperation): void | Promise<void>;
  /** Pure preflight: host decides H2 visibility without focusing/restoring anything. */
  ensureVisible(): void | Promise<void>;
  /** Optional guest-only focus; called after preflight and tracked as a possible side effect. */
  focusTarget?(): void | Promise<void>;
  /** Host owns navigation/redirect interception too; this only checks operation boundaries. */
  allowUrl(url: string): boolean | Promise<boolean>;
  now?: () => number;
  snapshotTtlMs?: number;
  defaultTimeoutMs?: number;
}
export interface OperationOptions { signal?: AbortSignal; deadline?: number }
export interface ScreenshotOptions extends OperationOptions { ref?: string; format?: 'png' | 'jpeg'; quality?: number }
export interface ScreenshotResult { mimeType: 'image/png' | 'image/jpeg'; data: string; pageGeneration: number;
  viewport: { width: number; height: number }; captureRect: { x: number; y: number; width: number; height: number }; imageScale: { x: number; y: number } }
export interface BrowserSnapshot { pageGeneration: number; snapshotId: number; url: string; nodes: SnapshotNode[]; truncated: boolean }
export interface DispatchResult { status: 'dispatched'; observed?: true; pageGeneration: number }
type Ref = { backendNodeId: number; generation: number; expiresAt: number; frameId: string; unsupported: boolean };
type Active = { operation: ExecutorOperation; controller: AbortController; sideEffects: boolean; generation: number; deadline: number; refExpiresAt?: number; focusEmulationSent?: boolean; focusResetAttempt?: Promise<boolean>; allowNavigation?: boolean };
type FocusResetFlight = { wait: Promise<boolean>; pending: boolean; timedOut: boolean };
type IsolatedWorld = { frameId: string; generation: number; executionContextId: number };
const FOCUS_RESET_TIMEOUT_MS = 1000;
const CHROME_ERROR_URL = 'chrome-error://chromewebdata/';
type Json = Record<string, any>;
const error = (code: BrowserErrorCode, message: string) => new ProtocolError(code, message);
// Hosts may bundle protocol separately (or use another JS realm); instanceof alone is not enough.
function knownError(cause: unknown): ProtocolError | undefined {
  if (cause instanceof ProtocolError) return cause;
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' &&
    (BROWSER_ERROR_CODES as readonly string[]).includes(cause.code))
    return error(cause.code as BrowserErrorCode, 'Browser host rejected the operation');
  return undefined;
}

/** One guest / one transport. Never retries commands or owns an Electron/chrome connection. */
export class BrowserCdpExecutor {
  private refs = new Map<string, Ref>();
  private snapshot = 0;
  private generation = 0;
  private generationFailure?: ProtocolError;
  private readonly refNamespace: string;
  private rootFrame = '';
  private currentUrl = '';
  private closed = false;
  private stopped = false;
  private initialized = false;
  private isolatedWorld?: IsolatedWorld;
  private worldCreationDestroyedContexts?: Set<number>;
  private active?: Active;
  private focusEmulationDirty = false;
  private focusResetFlight?: FocusResetFlight;
  private terminalFocusReset?: Promise<boolean>;
  private dialogPolicy?: { response: 'accept' | 'dismiss'; promptText?: string; expiresAt: number; generation: number };
  private readonly unsubscribe: (() => void)[];
  private readonly now: () => number;

  constructor(private readonly transport: CdpTransport, private readonly options: ExecutorOptions) {
    this.now = options.now ?? Date.now;
    // No time/counter/Math.random fallback: capability refs need an independent crypto namespace.
    try {
      this.refNamespace = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),
        byte => byte.toString(16).padStart(2, '0')).join('');
    } catch { throw error('transport_error', 'Cryptographic ref namespace is unavailable'); }
    this.allocateGeneration();
    this.unsubscribe = [transport.onEvent(event => this.onEvent(event)), transport.onDetach(() => {
      this.closed = true;
      this.invalidate();
      this.active?.controller.abort(error('transport_error', 'Debugger transport detached'));
    })];
  }
  get pageGeneration(): number {
    if (this.generationFailure) throw this.generationFailure;
    return this.generation;
  }

  async read(options: OperationOptions = {}): Promise<BrowserSnapshot> {
    return this.run('read', options, ctx => this.snapshotFor(ctx));
  }
  async find(query: BrowserFindQuery, options: OperationOptions = {}): Promise<BrowserSnapshot> {
    const parsed = parseBrowserFindQuery(query);
    return this.run('find', options, ctx => this.snapshotFor(ctx, parsed));
  }
  private async snapshotFor(ctx: Active, query?: BrowserFindQuery): Promise<BrowserSnapshot> {
      // A failed new snapshot also invalidates the previous one: never silently reuse refs.
      this.refs.clear();
      const snapshotId = ++this.snapshot;
      await this.initialize(ctx);
      await this.checkCurrentUrl(ctx);
      const result = await this.send(ctx, 'Accessibility.getFullAXTree', { frameId: this.rootFrame }) as Json;
      this.samePage(ctx);
      if (!Array.isArray(result.nodes)) throw error('transport_error', 'Malformed AX response');
      const nodes: SnapshotNode[] = [];
      const snapshot: BrowserSnapshot = { pageGeneration: this.generation, snapshotId, url: this.currentUrl,
        nodes, truncated: false };
      // Reserve the longer boolean spelling (false) and the full serialized metadata, including URL.
      let byteLength = serializedBytes(snapshot);
      if (byteLength > MAX_SNAPSHOT_BYTES) throw error('message_too_large', 'Snapshot metadata exceeds the output budget');
      let inspected = 0;
      for (const original of result.nodes) {
        let node = original;
        if (node.ignored || !Number.isInteger(node.backendDOMNodeId)) continue;
        if (query && !matchesQuery(node, query)) continue; // Filter original AX before ANY output truncation.
        if (nodes.length >= (query?.limit ?? (query ? DEFAULT_FIND_LIMIT : MAX_SNAPSHOT_NODES))) { snapshot.truncated = true; break; }
        // AX roles do not establish privacy: <input list> is a combobox, number
        // inputs are spinbuttons, and custom controls may report other roles.
        // Every value needs the same bounded, fail-closed DOM check.
        if (node.value?.value !== undefined) {
          let safe = false;
          if (inspected++ < 256) {
            try {
              const described = await this.send(ctx, 'DOM.describeNode', { backendNodeId: node.backendDOMNodeId, depth: 0 }) as Json;
              this.samePage(ctx);
              const attributes = described.node?.attributes;
              if (Array.isArray(attributes) && attributes.length % 2 === 0 && attributes.every(value => typeof value === 'string')) {
                const attrs = new Map<string, string>();
                for (let i = 0; i < attributes.length; i += 2) attrs.set(attributes[i]!.toLowerCase(), attributes[i + 1]!.toLowerCase());
                const name = String(described.node?.nodeName ?? '').toUpperCase();
                const sensitiveAutocomplete = (attrs.get('autocomplete') ?? '').split(/\s+/).some(token =>
                  token === 'one-time-code' || /^cc-/.test(token) || /password|passcode/.test(token));
                safe = (name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT' || attrs.has('contenteditable'))
                  && attrs.get('type') !== 'password' && !sensitiveAutocomplete;
              }
            } catch (cause) {
              // DOM disappearance/protocol errors redact. Cancellation, revocation, timeout,
              // navigation and detach are operation failures, not privacy fallbacks.
              if (knownError(cause)?.code !== 'transport_error' || this.closed) throw cause;
              this.check(ctx); this.samePage(ctx);
            }
          }
          if (!safe) node = { ...node, value: undefined };
        }
        const frameId = typeof node.frameId === 'string' ? node.frameId : this.rootFrame;
        const role = String(node.role?.value ?? '');
        const ref = `${this.refNamespace}-g${this.generation}s${snapshotId}n${nodes.length}`;
        const outputNode = snapshotNode(ref, node);
        const addition = serializedBytes(outputNode) + (nodes.length ? 1 : 0);
        if (byteLength + addition > MAX_SNAPSHOT_BYTES) { snapshot.truncated = true; break; }
        byteLength += addition;
        if (outputNode.truncated) snapshot.truncated = true;
        this.refs.set(ref, {
          backendNodeId: node.backendDOMNodeId, generation: this.generation,
          expiresAt: this.now() + (this.options.snapshotTtlMs ?? 30_000), frameId,
          unsupported: frameId !== this.rootFrame || /iframe/i.test(role),
        });
        nodes.push(outputNode);
      }
      return snapshot;
  }

  async action(action: BrowserAction, options: OperationOptions = {}): Promise<DispatchResult> {
    const input = parseBrowserAction(action);
    if (input.kind === 'click' || input.kind === 'fill' || input.kind === 'press')
      return this.act(input.ref, input.kind, input.kind === 'fill' ? input.text : input.kind === 'press' ? input.key : '', options);
    return this.run(input.kind, options, async ctx => {
      await this.initialize(ctx);
      if (input.kind === 'wait') return this.waitCondition(ctx, input.condition);
      await this.checkCurrentUrl(ctx);
      if (input.kind === 'dialog') {
        await this.wait(ctx, this.options.ensureVisible());
        this.samePage(ctx);
        this.dialogPolicy = { ...input, expiresAt: Math.min(ctx.deadline, this.now() + MAX_DIALOG_POLICY_MS), generation: this.generation };
        return { status: 'dispatched', pageGeneration: this.generation };
      }
      if (input.kind === 'back' || input.kind === 'forward' || input.kind === 'reload') {
        ctx.allowNavigation = true;
        if (input.kind === 'reload') { this.invalidate(); await this.send(ctx, 'Page.reload', {}, true); }
        else {
          const history = await this.send(ctx, 'Page.getNavigationHistory') as Json;
          const destination = history.entries?.[history.currentIndex + (input.kind === 'back' ? -1 : 1)];
          if (!destination || !Number.isInteger(destination.id)) throw error('not_actionable', 'No history entry in that direction');
          await this.permitUrl(ctx, destination.url); this.invalidate();
          await this.send(ctx, 'Page.navigateToHistoryEntry', { entryId: destination.id }, true);
        }
        return { status: 'dispatched', pageGeneration: this.generation };
      }
      const work = async (objectId: string) => {
        if (input.kind === 'scrollIntoView') {
          this.pageResult(await this.call(ctx, objectId, SCROLL_INTO_VIEW, [], true));
          this.pageResult(await this.call(ctx, objectId, INSPECT, ['hover']));
        } else if (input.kind === 'select') {
          this.pageResult(await this.call(ctx, objectId, INSPECT, ['select']));
          this.pageResult(await this.call(ctx, objectId, SELECT_OPTIONS, [input.by, input.values, false]));
          const result = await this.call(ctx, objectId, SELECT_OPTIONS, [input.by, input.values, true], true); this.pageResult(result);
          if (!Array.isArray(result.values) || !Array.isArray(result.expected) || JSON.stringify([...result.values].sort()) !== JSON.stringify([...result.expected].sort()))
            throw error('outcome_unknown', 'Select state was not observed; never replay');
        } else {
          const position: Json = input.kind === 'scroll' && !input.ref ? await this.viewport(ctx)
            : await this.call(ctx, objectId, INSPECT, [input.kind]);
          this.pageResult(position);
          if (input.kind === 'check' || input.kind === 'uncheck') {
            const desired = input.kind === 'check';
            if (position.checked !== desired) {
              await this.send(ctx, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', buttons: 1, clickCount: 1 }, true);
              await this.send(ctx, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y, button: 'left', buttons: 0, clickCount: 1 }, true);
            }
            if ((await this.call(ctx, objectId, CHECKED_STATE)).checked !== desired)
              throw error('outcome_unknown', 'Checkbox state not observed; never replay');
          } else if (input.kind === 'hover' || input.kind === 'scroll') {
            const armed = await this.send(ctx, 'Runtime.callFunctionOn', { objectId, functionDeclaration: ARM_MOTION,
              arguments: [{ value: input.kind }], returnByValue: false }) as Json;
            const receiptId = armed.result?.objectId;
            if (!receiptId || armed.exceptionDetails) throw error('not_actionable', 'Input receipt could not be armed');
            try {
              const amount = input.kind === 'scroll' ? input.amount ?? DEFAULT_SCROLL_AMOUNT : 0;
              await this.send(ctx, 'Input.dispatchMouseEvent', input.kind === 'hover'
                ? { type: 'mouseMoved', x: position.x, y: position.y, button: 'none' }
                : { type: 'mouseWheel', x: position.x, y: position.y,
                  deltaX: input.direction === 'left' ? -amount : input.direction === 'right' ? amount : 0,
                  deltaY: input.direction === 'up' ? -amount : input.direction === 'down' ? amount : 0 }, true);
              if (!(await this.call(ctx, receiptId, 'function() { return this.read(); }')).seen)
                throw error('outcome_unknown', 'Motion input not observed; never replay');
            } finally {
              this.cleanupRemote('Runtime.callFunctionOn', { objectId: receiptId, functionDeclaration: 'function() { this.cleanup(); }' });
              this.cleanupRemote('Runtime.releaseObject', { objectId: receiptId });
            }
          }
        }
        return { status: 'dispatched' as const, observed: true as const, pageGeneration: this.generation };
      };
      if ('ref' in input && input.ref) return this.withRef(ctx, input.ref, work);
      const world = await this.ensureIsolatedWorld(ctx);
      const result = await this.send(ctx, 'Runtime.evaluate', { expression: 'window', contextId: world.executionContextId, returnByValue: false }) as Json;
      const objectId = result.result?.objectId;
      if (!objectId || result.exceptionDetails) throw error('transport_error', 'Isolated viewport unavailable');
      try { return await work(objectId); }
      finally { this.cleanupRemote('Runtime.releaseObject', { objectId }); }
    });
  }

  async act(ref: string, action: 'click' | 'fill' | 'press', value = '', options: OperationOptions = {}): Promise<DispatchResult> {
    return this.run(action, options, async ctx => {
      if (!['click', 'fill', 'press'].includes(action)) throw error('invalid_request', 'Unsupported action');
      if (typeof value !== 'string' || exceedsCodePointLimit(value, MAX_FILL_TEXT_CODE_POINTS))
        throw error('invalid_request', 'Invalid action value');
      const key = action === 'press' ? keySpec(value) : undefined;
      const entry = this.refs.get(ref);
      if (!entry || entry.generation !== this.generation || entry.expiresAt <= this.now())
        throw error('stale_ref', 'Read a new snapshot before acting');
      if (entry.unsupported) throw error('unsupported_frame', 'Iframe actions are not implemented');
      ctx.refExpiresAt = entry.expiresAt;
      await this.checkCurrentUrl(ctx);
      await this.wait(ctx, this.options.ensureVisible());
      this.samePage(ctx);
      let objectId: string | undefined;
      let receiptId: string | undefined;
      let mainWindowId: string | undefined;
      try {
        const world = await this.ensureIsolatedWorld(ctx);
        try {
          const resolved = await this.send(ctx, 'DOM.resolveNode', { backendNodeId: entry.backendNodeId,
            executionContextId: world.executionContextId }) as Json;
          objectId = resolved.object?.objectId;
        } catch (cause) {
          const failure = knownError(cause);
          if (failure && (failure.code !== 'transport_error' || this.closed)) throw failure;
          throw error('stale_ref', 'Referenced DOM node is no longer resolvable');
        }
        if (!objectId) throw error('stale_ref', 'Referenced DOM node is missing');
        // AX frameId is optional on non-root nodes. Do not infer frame identity from absence:
        // Both objects are resolved into the same private MAIN-frame world. Never evaluate
        // in the default/page context, even when the isolated world is unavailable.
        const mainWindow = await this.send(ctx, 'Runtime.evaluate', { expression: 'window',
          contextId: world.executionContextId, returnByValue: false }) as Json;
        mainWindowId = mainWindow.result?.objectId;
        if (!mainWindowId || mainWindow.exceptionDetails)
          throw error('unsupported_frame', 'Could not establish isolated main-frame identity');
        let frameCheck: Json;
        try {
          frameCheck = await this.send(ctx, 'Runtime.callFunctionOn', {
            objectId, functionDeclaration: FRAME_IDENTITY,
            arguments: [{ objectId: mainWindowId }], returnByValue: true,
          }) as Json;
        } catch (cause) {
          // CDP refuses objects from different execution contexts, including same-process frames.
          if (knownError(cause)?.code === 'transport_error' && !this.closed)
            throw error('unsupported_frame', 'Element belongs to an unsupported frame context');
          throw cause;
        }
        if (frameCheck.exceptionDetails || frameCheck.result?.value !== true)
          throw error('unsupported_frame', 'Only main-frame elements are supported');
        const position = await this.call(ctx, objectId, INSPECT, [action]);
        this.pageResult(position);
        this.samePage(ctx);
        const receipt = await this.send(ctx, 'Runtime.callFunctionOn', {
          objectId, functionDeclaration: ARM_RECEIPT,
          arguments: [{ value: action }, { value: key?.key ?? '' }], returnByValue: false,
        }) as Json;
        receiptId = receipt.result?.objectId;
        if (!receiptId || receipt.exceptionDetails) throw error('not_actionable', 'Could not observe input delivery');
        if (this.options.focusTarget) {
          await this.wait(ctx, this.options.authorize(ctx.operation));
          await this.wait(ctx, this.options.ensureVisible());
          await this.wait(ctx, this.options.authorize(ctx.operation));
          this.check(ctx);
          this.samePage(ctx);
          if (ctx.refExpiresAt !== undefined && ctx.refExpiresAt <= this.now())
            throw error('stale_ref', 'Snapshot expired before guest focus');
          ctx.sideEffects = true;
          await this.wait(ctx, this.options.focusTarget());
        }
        if (action === 'click') {
          await this.send(ctx, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y,
            button: 'left', buttons: 1, clickCount: 1 }, true);
          await this.send(ctx, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y,
            button: 'left', buttons: 0, clickCount: 1 }, true);
        } else {
          // Focus emulation is guest-local; the host callback rejects unsupported hidden states.
          await this.send(ctx, 'Emulation.setFocusEmulationEnabled', { enabled: true }, true);
          await this.send(ctx, 'DOM.focus', { backendNodeId: entry.backendNodeId }, true);
          const focused = await this.call(ctx, objectId, CHECK_FOCUS);
          if (!focused.focused) throw error('not_actionable', 'Guest element did not receive focus');
          this.samePage(ctx);
          if (action === 'fill') {
            const selected = await this.call(ctx, objectId, SELECT_VALUE, [], true); this.pageResult(selected);
            if (selected.keyboardSelect) await this.dispatchKey(ctx, { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
            if (value) await this.send(ctx, 'Input.insertText', { text: value }, true);
            else await this.dispatchKey(ctx, keySpec('Backspace'));
          } else await this.dispatchKey(ctx, key!);
        }
        const observed = await this.call(ctx, receiptId, 'function() { return this.read(); }');
        if (!observed.seen || (action === 'fill' && observed.value !== value))
          throw error('outcome_unknown', 'CDP acknowledged input but the expected page receipt was not observed; do not replay');
        return { status: 'dispatched', observed: true, pageGeneration: this.generation };
      } finally {
        // Cleanup is non-blocking: stop/deadline must not wait on a broken transport.
        if (receiptId) {
          this.cleanupRemote('Runtime.callFunctionOn', { objectId: receiptId,
            functionDeclaration: 'function() { this.cleanup(); }' });
          this.cleanupRemote('Runtime.releaseObject', { objectId: receiptId });
        }
        if (objectId) this.cleanupRemote('Runtime.releaseObject', { objectId });
        if (mainWindowId) this.cleanupRemote('Runtime.releaseObject', { objectId: mainWindowId });
        // Restoration is not an agent command: it must survive hide/revocation/cancellation.
        // stop/dispose share this exact attempt even when it already failed synchronously.
        if (ctx.focusEmulationSent && !await this.resetFocusFor(ctx))
          throw error('transport_error', 'Focus-emulation restoration is unconfirmed; release and detach if repair cannot complete');
      }
    });
  }

  async navigate(url: string, options: OperationOptions = {}): Promise<DispatchResult> {
    return this.run('navigate', options, async ctx => {
      await this.permitUrl(ctx, url);
      await this.wait(ctx, this.options.ensureVisible());
      await this.initialize(ctx);
      ctx.allowNavigation = true;
      this.invalidate();
      const result = await this.send(ctx, 'Page.navigate', { url }, true) as Json;
      if (result.errorText === 'net::ERR_ABORTED') {
        // Not a failure to reach the server: a 204 / 205 response, a download, or a navigation
        // cancelled by another one. The request may have had its effect while no new document
        // committed, so this stays outcome_unknown (sideEffects is set): observe, never replay.
        this.invalidate();
        throw error('outcome_unknown', 'Navigation was aborted without a new page (e.g. a 204 response or a download); the request may have reached the server. Inspect the tab before deciding; never replay automatically.');
      }
      if (typeof result.errorText === 'string' && result.errorText) {
        // Only Page.navigate's own errorText proves the navigation ended in failure (not "no request
        // reached the server"); a lost reply or transport error stays outcome_unknown below. The raw
        // net:: diagnostics are not copied. Recovery is a new explicit navigation, never a replay.
        ctx.sideEffects = false;
        this.invalidate();
        throw error('navigation_failed', 'Navigation failed to load the page. No automatic retry was made; choose an allowed URL for a new explicit navigation.');
      }
      return { status: 'dispatched', pageGeneration: this.generation };
    });
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    return this.run('screenshot', options, async ctx => {
      if (options.ref !== undefined && (typeof options.ref !== 'string' || !options.ref || options.ref.length > 256))
        throw error('invalid_request', 'Invalid screenshot ref');
      if (options.format !== undefined && options.format !== 'png' && options.format !== 'jpeg' ||
        options.quality !== undefined && (options.format !== 'jpeg' || !Number.isInteger(options.quality) || options.quality < 0 || options.quality > 100))
        throw error('invalid_request', 'Invalid screenshot encoding');
      await this.initialize(ctx);
      await this.checkCurrentUrl(ctx);
      const viewport = await this.viewport(ctx);
      let captureRect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
      if (options.ref) captureRect = await this.withRef(ctx, options.ref, async objectId => {
        const result = await this.call(ctx, objectId, INSPECT, ['screenshot']); this.pageResult(result);
        if (!result.rect || !validRect(result.rect)) throw error('not_actionable', 'Element has no visible screenshot rectangle');
        return result.rect;
      });
      const formats = options.format === 'jpeg' ? ['jpeg'] as const : ['png', 'jpeg'] as const;
      for (const format of formats) {
        const result = await this.send(ctx, 'Page.captureScreenshot', { format, fromSurface: true,
          captureBeyondViewport: false, ...(format === 'jpeg' ? { quality: options.format === 'jpeg' ? options.quality ?? 60 : 60 } : {}),
          ...(options.ref ? { clip: { ...captureRect, x: captureRect.x + viewport.pageX, y: captureRect.y + viewport.pageY, scale: 1 } } : {}) }) as Json;
        this.samePage(ctx);
        if (typeof result.data !== 'string' || !result.data) throw error('transport_error', 'Missing screenshot data');
        if (result.data.length <= MAX_SCREENSHOT_BASE64_LENGTH) {
          const dimensions = imageDimensions(result.data, format);
          return { mimeType: format === 'png' ? 'image/png' : 'image/jpeg', data: result.data, pageGeneration: this.generation,
            viewport: { width: viewport.width, height: viewport.height }, captureRect,
            imageScale: { x: dimensions.width / captureRect.width, y: dimensions.height / captureRect.height } };
        }
      }
      throw error('message_too_large', 'Viewport screenshot exceeds the image limit after JPEG compression');
    });
  }

  /** Immediate, terminal revocation. Host separately detaches debugger / releases its lease. */
  stop(): void {
    this.stopped = true;
    this.invalidate();
    this.active?.controller.abort(error('cancelled', 'Stopped by owner'));
    if (!this.terminalFocusReset)
      this.terminalFocusReset = this.active ? this.resetFocusFor(this.active) : this.resetFocusEmulation();
    // The restoration promise never rejects. stop/dispose remain synchronous and nonblocking.
    void this.terminalFocusReset;
  }
  dispose(): void {
    this.stop();
    this.closed = true;
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
  }

  private allocateGeneration(): void {
    if (this.generationFailure) throw this.generationFailure;
    try {
      const next = this.options.nextPageGeneration();
      if (!Number.isSafeInteger(next) || next <= 0 || next <= this.generation)
        throw new Error('Non-monotonic or invalid page generation');
      this.generation = next;
    } catch {
      this.refs.clear();
      this.closed = true;
      this.generationFailure = error('transport_error', 'Host page-generation allocator failed; recreate the guest binding');
      this.active?.controller.abort(this.generationFailure);
      throw this.generationFailure;
    }
  }
  private invalidate(): void {
    this.refs.clear();
    this.dialogPolicy = undefined;
    this.isolatedWorld = undefined;
    // EventEmitter callbacks and stop/dispose must not throw into the host. The terminal failure
    // instead aborts in-flight work and rejects future calls (and pageGeneration reads).
    try { this.allocateGeneration(); } catch { /* allocator has already failed closed */ }
  }
  private onEvent(event: CdpEvent): void {
    const params = event.params as Json | undefined;
    if (event.method === 'Page.javascriptDialogOpening') {
      const policy = this.dialogPolicy; this.dialogPolicy = undefined;
      void this.handleDialog(policy); return;
    }
    if (event.method === 'Page.frameNavigated' && params?.frame && !params.frame.parentId) {
      this.rootFrame = params.frame.id;
      this.currentUrl = params.frame.url;
      this.invalidate();
    } else if ((event.method === 'Page.navigatedWithinDocument' || event.method === 'Page.frameStartedLoading') &&
      params?.frameId === this.rootFrame) {
      if (typeof params.url === 'string') this.currentUrl = params.url;
      this.invalidate();
    } else if (event.method === 'DOM.documentUpdated' || event.method === 'Runtime.executionContextsCleared') {
      this.invalidate();
    } else if (event.method === 'Runtime.executionContextDestroyed') {
      // A world can disappear without a main-frame navigation (e.g. context replacement).
      // Remember destruction racing createIsolatedWorld's acknowledgement as well.
      if (Number.isSafeInteger(params?.executionContextId)) {
        this.worldCreationDestroyedContexts?.add(params!.executionContextId);
        if (params!.executionContextId === this.isolatedWorld?.executionContextId) this.invalidate();
      }
    } else if (event.method === 'Page.frameDetached') {
      for (const [ref, entry] of this.refs) if (entry.frameId === params?.frameId) this.refs.delete(ref);
      if (params?.frameId === this.rootFrame) this.invalidate();
    }
  }

  private async initialize(ctx: Active): Promise<void> {
    if (this.initialized) return;
    await this.send(ctx, 'Page.enable');
    await this.send(ctx, 'DOM.enable');
    await this.send(ctx, 'Runtime.enable');
    // Enabling Runtime can emit the initial execution-context events, before any refs exist.
    ctx.generation = this.generation;
    this.initialized = true;
  }
  private async checkCurrentUrl(ctx: Active): Promise<void> {
    const tree = await this.send(ctx, 'Page.getFrameTree') as Json;
    if (!tree.frameTree?.frame?.id || typeof tree.frameTree.frame.url !== 'string')
      throw error('transport_error', 'Missing main frame');
    if (this.rootFrame && this.rootFrame !== tree.frameTree.frame.id) this.invalidate();
    this.rootFrame = tree.frameTree.frame.id;
    this.currentUrl = tree.frameTree.frame.url;
    // Chromium's main-frame error document after a failed load: say so without reading it or
    // admitting its scheme to the URL policy (authorization already ran in run()).
    if (this.currentUrl === CHROME_ERROR_URL)
      throw error('navigation_failed', 'The page failed to load and Chromium is showing an unreadable error document. Choose an allowed URL for a new explicit navigation; this is not a request to regrant control.');
    await this.permitUrl(ctx, this.currentUrl);
    this.samePage(ctx);
  }
  private async ensureIsolatedWorld(ctx: Active): Promise<IsolatedWorld> {
    this.samePage(ctx);
    const cached = this.isolatedWorld;
    if (cached && cached.generation === this.generation && cached.frameId === this.rootFrame) return cached;
    if (!this.rootFrame) throw error('unsupported_frame', 'Main frame is unavailable');
    const destroyed = this.worldCreationDestroyedContexts = new Set<number>();
    try {
      const result = await this.send(ctx, 'Page.createIsolatedWorld', {
        frameId: this.rootFrame, worldName: `cutex-browser-${this.refNamespace}`,
        // CDP's public parameter is intentionally spelled "Univeral". Do not enable
        // universal access: frame restrictions are not relaxed by this private world.
        grantUniveralAccess: false,
      }) as Json;
      this.samePage(ctx);
      const executionContextId = result.executionContextId;
      if (!Number.isSafeInteger(executionContextId) || executionContextId <= 0)
        throw error('transport_error', 'Isolated execution context was not established');
      if (destroyed.has(executionContextId)) {
        this.invalidate();
        throw error('stale_ref', 'Isolated execution context was destroyed during creation');
      }
      const world = { frameId: this.rootFrame, generation: this.generation, executionContextId };
      this.isolatedWorld = world;
      return world;
    } finally {
      if (this.worldCreationDestroyedContexts === destroyed) this.worldCreationDestroyedContexts = undefined;
    }
  }
  private async withRef<T>(ctx: Active, ref: string, work: (objectId: string) => Promise<T>): Promise<T> {
    const entry = this.refs.get(ref);
    if (!entry || entry.generation !== this.generation || entry.expiresAt <= this.now()) throw error('stale_ref', 'Read a fresh ref');
    if (entry.unsupported) throw error('unsupported_frame', 'Only main-frame elements are supported');
    ctx.refExpiresAt = entry.expiresAt;
    const world = await this.ensureIsolatedWorld(ctx);
    let objectId: string | undefined, windowId: string | undefined;
    try {
      let node: Json;
      try { node = await this.send(ctx, 'DOM.resolveNode', { backendNodeId: entry.backendNodeId, executionContextId: world.executionContextId }) as Json; }
      catch (cause) {
        if (knownError(cause)?.code === 'transport_error' && !this.closed) throw error('stale_ref', 'Referenced DOM node is no longer resolvable');
        throw cause;
      }
      objectId = node.object?.objectId;
      if (!objectId) throw error('stale_ref', 'Referenced node no longer exists');
      const result = await this.send(ctx, 'Runtime.evaluate', { expression: 'window', contextId: world.executionContextId, returnByValue: false }) as Json;
      windowId = result.result?.objectId;
      if (!windowId || result.exceptionDetails) throw error('unsupported_frame', 'Main-frame identity unavailable');
      let identity: Json;
      try { identity = await this.send(ctx, 'Runtime.callFunctionOn', { objectId, functionDeclaration: FRAME_IDENTITY, arguments: [{ objectId: windowId }], returnByValue: true }) as Json; }
      catch (cause) {
        if (knownError(cause)?.code === 'transport_error' && !this.closed) throw error('unsupported_frame', 'Ref belongs to an unsupported frame context');
        throw cause;
      }
      if (identity.exceptionDetails || identity.result?.value !== true) throw error('unsupported_frame', 'Referenced node is not in the main frame');
      return await work(objectId);
    } finally {
      if (objectId) this.cleanupRemote('Runtime.releaseObject', { objectId });
      if (windowId) this.cleanupRemote('Runtime.releaseObject', { objectId: windowId });
    }
  }
  private async viewport(ctx: Active): Promise<{ width: number; height: number; x: number; y: number; pageX: number; pageY: number }> {
    const metrics = await this.send(ctx, 'Page.getLayoutMetrics') as Json;
    const view = metrics.cssVisualViewport;
    if (!view || !Number.isFinite(view.clientWidth) || !Number.isFinite(view.clientHeight) || view.clientWidth <= 0 || view.clientHeight <= 0)
      throw error('transport_error', 'CSS viewport metrics unavailable');
    return { width: view.clientWidth, height: view.clientHeight, x: view.clientWidth / 2, y: view.clientHeight / 2,
      pageX: Number.isFinite(view.pageX) ? view.pageX : 0, pageY: Number.isFinite(view.pageY) ? view.pageY : 0 };
  }
  private async waitCondition(ctx: Active, condition: Extract<BrowserAction, { kind: 'wait' }>['condition']): Promise<DispatchResult> {
    ctx.allowNavigation = true;
    if (condition.kind === 'url') await this.permitUrl(ctx, condition.url);
    for (;;) {
      this.check(ctx); ctx.generation = this.generation;
      try {
        await this.checkCurrentUrl(ctx);
        let matched = condition.kind === 'url' && this.currentUrl === condition.url;
        if (condition.kind === 'element') matched = (await this.snapshotFor(ctx, condition.query)).nodes.length > 0;
        if (condition.kind === 'load') {
          const world = await this.ensureIsolatedWorld(ctx);
          const reply = await this.send(ctx, 'Runtime.evaluate', { expression: 'document.readyState', contextId: world.executionContextId, returnByValue: true }) as Json;
          this.samePage(ctx);
          if (reply.exceptionDetails) throw error('transport_error', 'Load state unavailable');
          matched = condition.state === 'load' ? reply.result?.value === 'complete' : ['interactive', 'complete'].includes(reply.result?.value);
        }
        if (matched) return { status: 'dispatched', observed: true, pageGeneration: this.generation };
      } catch (cause) {
        // Read-only condition polling may cross navigation. No action/ref is replayed.
        if (knownError(cause)?.code !== 'stale_ref') throw cause;
      }
      await this.wait(ctx, new Promise<void>(resolve => setTimeout(resolve, 50)));
    }
  }
  private async handleDialog(policy: BrowserCdpExecutor['dialogPolicy']): Promise<void> {
    let decided = false;
    const dismiss = () => { if (!decided) { decided = true; this.cleanupRemote('Page.handleJavaScriptDialog', { accept: false }); } };
    if (!policy) { dismiss(); return; }
    const timer = setTimeout(dismiss, 1000);
    try {
      await this.options.authorize('dialog'); await this.options.ensureVisible(); await this.options.authorize('dialog');
      if (decided) return;
      if (this.closed || this.stopped || policy.generation !== this.generation || policy.expiresAt <= this.now()) { dismiss(); return; }
      // A dialog handled during an action belongs to that action's uncertain-effects fence.
      const ctx = this.active;
      if (ctx) { this.check(ctx); ctx.sideEffects = true; }
      decided = true;
      try { await this.transport.send('Page.handleJavaScriptDialog', { accept: policy.response === 'accept', ...(policy.promptText !== undefined ? { promptText: policy.promptText } : {}) }); }
      catch {
        this.invalidate(); ctx?.controller.abort(error('outcome_unknown', 'Dialog response delivery is unconfirmed; never replay'));
      }
    } catch { dismiss(); }
    finally { clearTimeout(timer); }
  }
  private async permitUrl(ctx: Active, url: string): Promise<void> {
    if (!isBrowserUrl(url)) throw error('permission_denied', 'Target URL syntax or scheme is not allowed');
    if (!await this.wait(ctx, this.options.allowUrl(url))) throw error('permission_denied', 'Target URL is not allowed');
  }
  private samePage(ctx: Active): void {
    if (ctx.generation !== this.generation) throw error('stale_ref', 'Page changed during operation');
  }
  private pageResult(result: Json): void {
    if (result.error === 'stale_ref' || result.error === 'unsupported_frame' || result.error === 'not_actionable')
      throw error(result.error, 'Element precondition failed');
  }
  private async call(ctx: Active, objectId: string, functionDeclaration: string, args: unknown[] = [], sideEffect = false): Promise<Json> {
    const reply = await this.send(ctx, 'Runtime.callFunctionOn', { objectId, functionDeclaration,
      arguments: args.map(value => ({ value })), returnByValue: true }, sideEffect) as Json;
    if (reply.exceptionDetails || !reply.result || typeof reply.result.value !== 'object' || !reply.result.value)
      throw error('not_actionable', 'Page inspection failed');
    return reply.result.value;
  }
  private async dispatchKey(ctx: Active, spec: KeySpec): Promise<void> {
    await this.send(ctx, 'Input.dispatchKeyEvent', { ...spec, type: 'keyDown' }, true);
    const { text: _text, ...up } = spec;
    await this.send(ctx, 'Input.dispatchKeyEvent', { ...up, type: 'keyUp' }, true);
  }
  private cleanupRemote(method: string, params: Record<string, unknown>): void {
    try { void Promise.resolve(this.transport.send(method, params)).catch(() => {}); }
    catch { /* A synchronous adapter throw must not skip focus restoration. */ }
  }
  private resetFocusFor(ctx: Active): Promise<boolean> {
    return ctx.focusResetAttempt ??= this.resetFocusEmulation();
  }
  /** Restore only, bypassing all agent gates. Never rejects or starts concurrent reset commands. */
  private resetFocusEmulation(): Promise<boolean> {
    if (this.focusResetFlight) return this.focusResetFlight.wait;
    if (!this.focusEmulationDirty) return Promise.resolve(true);
    let resolveWait!: (success: boolean) => void;
    const wait = new Promise<boolean>(resolve => { resolveWait = resolve; });
    const flight: FocusResetFlight = { wait, pending: true, timedOut: false };
    // Reserve single-flight BEFORE transport.send: adapters may invoke stop synchronously.
    this.focusResetFlight = flight;
    const timer = setTimeout(() => {
      flight.timedOut = true;
      resolveWait(false);
      // Keep the unresolved transport tracked: a late reset must not race a later enable.
    }, FOCUS_RESET_TIMEOUT_MS);
    const settle = (success: boolean) => {
      flight.pending = false;
      clearTimeout(timer);
      if (this.focusResetFlight === flight) {
        this.focusResetFlight = undefined;
        // A timed-out attempt stays dirty even if a late acknowledgement arrives; require a
        // fresh, confirmed repair on the next run after this old transport command settles.
        if (success && !flight.timedOut) this.focusEmulationDirty = false;
      }
      resolveWait(success && !flight.timedOut);
    };
    try {
      const sent = this.transport.send('Emulation.setFocusEmulationEnabled', { enabled: false });
      void Promise.resolve(sent).then(() => settle(true), () => settle(false));
    } catch { settle(false); }
    return wait;
  }
  private async send(ctx: Active, method: string, params: Record<string, unknown> = {}, sideEffect = false): Promise<unknown> {
    await this.wait(ctx, this.options.authorize(ctx.operation));
    if (sideEffect || method === 'Page.captureScreenshot') {
      await this.wait(ctx, this.options.ensureVisible());
      await this.wait(ctx, this.options.authorize(ctx.operation));
    }
    this.check(ctx);
    if (!ctx.allowNavigation) this.samePage(ctx);
    if ((sideEffect || method === 'Page.captureScreenshot') && ctx.refExpiresAt !== undefined && ctx.refExpiresAt <= this.now())
      throw error('stale_ref', 'Snapshot expired before input dispatch');
    if (sideEffect) ctx.sideEffects = true; // Set BEFORE send: rejection can mean a lost acknowledgement.
    if (method === 'Emulation.setFocusEmulationEnabled' && params.enabled === true) {
      ctx.focusEmulationSent = true;
      this.focusEmulationDirty = true; // BEFORE dispatch, including a synchronous throw/lost ack.
    }
    try { return await this.wait(ctx, this.transport.send(method, params)); }
    catch (cause) {
      const failure = knownError(cause);
      if (failure) throw failure;
      if (ctx.operation === 'wait' && ctx.generation !== this.generation)
        throw error('stale_ref', 'Navigation replaced the context while observing a condition');
      throw error('transport_error', `CDP ${method} failed`);
    }
  }
  private check(ctx: Active): void {
    if (this.generationFailure) throw this.generationFailure;
    if (ctx.controller.signal.aborted) throw ctx.controller.signal.reason;
    if (this.closed) throw error('target_closed', 'Executor is closed');
    if (this.stopped) throw error('cancelled', 'Executor was stopped');
    if (this.now() >= ctx.deadline) throw error('deadline_exceeded', 'Command deadline expired');
  }
  private async wait<T>(ctx: Active, value: T | Promise<T>): Promise<T> {
    // A synchronous transport callback can abort the context and return a rejected promise.
    // Observe that promise before check() throws, avoiding an orphaned rejection on stop.
    const pendingValue = Promise.resolve(value);
    void pendingValue.catch(() => {});
    this.check(ctx);
    const signal = ctx.controller.signal;
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([pendingValue, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]);
    } finally { signal.removeEventListener('abort', onAbort); }
  }
  private async run<T>(operation: ExecutorOperation, options: OperationOptions, body: (ctx: Active) => Promise<T>): Promise<T> {
    if (this.generationFailure) throw this.generationFailure;
    if (this.closed) throw error('target_closed', 'Executor is closed');
    if (this.stopped) throw error('cancelled', 'Executor was stopped');
    if (this.active) throw error('busy', 'One command per guest is allowed');
    const remaining = (options.deadline ?? (this.now() + (this.options.defaultTimeoutMs ?? 10_000))) - this.now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw error('deadline_exceeded', 'Command deadline expired');
    if (options.signal?.aborted) throw error('cancelled', 'Command cancelled before dispatch');
    const ctx: Active = { operation, controller: new AbortController(), sideEffects: false, generation: this.generation, deadline: this.now() + remaining };
    this.active = ctx;
    const abort = () => ctx.controller.abort(error('cancelled', 'Command cancelled'));
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => ctx.controller.abort(error('deadline_exceeded', 'Command deadline expired')), Math.min(remaining, 2_147_483_647));
    try {
      // Restoration is serialized ahead of authorization and all ordinary work. Its short wait
      // is independent of this operation's deadline/abort; no agent input occurs during repair.
      if (!await this.resetFocusEmulation())
        throw error('transport_error', 'Focus-emulation cleanup is unresolved; release and detach the debugger');
      this.check(ctx);
      await this.wait(ctx, this.options.authorize(operation));
      const result = await body(ctx);
      this.check(ctx);
      return result;
    } catch (cause) {
      if (ctx.sideEffects) {
        this.invalidate();
        if (cause instanceof ProtocolError && cause.code === 'outcome_unknown') throw cause;
        throw error('outcome_unknown', 'Command may have had side effects; inspect before retrying and never replay automatically');
      }
      const failure = knownError(cause);
      if (failure) throw failure;
      throw error('transport_error', 'Browser operation failed');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (this.active === ctx) this.active = undefined;
    }
  }
}

type KeySpec = { key: string; code: string; windowsVirtualKeyCode: number; text?: string; modifiers?: number };
function matchesQuery(node: Json, query: BrowserFindQuery): boolean {
  const match = (actual: string, expected: string) => query.exact ? actual === expected : actual.toLowerCase().includes(expected.toLowerCase());
  const name = String(node.name?.value ?? '');
  // Never search AX values: password-bearing controls are DOM-redacted separately.
  return 'role' in query ? String(node.role?.value ?? '') === query.role && (query.name === undefined || match(name, query.name)) : match(name, query.text);
}
function validRect(rect: Json): boolean {
  return ['x','y','width','height'].every(key => Number.isFinite(rect[key])) && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0;
}
function keySpec(key: string): KeySpec {
  const keys: Record<string, KeySpec> = {
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  };
  if (!keys[key]) throw error('invalid_request', 'Unsupported key; I1 supports Enter, Tab, Backspace, Escape and arrow keys');
  return keys[key]!;
}
