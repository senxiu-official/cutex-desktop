// E1: BrowserPasswordService (contract: ../identity/contract.ts) on top of a BrowserPasswordStore.
//   capture  In an owner tab no agent holds, when the owner presses Enter in a login field or releases the mouse on a
//            form's button, a fixed isolated-world script reads that form's user name and password. The value stays
//            in main (a Buffer) and becomes a 「要保存吗」 prompt only after the login looks successful: the main frame
//            moved to a new document, or the password field disappeared within 30 s. Never in a tab granted to an
//            agent (from the lease request until it is taken back), never for 「从不保存」 sites.
//   offer    The owner's click into a login field of such a tab → the logins saved for exactly this origin (user names
//            only) and the field's position; the app draws the list there. A granted tab gets `grantedTo` instead
//            (the UI offers 收回并填写); fill() refuses there.
//   fill     After a fresh owner gesture on the app window and the store's Windows Hello check: re-check the tab,
//            the document and the origin, then one isolated-world step per field re-checks the frame origin and the
//            focus and inserts the text (no page script can run in between). Never auto-fill on load.
//   reveal   Main's own native dialog after Windows Hello; copy: main's clipboard, cleared after 30 s if unchanged,
//            and Windows Hello every time (also within the grace). Show, copy and fill each need a fresh native owner
//            gesture on an app window: renderer code alone (a module runs with app trust) can start none of them.
// The password never reaches the renderer, a page outside its own form, an agent or a log.
import { createHash, randomBytes } from "node:crypto";
import type { BrowserWindow, WebContents } from "electron";
import {
  DEFAULT_BROWSER_IDENTITY_PREFS, type BrowserFillOfferView, type BrowserIdentityEvent, type BrowserIdentityPrefs, type BrowserPasswordPromptChoice,
  type BrowserPasswordPromptView, type BrowserPasswordStoreStatus,
} from "../../../shared/browserIdentity";
import type { BrowserPasswordService } from "../identity/contract";
import { browserLoginOrigin } from "../loginWarning";
import { FIELD_SCRIPT, FORM_SCRIPT, GONE_SCRIPT, PASSWORD_WORLD, fillScript, parseFieldProbe, parseSubmitProbe, submitScript } from "./pageScripts";
import type { BrowserPasswordStoreImpl } from "./store";

export const PENDING_MS = 60_000;
export const GONE_WATCH_MS = 30_000;
/** After the main frame committed a new document: a usable password field still there this long → a failed login. */
export const AFTER_COMMIT_MS = 3_000;
export const PROMPT_MS = 5 * 60_000;
export const USERNAME_STEP_MS = 5 * 60_000;
export const CLIPBOARD_CLEAR_MS = 30_000;
const GONE_POLL_MS = 1_000;

type Guest = Pick<WebContents, "executeJavaScriptInIsolatedWorld" | "getURL" | "focus" | "isDestroyed" | "on" | "removeListener">;

/** One owner-side tab, as install.ts sees it. Every getter is read again at each step. */
export interface PasswordTab {
  hostId: string;
  tabKey: string;
  guestId: string;
  guest: Guest;
  /** The tab's 浏览器身份, or null when it is not an owner identity tab (agent pool, service page, gone). */
  identityId(): string | null;
  /** Any lease on the tab (requested, active or paused): no capture, no fill. */
  grantedTo(): { agentName: string } | null;
  /** The input being handled is the owner's (not attributed to an agent's dispatch). */
  ownerInput(): boolean;
  /** Still this guest, module on, not disposed. */
  live(): boolean;
  /** Bumps on every main-frame document change (install.ts TabData.documentEpoch). */
  documentEpoch(): number;
  window(): BrowserWindow | null;
}

