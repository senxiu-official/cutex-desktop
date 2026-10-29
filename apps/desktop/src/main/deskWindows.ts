// Desk windows ("second desk", multi-window P1; .claude/previews/multi-window/proposal.md): extra app
// windows that show part of the app on another display. They are same-origin `about:blank` children the
// main window's renderer opens with window.open and draws into (one shared renderer: one store, one feed
// per session). They have no preload / bridge of their own; every IPC still comes from the main window.
//
// Main decides which child windows exist: the renderer first asks for a ticket (WINDOW_CHANNEL "desk"),
// main answers with a one-use window name; setWindowOpenHandler admits only `about:blank` from the main
// window's main frame with that name, once, within NONCE_TTL_MS. Everything that targets a desk later
// (window controls, frame owner group, dialog parents) names it by desk id and is checked against this
// registry: a desk id is only honoured for the main window that opened it and while that window lives.
// Opaque frame documents (agent pages, HTML files; P4) are leased to the one webContents they are drawn
// in: main resolves the desk at prepare time (`placeFor`) and every later check uses that webContents.
//
// The 多窗口 setting is main-owned (desktop-prefs.json, docs/desktop-modules.md §24.17): while it is off no ticket is
// issued and no outstanding one admitted, whatever the renderer asks. Desks already open stay until closed.
//
// This file is the pure registry (no Electron imports; unit-tested); main/index.ts wires the windows.
import { randomBytes } from "node:crypto";

/** The window name prefix of an admitted desk window (followed by the one-use nonce). */
export const DESK_NAME_PREFIX = "cutex-desk-";
/** A desk id: stable across restarts (its bounds are remembered under it). */
export const DESK_ID = /^d[0-9a-f]{12}$/;
/** A ticket not used by window.open within this long is void. */
export const NONCE_TTL_MS = 10_000;
/** At most this many desk windows at once (and pending tickets). */
export const MAX_DESKS = 4;

export const isDeskId = (value: unknown): value is string => typeof value === "string" && DESK_ID.test(value);

export interface DeskTicket {
  deskId: string;
  /** The window.open target name; good for one window.open. */
  name: string;
}

interface Pending {
  deskId: string;
  ownerId: number;
  expires: number;
}

export interface DeskEntry<W> {
  deskId: string;
  /** The main window's webContents id (the renderer that opened and draws the desk). */
  ownerId: number;
  /** The desk window's own webContents id (frames inside it load with this id). */
  contentsId: number;
  window: W;
}

export interface OpenRequest {
  url: string;
  frameName: string;
  /** The webContents that called window.open. Electron does not say which frame: the nonce is the authority
   *  (only the main frame gets tickets, isAppSender; opaque frames are sandboxed without allow-popups). */
  openerId: number;
}

