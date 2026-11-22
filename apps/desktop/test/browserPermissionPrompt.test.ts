import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_PERMISSION_HELD_LIMIT, createBrowserPermissionPrompt } from "../src/main/browser/permissionPrompt";
import { BrowserSitePermissionStore, createBrowserSitePermissions, type BrowserPermissionGuest } from "../src/main/browser/sitePermissions";

// Windows acceptance E4: a native prompt behind another window left getUserMedia /
// Notification.requestPermission pending forever, and queued every later prompt behind it.
type Answer = { response: number; checkboxChecked: boolean };
function win(state: { visible?: boolean; minimized?: boolean; focused?: boolean } = {}) {
  return { isDestroyed: vi.fn(() => false), isVisible: vi.fn(() => state.visible ?? true), isMinimized: vi.fn(() => state.minimized ?? false),
    isFocused: vi.fn(() => state.focused ?? true), flashFrame: vi.fn() };
}
function setup(window: ReturnType<typeof win> | null = win(), timeoutMs = 1000) {
  const notices: string[] = []; let closed = false;
  const shown: { options: Record<string, any>; answer(value: Answer): void }[] = [];
  const showMessageBox = vi.fn((_w: unknown, options: any) => new Promise<Answer>(resolve => {
    shown.push({ options, answer: resolve });
    // Electron closes the box as cancelled (cancelId) when its signal aborts.
    options.signal?.addEventListener("abort", () => resolve({ response: options.cancelId, checkboxChecked: false }));
  }));
  const prompt = createBrowserPermissionPrompt({ window: () => window, showMessageBox, locale: () => "en", closed: () => closed, timeoutMs, pollMs: 50,
    notice: kind => { notices.push(kind); } });
  return { prompt, showMessageBox, shown, notices, window, close: () => { closed = true; } };
}
const request = (signal?: AbortSignal) => ({ guestId: "g1", origin: "https://cam.example", permissions: ["camera" as const], pool: "owner" as const, agentActing: false, ...(signal ? { signal } : {}) });
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });

describe("browser permission prompt (native owner dialog)", () => {
  it("a focused window shows the dialog and returns the owner's answer", async () => {
    const f = setup(); const answer = f.prompt(request()); await tick();
    expect(f.shown[0]!.options).toMatchObject({ message: "https://cam.example wants to use: camera", buttons: ["Allow", "Block"], cancelId: 1, defaultId: 1 });
    expect(f.shown[0]!.options.signal).toBeInstanceOf(AbortSignal);
    f.shown[0]!.answer({ response: 0, checkboxChecked: true });
    await expect(answer).resolves.toEqual({ allow: true, remember: true });
    expect(f.notices).toEqual([]); expect(f.window!.flashFrame).not.toHaveBeenCalled();
  });
  it("a window behind another app flashes and tells the owner in the app where the dialog is", async () => {
    const f = setup(win({ focused: false })); const answer = f.prompt(request()); await tick();
    expect(f.window!.flashFrame).toHaveBeenCalledWith(true); expect(f.notices).toEqual(["permission-waiting"]);
    f.shown[0]!.answer({ response: 1, checkboxChecked: false });
    await expect(answer).resolves.toEqual({ allow: false, remember: false });
    expect(f.window!.flashFrame).toHaveBeenLastCalledWith(false);
  });
  it("a hidden window never shows an invisible dialog: the agent's / agent-pool / windowless requests deny at once, remember nothing", async () => {
    for (const [state, over] of [[{ visible: false }, { agentActing: true }], [{ minimized: true }, { pool: "agent" as const }], [null, {}]] as const) {
      const f = setup(state ? win(state) : null);
      await expect(f.prompt({ ...request(), ...over })).resolves.toBeNull();
      expect(f.showMessageBox).not.toHaveBeenCalled(); expect(f.notices).toEqual(["permission-hidden"]);
    }
  });
  it("A7: the owner's request while minimized waits (flashing), and the native dialog rises when the window is restored", async () => {
    vi.useFakeTimers();
    const state = { minimized: true }, f = setup(win(state), 1000);
    const answer = f.prompt(request()); await tick();
    expect(f.notices).toEqual(["permission-held"]); expect(f.window!.flashFrame).toHaveBeenCalledWith(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(f.showMessageBox).not.toHaveBeenCalled(); // never an invisible dialog, never an answer of its own
    state.minimized = false; await vi.advanceTimersByTimeAsync(50);
    expect(f.notices).toEqual(["permission-held", "permission-shown"]); expect(f.shown).toHaveLength(1);
    f.shown[0]!.answer({ response: 0, checkboxChecked: false });
    await expect(answer).resolves.toEqual({ allow: true, remember: false });
    expect(f.window!.flashFrame).toHaveBeenLastCalledWith(false);
  });
  it("A7: the deadline is absolute (wait + dialog); navigation cancels the wait; an unseen expiry stops further waits until the window is seen", async () => {
    vi.useFakeTimers();
    const state = { minimized: true }, f = setup(win(state), 1000);
    const first = f.prompt(request()); await vi.advanceTimersByTimeAsync(700);
    state.minimized = false; await vi.advanceTimersByTimeAsync(50);
    expect(f.shown).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300); // 1000 ms after the request, not after the dialog
    await expect(first).resolves.toBeNull(); expect(f.notices.at(-1)).toBe("permission-timeout");
    state.minimized = true;
    const abort = new AbortController(), gone = f.prompt(request(abort.signal)); await tick();
    abort.abort(); await expect(gone).resolves.toBeNull(); expect(f.notices.at(-1)).toBe("permission-held");
    const unseen = f.prompt(request()); await vi.advanceTimersByTimeAsync(1000);
    await expect(unseen).resolves.toBeNull(); expect(f.notices.at(-1)).toBe("permission-timeout");
    await expect(f.prompt(request())).resolves.toBeNull(); expect(f.notices.at(-1)).toBe("permission-hidden");
    state.minimized = false; const seen = f.prompt(request()); await tick(); f.shown.at(-1)!.answer({ response: 1, checkboxChecked: false }); await seen;
    state.minimized = true; void f.prompt(request()); await tick(); expect(f.notices.at(-1)).toBe("permission-held");
    expect(f.showMessageBox).toHaveBeenCalledTimes(2);
  });
  it("A7: at most BROWSER_PERMISSION_HELD_LIMIT waits per hidden spell", async () => {
    vi.useFakeTimers();
    const f = setup(win({ visible: false }), 60_000);
    for (let i = 0; i < BROWSER_PERMISSION_HELD_LIMIT; i++) void f.prompt(request());
    await tick();
    await expect(f.prompt(request())).resolves.toBeNull();
    expect(f.notices.filter(kind => kind === "permission-held")).toHaveLength(BROWSER_PERMISSION_HELD_LIMIT); expect(f.notices.at(-1)).toBe("permission-hidden");
  });
  it("an unanswered dialog closes after the timeout as a deny that is not remembered", async () => {
    vi.useFakeTimers(); const f = setup(win({ focused: false }), 1000);
    const answer = f.prompt(request()); await tick();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(answer).resolves.toBeNull();
    expect(f.notices).toEqual(["permission-waiting", "permission-timeout"]);
  });
  it("the caller's signal (page navigated away / closed) closes the dialog without a timeout notice", async () => {
    const f = setup(); const abort = new AbortController();
    const answer = f.prompt(request(abort.signal)); await tick();
    abort.abort();
    await expect(answer).resolves.toBeNull(); expect(f.notices).toEqual([]);
    await expect(f.prompt(request(abort.signal))).resolves.toBeNull(); expect(f.showMessageBox).toHaveBeenCalledOnce();
  });
  it("a late answer after the module closed is not trusted", async () => {
    const f = setup(); const answer = f.prompt(request()); await tick();
    f.close(); f.shown[0]!.answer({ response: 0, checkboxChecked: true });
    await expect(answer).resolves.toBeNull();
  });
});