export interface PasswordServiceDeps {
  store: BrowserPasswordStoreImpl;
  emit(event: BrowserIdentityEvent): void;
  prefs(): Promise<BrowserIdentityPrefs>;
  ownerWindow(): BrowserWindow | null;
  /** A fresh native owner gesture on an app window, observed by main (./gesture), used up by this call; null: none. */
  ownerGesture(): { window: BrowserWindow | null } | null;
  /** prefs.passwordHelloGrace changed (the store's graceEnabled follows it). */
  graceChanged?(on: boolean): void;
  clipboard: { writeText(text: string): void | Promise<void>; readText(): string | Promise<string>; clear(): void | Promise<void> };
  /** Main's native dialog with the password (settings 「显示」). */
  showSecret(window: BrowserWindow | null, login: { origin: string; username: string }, password: string): Promise<void>;
  now?(): number;
  timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
}

interface Pending { tab: PasswordTab; identityId: string; origin: string; username: string; secret: Buffer; commits: number; started: number; committedAt?: number; timer: unknown; poll?: unknown; prompt?: BrowserPasswordPromptView }
interface Offer { view: BrowserFillOfferView; tab: PasswordTab; epoch: number; url: string }

const fail = (code: string): never => { throw new Error(code); };
const run = async (guest: Guest, code: string): Promise<unknown> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      guest.executeJavaScriptInIsolatedWorld(PASSWORD_WORLD, [{ code }], false),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1500); timer.unref?.(); }),
    ]);
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
};

