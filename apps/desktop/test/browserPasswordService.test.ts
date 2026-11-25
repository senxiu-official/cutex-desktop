// E1: capture on the owner's submit, the 「要保存吗」 prompt, fill offers, fill with re-checks, show / copy — on a fake
// guest and the in-memory store with the stand-in verifier (no OS dialog). The password must never appear in an
// event for the renderer.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BROWSER_IDENTITY_PREFS, type BrowserIdentityEvent, type BrowserIdentityPrefs } from "../src/shared/browserIdentity";
import { devMemoryGuard, memorySlots, type FakeVerdict } from "../src/main/browser/passwords/guards";
import { AFTER_COMMIT_MS, CLIPBOARD_CLEAR_MS, GONE_WATCH_MS, createBrowserPasswordService, type PasswordTab } from "../src/main/browser/passwords/service";
import { createPasswordStore } from "../src/main/browser/passwords/store";
import { FIELD_SCRIPT, FORM_SCRIPT, GONE_SCRIPT } from "../src/main/browser/passwords/pageScripts";

const ORIGIN = "https://login.example.com";
const PASSWORD = "s3cret-Pa55";

class FakeGuest extends EventEmitter {
  url = `${ORIGIN}/signin`;
  destroyed = false;
  typed: string[] = [];
  submit: unknown = { kind: "login", username: "mika@example.com", password: PASSWORD };
  gone = false;
  field: unknown = { role: "password", rect: { x: 10, y: 20, width: 200, height: 30 } };
  form: unknown = { username: true, password: true };
  focusOk = true;
  scripts: string[] = [];
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
  focus() {}
  async insertText(text: string) { this.typed.push(text); }
  async executeJavaScriptInIsolatedWorld(world: number, scripts: { code: string }[]) {
    const code = scripts[0]!.code;
    expect(world).toBe(1007);
    this.scripts.push(code);
    if (code === GONE_SCRIPT) return this.gone;
    if (code === FIELD_SCRIPT) return this.field;
    if (code === FORM_SCRIPT) return this.form;
    if (code.includes("execCommand")) {
      // fillScript: origin + focus re-check and insertion in one step; the fake records what would be typed.
      if (this.focusOk) this.typed.push(JSON.parse(/const text = (".*?");\n/.exec(code)![1]!) as string);
      return this.focusOk;
    }
    return this.submit;
  }
}