export class DeskRegistry<W> {
  private readonly pending = new Map<string, Pending>();
  /** Admitted by setWindowOpenHandler, not yet created (did-create-window follows at once). */
  private readonly admitted = new Map<string, { deskId: string; ownerId: number }>();
  private readonly desks = new Map<string, DeskEntry<W>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly random: (bytes: number) => string = (bytes) => randomBytes(bytes).toString("hex"),
    /** The 多窗口 setting (main/deskShell wires it to main's prefs). */
    private readonly enabled: () => boolean = () => true,
  ) {}

  /**
   * A ticket for one window.open by `ownerId` (the main window's webContents). `requested` reopens a
   * remembered desk under its id (bounds memory); an unknown format or an id already open gets a new id.
   * Null when 多窗口 is off or too many desks are open or pending.
   */
  issue(ownerId: number, requested?: unknown): DeskTicket | null {
    this.sweep();
    if (!this.enabled()) return null;
    if (this.desks.size + this.pending.size + this.admitted.size >= MAX_DESKS) return null;
    const taken = (id: string) => this.desks.has(id) || [...this.pending.values(), ...this.admitted.values()].some((p) => p.deskId === id);
    let deskId = isDeskId(requested) && !taken(requested) ? requested : "";
    while (!deskId || taken(deskId)) deskId = `d${this.random(6)}`;
    const nonce = this.random(16);
    this.pending.set(nonce, { deskId, ownerId, expires: this.now() + NONCE_TTL_MS });
    return { deskId, name: `${DESK_NAME_PREFIX}${nonce}` };
  }

  /** setWindowOpenHandler: the desk id this window.open may create (the ticket is used up), else null (also: 多窗口 off). */
  admit(request: OpenRequest): string | null {
    this.sweep();
    if (!this.enabled()) return null;
    if (request.url !== "about:blank" || !request.frameName.startsWith(DESK_NAME_PREFIX)) return null;
    const nonce = request.frameName.slice(DESK_NAME_PREFIX.length);
    const ticket = this.pending.get(nonce);
    if (!ticket || ticket.ownerId !== request.openerId) return null;
    this.pending.delete(nonce);
    this.admitted.set(request.frameName, { deskId: ticket.deskId, ownerId: ticket.ownerId });
    return ticket.deskId;
  }

  /** did-create-window: bind the admitted name to its window. Null (= destroy it) for a window main did not admit. */
  register(frameName: string, ownerId: number, window: W, contentsId: number): DeskEntry<W> | null {
    const admitted = this.admitted.get(frameName);
    this.admitted.delete(frameName);
    if (!admitted || admitted.ownerId !== ownerId || this.desks.has(admitted.deskId)) return null;
    const entry = { deskId: admitted.deskId, ownerId, contentsId, window };
    this.desks.set(entry.deskId, entry);
    return entry;
  }

  /** The window closed: forget it. */
  remove(deskId: string): DeskEntry<W> | null {
    const entry = this.desks.get(deskId) ?? null;
    this.desks.delete(deskId);
    return entry;
  }

  /** A desk named by the renderer `senderId`: only one that renderer opened and that is still open. */
  resolve(senderId: number, deskId: unknown): DeskEntry<W> | null {
    if (!isDeskId(deskId)) return null;
    const entry = this.desks.get(deskId);
    return entry && entry.ownerId === senderId ? entry : null;
  }

  /** The desk whose window has this webContents id, if any. */
  byContents(contentsId: number): DeskEntry<W> | null {
    for (const entry of this.desks.values()) if (entry.contentsId === contentsId) return entry;
    return null;
  }

  /**
   * Where `senderId` (the main window's renderer) may draw an opaque frame it prepares (multi-window P4):
   * its own webContents, or, with a desk id, the webContents of a desk it opened that is still open. The
   * document lease is bound to that one webContents, never to the whole group; null = no such desk.
   */
  placeFor(senderId: number, deskId: unknown): number | null {
    if (deskId === undefined) return senderId;
    return this.resolve(senderId, deskId)?.contentsId ?? null;
  }

  /**
   * The webContents a frame request comes from, if it may hold opaque frames at all: the main window itself
   * or one of its registered, open desks (frame owner group); else null. The request is then checked against
   * that webContents' own leases (a desk never loads the main window's documents or another desk's).
   */
  frameHostOf(contentsId: number, mainId: number | null): number | null {
    if (mainId === null) return null;
    if (contentsId === mainId) return mainId;
    const desk = this.byContents(contentsId);
    return desk && desk.ownerId === mainId ? desk.contentsId : null;
  }

  list(): DeskEntry<W>[] {
    return [...this.desks.values()];
  }

  get size(): number {
    return this.desks.size;
  }

  private sweep(): void {
    const t = this.now();
    for (const [nonce, p] of this.pending) if (p.expires < t) this.pending.delete(nonce);
  }
}

/**
 * session.webRequest for an opaque frame document (cutex-plugin:): only as a sub-frame, only in the main
 * window or one of its registered desks, and only a URL that is one of the live one-use documents leased to
 * that very webContents (multi-window P4: a document prepared for the main window is not served to a desk,
 * nor one desk's to another). A frame URL is not authority to fetch it from another window, the parent, or
 * a worker.
 */
export function frameRequestAllowed<W>(
  request: { resourceType: string; webContentsId?: number; url: string },
  mainId: number | null,
  registry: Pick<DeskRegistry<W>, "frameHostOf">,
  ownsUrl: (url: string, place: number) => boolean,
): boolean {
  if (request.resourceType !== "subFrame" || mainId === null || request.webContentsId === undefined) return false;
  const place = registry.frameHostOf(request.webContentsId, mainId);
  return place !== null && ownsUrl(request.url, place);
}

/**
 * The parent window of main's native confirm for an agent page (channel B): the window the frame was prepared
 * for (`place`, bound by main at prepare time via `placeFor`; nothing the renderer names at submit time). That
 * is the owner's own window, or a desk the owner opened that is still open; null otherwise (the dialog is not
 * shown, the page hears `unavailable`).
 */
export function confirmParent<W>(ownerId: number, place: number, registry: Pick<DeskRegistry<W>, "byContents">, ownerWindow: (ownerId: number) => W | null): W | null {
  if (place === ownerId) return ownerWindow(ownerId);
  const desk = registry.byContents(place);
  return desk && desk.ownerId === ownerId ? desk.window : null;
}