export function createBrowserPasswordService(deps: PasswordServiceDeps): BrowserPasswordService & { attach(tab: PasswordTab): () => void; dispose(): void; lock(): void } {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? { set: (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const pendings = new Map<string, Pending>(); // guestId →
  const prompts = new Map<string, Pending>(); // promptId →
  const offers = new Map<string, Offer>(); // offerId →
  const usernameSteps = new Map<string, { origin: string; username: string; at: number }>(); // guestId →
  const recentFills = new Map<string, { origin: string; username: string; at: number }>(); // guestId →
  const commits = new Map<string, number>(); // guestId → main-frame commits (did-navigate, main-frame in-page)
  const commitsOf = (guestId: string) => commits.get(guestId) ?? 0;
  let prefs: BrowserIdentityPrefs = DEFAULT_BROWSER_IDENTITY_PREFS;
  let clipboardTimer: unknown;

  const readPrefs = async () => {
    try { prefs = await deps.prefs(); } catch { /* package A missing: defaults */ }
    if (!prefs.passwordHelloGrace) deps.store.lock();
    return prefs;
  };
  const passwordsChanged = (identityId: string) => deps.emit({ kind: "passwords", identityId });

  function dropPending(p: Pending): void {
    timers.clear(p.timer);
    if (p.poll) timers.clear(p.poll);
    p.secret.fill(0);
    if (pendings.get(p.tab.guestId) === p) pendings.delete(p.tab.guestId);
    if (p.prompt) {
      prompts.delete(p.prompt.promptId);
      deps.emit({ kind: "passwordPromptClosed", promptId: p.prompt.promptId });
    }
  }
  function closeOffer(offerId: string): void {
    if (offers.delete(offerId)) deps.emit({ kind: "fillOfferClosed", offerId });
  }
  function closeOffersOf(guestId: string): void {
    for (const [id, offer] of offers) if (offer.tab.guestId === guestId) closeOffer(id);
  }

  /** The prompt, once the login looks successful. Skipped for the login just filled from the store. */
  async function promptFor(p: Pending): Promise<void> {
    if (p.prompt || pendings.get(p.tab.guestId) !== p) return;
    if (p.poll) { timers.clear(p.poll); p.poll = undefined; }
    if (p.tab.grantedTo()) return dropPending(p); // handed to an agent meanwhile: the owner decides nothing there
    const recent = recentFills.get(p.tab.guestId);
    if (recent && recent.origin === p.origin && recent.username === p.username && now() - recent.at < 10 * 60_000) return dropPending(p);
    let existing: boolean;
    try { existing = (await deps.store.list(p.identityId, p.origin)).some((l) => l.username === p.username); }
    catch { return dropPending(p); }
    if (pendings.get(p.tab.guestId) !== p) return;
    const prompt: BrowserPasswordPromptView = { promptId: randomBytes(12).toString("hex"), hostId: p.tab.hostId, tabKey: p.tab.tabKey, identityId: p.identityId,
      origin: p.origin, username: p.username, kind: existing ? "update" : "save" };
    p.prompt = prompt;
    prompts.set(prompt.promptId, p);
    timers.clear(p.timer);
    p.timer = timers.set(() => dropPending(p), PROMPT_MS);
    deps.emit({ kind: "passwordPrompt", prompt });
  }

  /**
   * Once a second: no usable password field any more (same or new document) → prompt. The main frame committed a new
   * document that still shows one after AFTER_COMMIT_MS → most likely a failed login, drop. No commit and the field
   * stays for GONE_WATCH_MS → drop.
   */
  function watch(p: Pending): void {
    p.poll = timers.set(async () => {
      p.poll = undefined;
      if (pendings.get(p.tab.guestId) !== p || p.prompt) return;
      if (!p.tab.live()) return dropPending(p);
      if (p.committedAt === undefined && commitsOf(p.tab.guestId) !== p.commits) p.committedAt = now();
      if (await run(p.tab.guest, GONE_SCRIPT) === true) return void promptFor(p);
      if (pendings.get(p.tab.guestId) !== p) return;
      if (p.committedAt !== undefined ? now() - p.committedAt >= AFTER_COMMIT_MS : now() - p.started >= GONE_WATCH_MS) return dropPending(p);
      watch(p);
    }, GONE_POLL_MS);
  }

  /** Owner tab, no lease, owner's input, an identity: the preconditions of capture and fill. */
  function ownerTab(tab: PasswordTab): string | null {
    if (!tab.live() || !tab.ownerInput() || tab.guest.isDestroyed()) return null;
    return tab.identityId();
  }

  async function capture(tab: PasswordTab, trigger: "enter" | "click"): Promise<void> {
    const identityId = ownerTab(tab);
    if (!identityId || tab.grantedTo()) return;
    const url = tab.guest.getURL(), origin = browserLoginOrigin(url), baseline = commitsOf(tab.guestId);
    if (!origin) return;
    const p = await readPrefs();
    if (!p.offerSavePasswords) return;
    const result = parseSubmitProbe(await run(tab.guest, submitScript(trigger)));
    if (!result) return;
    // Re-check after the await: same document, still the owner's, still no lease.
    if (!tab.live() || tab.grantedTo() || tab.identityId() !== identityId || browserLoginOrigin(tab.guest.getURL()) !== origin) return;
    if (result.kind === "username") { usernameSteps.set(tab.guestId, { origin, username: result.username, at: now() }); return; }
    const secret = Buffer.from(result.password, "utf8");
    let username = result.username;
    const step = usernameSteps.get(tab.guestId);
    if (!username && step && step.origin === origin && now() - step.at < USERNAME_STEP_MS) username = step.username;
    try {
      if ((await deps.store.neverSave.list(identityId)).includes(origin) || !(await deps.store.status()).available) { secret.fill(0); return; }
    } catch { secret.fill(0); return; }
    const previous = pendings.get(tab.guestId);
    if (previous) dropPending(previous);
    const pending: Pending = { tab, identityId, origin, username, secret, commits: baseline, started: now(), timer: undefined };
    pending.timer = timers.set(() => dropPending(pending), PENDING_MS);
    pendings.set(tab.guestId, pending);
    watch(pending);
  }

  async function offer(tab: PasswordTab): Promise<void> {
    const identityId = ownerTab(tab);
    if (!identityId) return;
    const url = tab.guest.getURL(), origin = browserLoginOrigin(url), epoch = tab.documentEpoch();
    if (!origin) return;
    const p = await readPrefs();
    if (!p.offerFillPasswords) return;
    // The index first (memory): pages of origins without a saved login are never probed.
    let logins;
    try { logins = (await deps.store.list(identityId, origin)).map((l) => ({ id: l.id, username: l.username })); } catch { return; }
    if (!logins.length) return;
    const field = parseFieldProbe(await run(tab.guest, FIELD_SCRIPT));
    closeOffersOf(tab.guestId);
    if (!field || !tab.live() || tab.documentEpoch() !== epoch || tab.guest.getURL() !== url) return;
    const granted = tab.grantedTo();
    const view: BrowserFillOfferView = { offerId: randomBytes(12).toString("hex"), hostId: tab.hostId, tabKey: tab.tabKey, identityId, origin, field: field.rect, logins,
      ...(granted ? { grantedTo: { agentName: granted.agentName } } : {}) };
    offers.set(view.offerId, { view, tab, epoch, url });
    deps.emit({ kind: "fillOffer", offer: view });
  }

  function attach(tab: PasswordTab): () => void {
    const { guest } = tab;
    const keyboard = (_event: unknown, input: { type: string; key?: string; isAutoRepeat?: boolean }) => {
      if (input.type === "keyDown" && input.key === "Enter" && !input.isAutoRepeat) void capture(tab, "enter");
    };
    const mouse = (_event: unknown, input: { type: string; button?: string }) => {
      if (input.type !== "mouseUp" || (input.button && input.button !== "left")) return;
      void capture(tab, "click");
      void offer(tab);
    };
    const navigated = (_event: unknown, _url: string, ...rest: unknown[]) => {
      // did-navigate (url, code, status) is main-frame only; did-navigate-in-page (url, isMainFrame, …).
      if (rest.length && typeof rest[0] === "boolean" && rest[0] === false) return;
      commits.set(tab.guestId, commitsOf(tab.guestId) + 1);
      closeOffersOf(tab.guestId);
    };
    guest.on("before-input-event", keyboard as never);
    guest.on("before-mouse-event", mouse as never);
    guest.on("did-navigate", navigated);
    guest.on("did-navigate-in-page", navigated);
    return () => {
      if (!guest.isDestroyed()) {
        guest.removeListener("before-input-event", keyboard as never);
        guest.removeListener("before-mouse-event", mouse as never);
        guest.removeListener("did-navigate", navigated);
        guest.removeListener("did-navigate-in-page", navigated);
      }
      closeOffersOf(tab.guestId);
      const p = pendings.get(tab.guestId);
      if (p) dropPending(p);
      usernameSteps.delete(tab.guestId);
      recentFills.delete(tab.guestId);
      commits.delete(tab.guestId);
    };
  }

  /** One fresh native owner gesture (main-observed), used up; its window owns the Hello prompt. */
  const gesture = () => deps.ownerGesture() ?? fail("owner_gesture_required");

  async function fill(offerId: string, loginId: string): Promise<void> {
    const pressed = gesture();
    const o = offers.get(offerId) ?? fail("offer_closed");
    const { tab } = o;
    const login = o.view.logins.find((l) => l.id === loginId) ?? fail("not_found");
    const check = () => {
      if (!offers.has(offerId) || !tab.live() || tab.guest.isDestroyed()) fail("offer_closed");
      if (tab.grantedTo()) fail("tab_granted");
      if (tab.identityId() !== o.view.identityId || tab.documentEpoch() !== o.epoch || tab.guest.getURL() !== o.url) fail("offer_closed");
      if (browserLoginOrigin(tab.guest.getURL()) !== o.view.origin) fail("origin_changed");
    };
    check();
    const saved = (await deps.store.list(o.view.identityId, o.view.origin)).find((l) => l.id === loginId) ?? fail("not_found");
    const form = await run(tab.guest, FORM_SCRIPT) as { username?: unknown; password?: unknown } | null;
    if (!form || typeof form !== "object") fail("offer_closed");
    const window = tab.window() ?? pressed.window ?? deps.ownerWindow();
    await deps.store.useForFill(loginId, async (secret) => {
      check(); // the Hello prompt took time: the tab may have changed or been handed over meanwhile
      if (window && !window.isDestroyed()) window.focus();
      tab.guest.focus();
      if (form!.username === true && saved.username) {
        check();
        if (await run(tab.guest, fillScript("username", saved.username, o.view.origin)) !== true) fail("field_gone");
      }
      if (form!.password === true) {
        check();
        if (await run(tab.guest, fillScript("password", secret.toString("utf8"), o.view.origin)) !== true) fail("field_gone");
      }
    }, { window });
    recentFills.set(tab.guestId, { origin: o.view.origin, username: login.username, at: now() });
    closeOffer(offerId);
  }

  return {
    attach,
    lock: () => deps.store.lock(),
    dispose() {
      for (const p of [...pendings.values()]) dropPending(p);
      for (const id of [...offers.keys()]) closeOffer(id);
      deps.store.lock();
      if (clipboardTimer) timers.clear(clipboardTimer);
    },
    async passwords(identityId) {
      return (await deps.store.list(identityId)).map(({ revision: _revision, ...view }) => view);
    },
    async update(id, username) {
      const all = await findLogin(id);
      await deps.store.update(id, { username });
      passwordsChanged(all.identityId);
    },
    async remove(id) {
      const login = await findLogin(id).catch(() => null);
      await deps.store.remove(id);
      if (login) passwordsChanged(login.identityId);
    },
    async reveal(id) {
      const pressed = gesture();
      await readPrefs();
      const login = await findLogin(id);
      const window = pressed.window ?? deps.ownerWindow();
      const secret = await deps.store.reveal(id, "show", { window });
      try { await deps.showSecret(window, login, secret.toString("utf8")); } finally { secret.fill(0); }
    },
    async status(): Promise<BrowserPasswordStoreStatus> {
      await readPrefs();
      return deps.store.status();
    },
    async copy(id) {
      const pressed = gesture();
      await readPrefs();
      await findLogin(id);
      const secret = await deps.store.reveal(id, "copy", { window: pressed.window ?? deps.ownerWindow() });
      let hash: string;
      try {
        const text = secret.toString("utf8");
        await deps.clipboard.writeText(text);
        hash = createHash("sha256").update(text).digest("hex");
      } finally { secret.fill(0); }
      if (clipboardTimer) timers.clear(clipboardTimer);
      clipboardTimer = timers.set(() => {
        clipboardTimer = undefined;
        void (async () => { try { if (createHash("sha256").update(await deps.clipboard.readText()).digest("hex") === hash) await deps.clipboard.clear(); } catch { /* clipboard busy */ } })();
      }, CLIPBOARD_CLEAR_MS);
    },
    async neverSave(identityId, remove) {
      if (remove !== undefined) await deps.store.neverSave.remove(identityId, remove);
      return deps.store.neverSave.list(identityId);
    },
    async answer(promptId: string, choice: BrowserPasswordPromptChoice) {
      const p = prompts.get(promptId) ?? fail("prompt_closed");
      try {
        if (choice === "save") {
          const secret = Buffer.from(p.secret); // the store zeroes its copy
          await deps.store.save(p.identityId, p.origin, p.username, secret, { window: p.tab.window() ?? deps.ownerWindow() });
          passwordsChanged(p.identityId);
        } else if (choice === "never") {
          await deps.store.neverSave.add(p.identityId, p.origin);
        }
      } finally { dropPending(p); }
    },
    fill,
    async dismiss(offerId) { closeOffer(offerId); },
    async confirmGrace() {
      const pressed = gesture();
      await deps.store.verify({ window: pressed.window ?? deps.ownerWindow() });
    },
    graceChanged(on) {
      deps.graceChanged?.(on);
      if (!on) deps.store.lock();
    },
    async removeIdentity(identityId) {
      for (const p of [...pendings.values()]) if (p.identityId === identityId) dropPending(p);
      for (const [id, o] of offers) if (o.view.identityId === identityId) closeOffer(id);
      await deps.store.removeIdentity(identityId);
      passwordsChanged(identityId);
    },
  };

  async function findLogin(id: string) { return (await deps.store.get(id)) ?? fail("not_found"); }
}