describe("site permission queue with the native prompt", () => {
  function queue(timeoutMs = 1000) {
    const io = { read: () => { throw new Error("missing"); }, write: () => {} };
    const store = new BrowserSitePermissionStore("perm.json", io);
    const guests = new Map<number, BrowserPermissionGuest>([[7, { guestId: "g7", pool: "owner", url: "https://cam.example/" }], [8, { guestId: "g8", pool: "owner", url: "https://push.example/" }]]);
    const watchers = new Map<string, () => void>();
    const f = setup(win({ focused: false }), timeoutMs);
    const permissions = createBrowserSitePermissions({ store, guest: id => guests.get(id), agentInput: () => false, prompt: f.prompt,
      watch: (_id, guestId, _origin, gone) => { watchers.set(guestId, gone); return () => watchers.delete(guestId); } });
    return { ...f, permissions, guests, watchers, store };
  }
  it("an unanswered camera prompt no longer blocks a later notification prompt forever", async () => {
    vi.useFakeTimers(); const f = queue(1000);
    const camera = f.permissions.request(7, "media", { mediaTypes: ["video"], requestingUrl: "https://cam.example/" });
    const notify = f.permissions.request(8, "notifications", { requestingUrl: "https://push.example/" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.shown).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(camera).resolves.toBe(false);
    expect(f.shown).toHaveLength(2); expect(f.shown[1]!.options.message).toBe("https://push.example wants to use: notifications");
    f.shown[1]!.answer({ response: 0, checkboxChecked: true });
    await expect(notify).resolves.toBe(true);
    expect(f.store.list()).toEqual([{ pool: "owner", origin: "https://push.example", permission: "notifications", allow: true }]);
  });
  it("leaving the page closes its dialog, and a queued request of a page that has gone is never shown", async () => {
    const f = queue();
    const camera = f.permissions.request(7, "media", { mediaTypes: ["video"] });
    const notify = f.permissions.request(8, "notifications", {});
    await tick();
    f.guests.set(8, { guestId: "g8", pool: "owner", url: "https://elsewhere.example/" });
    f.watchers.get("g7")!();
    await expect(camera).resolves.toBe(false); await expect(notify).resolves.toBe(false);
    expect(f.shown).toHaveLength(1); expect(f.store.list()).toEqual([]);
  });
  it("A7: a request held for a hidden window gives up the one-dialog slot, and takes it again before its own dialog", async () => {
    vi.useFakeTimers();
    const io = { read: () => { throw new Error("missing"); }, write: () => {} };
    const state = { minimized: true }, desk = win(state), main = win();
    const guests = new Map<number, BrowserPermissionGuest>([[7, { guestId: "desk", pool: "owner", url: "https://cam.example/" }], [8, { guestId: "main", pool: "owner", url: "https://push.example/" }]]);
    const shown: { window: unknown; answer(value: Answer): void }[] = [];
    const prompt = createBrowserPermissionPrompt({ window: request => request.guestId === "desk" ? desk : main, locale: () => "en", closed: () => false, timeoutMs: 60_000, pollMs: 50,
      showMessageBox: (window, options) => new Promise<Answer>(resolve => { shown.push({ window, answer: resolve }); options.signal?.addEventListener("abort", () => resolve({ response: 1, checkboxChecked: false })); }),
      notice: () => {} });
    const permissions = createBrowserSitePermissions({ store: new BrowserSitePermissionStore("perm.json", io), guest: id => guests.get(id), agentInput: () => false, prompt });
    const camera = permissions.request(7, "media", { mediaTypes: ["video"] });
    const notify = permissions.request(8, "notifications", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(shown.map(item => item.window)).toEqual([main]); // the main window's tab is asked while the desk is minimized
    state.minimized = false; await vi.advanceTimersByTimeAsync(100);
    expect(shown).toHaveLength(1); // the desk's dialog waits for the slot
    shown[0]!.answer({ response: 0, checkboxChecked: false });
    await expect(notify).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown.map(item => item.window)).toEqual([main, desk]);
    shown[1]!.answer({ response: 1, checkboxChecked: false });
    await expect(camera).resolves.toBe(false);
  });
});