function setup(o: { verdict?: () => FakeVerdict; prefs?: Partial<BrowserIdentityPrefs> } = {}) {
  let gesture = true, grace = false;
  const graceChanged = vi.fn((on: boolean) => { grace = on; });
  const guest = new FakeGuest();
  const events: BrowserIdentityEvent[] = [];
  let granted: { agentName: string } | null = null;
  let agent = false;
  let epoch = 1;
  let indexText: string | null = null;
  const guard = devMemoryGuard(async () => o.verdict?.() ?? "ok");
  const store = createPasswordStore({ kind: "devMemory", guard, slots: memorySlots(), index: { read: () => indexText, write: (t) => { indexText = t; } }, graceEnabled: () => grace });
  let clip = "";
  const clipboard = { writeText: vi.fn((t: string) => { clip = t; }), readText: () => clip, clear: vi.fn(() => { clip = ""; }) };
  const shown: string[] = [];
  const service = createBrowserPasswordService({
    store, emit: (e) => events.push(e), prefs: async () => ({ ...DEFAULT_BROWSER_IDENTITY_PREFS, ...o.prefs, passwordHelloGrace: grace }), ownerWindow: () => null, clipboard,
    ownerGesture: () => (gesture ? { window: null } : null), graceChanged,
    showSecret: async (_w, _login, password) => { shown.push(password); },
  });
  const tab: PasswordTab = {
    hostId: "local", tabKey: "t1", guestId: "g1", guest: guest as never,
    identityId: () => "default", grantedTo: () => granted, ownerInput: () => !agent, live: () => !guest.destroyed,
    documentEpoch: () => epoch, window: () => null,
  };
  const stop = service.attach(tab);
  return {
    guest, events, service, store, guard, stop, clipboard, shown, graceChanged, setGesture: (on: boolean) => { gesture = on; }, readClip: () => clip, setClip: (t: string) => { clip = t; },
    grant: (on: boolean) => { granted = on ? { agentName: "Mika" } : null; }, agentInput: (on: boolean) => { agent = on; },
    navigate: (url = `${ORIGIN}/home`) => { guest.url = url; epoch++; guest.emit("did-navigate", {}, url, 200, "OK"); },
    enter: () => guest.emit("before-input-event", {}, { type: "keyDown", key: "Enter" }),
    click: () => guest.emit("before-mouse-event", {}, { type: "mouseUp", button: "left" }),
    noSecretInEvents: () => expect(JSON.stringify(events)).not.toContain(PASSWORD),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const kinds = (events: BrowserIdentityEvent[]) => events.map((e) => e.kind);

describe("password service", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("captures on Enter, prompts once the password field is gone, and saves on 「保存」", async () => {
    const t = setup();
    t.enter();
    await flush();
    expect(kinds(t.events)).toEqual([]); // the field is still there: wait
    t.guest.gone = true;
    await vi.advanceTimersByTimeAsync(1000);
    const prompt = t.events.find((e) => e.kind === "passwordPrompt");
    expect(prompt).toMatchObject({ prompt: { origin: ORIGIN, username: "mika@example.com", kind: "save", hostId: "local", tabKey: "t1", identityId: "default" } });
    await t.service.answer((prompt as { prompt: { promptId: string } }).prompt.promptId, "save");
    expect(kinds(t.events)).toEqual(["passwordPrompt", "passwords", "passwordPromptClosed"]);
    expect((await t.store.list("default", ORIGIN)).map((l) => l.username)).toEqual(["mika@example.com"]);
    t.noSecretInEvents();
  });

  it("a failed login (the new page still asks for the password) and a field that stays are dropped", async () => {
    const t = setup();
    t.click();
    await flush();
    t.navigate(`${ORIGIN}/signin?error=1`);
    await vi.advanceTimersByTimeAsync(AFTER_COMMIT_MS + 2000);
    expect(kinds(t.events)).toEqual([]);
    t.enter();
    await vi.advanceTimersByTimeAsync(GONE_WATCH_MS + 2000);
    t.guest.gone = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(kinds(t.events)).toEqual([]);
  });

  it("a committed new page without a password field prompts; an existing login prompts 「更新」", async () => {
    const t = setup();
    await t.store.save("default", ORIGIN, "mika@example.com", Buffer.from("old"));
    t.enter();
    await flush();
    t.navigate();
    t.guest.gone = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.events.find((e) => e.kind === "passwordPrompt")).toMatchObject({ prompt: { kind: "update" } });
  });

  it("two-step sign-in: the user name page is remembered for the password page", async () => {
    const t = setup();
    t.guest.submit = { kind: "username", username: "mika@example.com" };
    t.enter();
    await flush();
    t.guest.submit = { kind: "login", username: "", password: PASSWORD };
    t.enter();
    await flush();
    t.guest.gone = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.events.find((e) => e.kind === "passwordPrompt")).toMatchObject({ prompt: { username: "mika@example.com" } });
  });

  it("nothing in a tab granted to an agent, from agent input, for 「从不保存」 sites, or with the pref off", async () => {
    const granted = setup();
    granted.grant(true);
    granted.enter(); granted.guest.gone = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(granted.guest.scripts).toEqual([]);

    const agent = setup();
    agent.agentInput(true);
    agent.click(); agent.guest.gone = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(agent.guest.scripts).toEqual([]);

    const never = setup();
    await never.store.neverSave.add("default", ORIGIN);
    never.enter(); never.guest.gone = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(kinds(never.events)).toEqual([]);

    const off = setup({ prefs: { offerSavePasswords: false } });
    off.enter(); off.guest.gone = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(off.guest.scripts).toEqual([]);
  });

  it("the tab handed over between submit and prompt: no prompt", async () => {
    const t = setup();
    t.enter();
    await flush();
    t.grant(true);
    t.guest.gone = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(kinds(t.events)).not.toContain("passwordPrompt");
  });

  it("offers the logins of exactly this origin at the field and fills after the Hello check", async () => {
    const t = setup();
    await t.store.save("default", ORIGIN, "mika@example.com", Buffer.from(PASSWORD));
    await t.store.save("default", "https://example.com", "other", Buffer.from("x"));
    t.click();
    await flush();
    const offer = t.events.find((e) => e.kind === "fillOffer") as Extract<BrowserIdentityEvent, { kind: "fillOffer" }>;
    expect(offer.offer).toMatchObject({ origin: ORIGIN, field: { x: 10, y: 20, width: 200, height: 30 }, logins: [{ username: "mika@example.com" }] });
    expect(offer.offer.grantedTo).toBeUndefined();
    await t.service.fill(offer.offer.offerId, offer.offer.logins[0]!.id);
    expect(t.guest.typed).toEqual(["mika@example.com", PASSWORD]);
    expect(t.guard.prompts.at(-1)).toBe("fill");
    expect(kinds(t.events).at(-1)).toBe("fillOfferClosed");
    t.noSecretInEvents();
    // The login just filled does not ask to be saved again.
    t.enter(); await flush(); t.guest.gone = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(kinds(t.events)).not.toContain("passwordPrompt");
  });

  it("fill refuses: Hello cancelled, tab granted, page changed during Hello, offer closed by navigation", async () => {
    let verdict: FakeVerdict = "ok";
    const t = setup({ verdict: () => verdict });
    const login = await t.store.save("default", ORIGIN, "u", Buffer.from(PASSWORD));
    const open = async () => {
      t.click(); await flush();
      return (t.events.filter((e) => e.kind === "fillOffer").at(-1) as Extract<BrowserIdentityEvent, { kind: "fillOffer" }>).offer;
    };
    verdict = "cancel";
    await expect(t.service.fill((await open()).offerId, login.id)).rejects.toThrow("auth_cancelled");
    expect(t.guest.typed).toEqual([]);

    verdict = "ok";
    t.grant(true);
    const grantedOffer = await open();
    expect(grantedOffer.grantedTo).toEqual({ agentName: "Mika" });
    await expect(t.service.fill(grantedOffer.offerId, login.id)).rejects.toThrow("tab_granted");
    t.grant(false);

    const racing = await open();
    const fill = t.service.fill(racing.offerId, login.id);
    t.guest.url = "https://evil.example.com/";
    await expect(fill).rejects.toThrow(/offer_closed|origin_changed/);
    expect(t.guest.typed).toEqual([]);
    t.guest.url = `${ORIGIN}/signin`;

    const closed = await open();
    t.navigate(`${ORIGIN}/other`);
    await expect(t.service.fill(closed.offerId, login.id)).rejects.toThrow("offer_closed");
    expect(t.guest.typed).toEqual([]);
  });

  it("show uses main's dialog; copy clears the clipboard after 30 s only if unchanged", async () => {
    const t = setup();
    const login = await t.store.save("default", ORIGIN, "u", Buffer.from(PASSWORD));
    await expect(t.service.reveal(login.id)).resolves.toBeUndefined();
    expect(t.shown).toEqual([PASSWORD]);
    await t.service.copy(login.id);
    expect(t.readClip()).toBe(PASSWORD);
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    expect(t.readClip()).toBe("");
    await t.service.copy(login.id);
    t.setClip("something else");
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    expect(t.readClip()).toBe("something else");
    expect(t.guard.prompts.filter((p) => p === "show" || p === "copy")).toEqual(["show", "copy", "copy"]);
    t.noSecretInEvents();
  });

  it("show, copy, fill and turning the grace on need a fresh native owner gesture (renderer code alone cannot)", async () => {
    const t = setup();
    const login = await t.store.save("default", ORIGIN, "u", Buffer.from(PASSWORD));
    t.click(); await flush();
    const offer = (t.events.find((e) => e.kind === "fillOffer") as Extract<BrowserIdentityEvent, { kind: "fillOffer" }>).offer;
    t.setGesture(false);
    const before = t.guard.prompts.length;
    await expect(t.service.reveal(login.id)).rejects.toThrow("owner_gesture_required");
    await expect(t.service.copy(login.id)).rejects.toThrow("owner_gesture_required");
    await expect(t.service.fill(offer.offerId, login.id)).rejects.toThrow("owner_gesture_required");
    await expect(t.service.confirmGrace()).rejects.toThrow("owner_gesture_required");
    expect(t.guard.prompts.length).toBe(before); // not even a Hello prompt
    expect(t.shown).toEqual([]);
    expect(t.readClip()).toBe("");
    expect(t.guest.typed).toEqual([]);
  });

  it("grace: on needs Hello; copy still asks every time; off forgets the unlock at once", async () => {
    const t = setup();
    const login = await t.store.save("default", ORIGIN, "u", Buffer.from(PASSWORD));
    await t.service.confirmGrace();
    expect(t.guard.prompts.at(-1)).toBe("grace");
    t.service.graceChanged(true);
    expect(t.graceChanged).toHaveBeenLastCalledWith(true);
    await t.service.reveal(login.id);
    await t.service.reveal(login.id);
    expect(t.guard.prompts.filter((p) => p === "show")).toHaveLength(1); // within the grace
    expect(t.store.unlocked()).toBe(true);
    await t.service.copy(login.id);
    await t.service.copy(login.id);
    expect(t.guard.prompts.filter((p) => p === "copy")).toHaveLength(2); // never from the grace
    t.service.graceChanged(false);
    expect(t.store.unlocked()).toBe(false);
    t.service.graceChanged(true);
    await t.service.reveal(login.id);
    expect(t.guard.prompts.filter((p) => p === "show")).toHaveLength(2);
  });

  it("closing the tab drops a held value and the offers", async () => {
    const t = setup();
    await t.store.save("default", ORIGIN, "u", Buffer.from(PASSWORD));
    t.click();
    await flush();
    t.stop();
    expect(kinds(t.events).at(-1)).toBe("fillOfferClosed");
    t.guest.gone = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(kinds(t.events)).not.toContain("passwordPrompt");
  });
});
