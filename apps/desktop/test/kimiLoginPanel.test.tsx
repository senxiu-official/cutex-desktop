// @vitest-environment jsdom
// The Kimi device-code login panel (docs/design/049): starts the login through the target api, shows cutex's URL and
// code, opens the URL only on a click (main's openExternal), polls at cutex's interval until a final state, and cancels.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KimiAccount, KimiLogin } from "../src/shared/kimiAccounts";

const env = vi.hoisted(() => ({ start: vi.fn(), poll: vi.fn(), cancel: vi.fn(), open: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({ ...(await importOriginal<object>()), useTargetHostLabel: () => "hachimi", useTargetApi: () => ({ startKimiLogin: env.start, kimiLogin: env.poll, cancelKimiLogin: env.cancel, openExternal: env.open }) }));
const { LoginPanel } = await import("../src/renderer/src/modules/kimi-accounts/LoginPanel");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

const ID = `kl-${"b".repeat(32)}`;
const login = (over: Partial<KimiLogin> = {}): KimiLogin => ({ loginId: ID, accountId: "ka-work", state: "pending", verificationUri: "https://www.kimi.com/code/authorize_device?user_code=WXYZ-2345", userCode: "WXYZ-2345", expiresAt: new Date(Date.now() + 600_000).toISOString(), interval: 2, startedAt: null, finishedAt: null, error: null, ...over });
const account: KimiAccount = { id: "ka-work", label: "Work", kind: "subscription", region: "mainland-cn", home: null, createdAt: null, credentialsPresent: false, status: null, login: null, models: [], profiles: [], sessions: { active: 0, online: 0, retired: 0 }, removable: true };
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

it("starts the login, shows the URL and code, opens only on click, and polls to success", async () => {
  env.start.mockResolvedValue({ ok: true, login: login({ state: "starting", verificationUri: null, userCode: null }) });
  env.poll.mockResolvedValueOnce({ ok: true, login: login() }).mockResolvedValueOnce({ ok: true, login: login({ state: "succeeded" }) });
  const onDone = vi.fn();
  act(() => root.render(h(LoginPanel, { account, initial: null, onDone, onClose: vi.fn() })));
  await flush();
  expect(env.start).toHaveBeenCalledWith("ka-work");
  expect(host.querySelector("[data-kimi-login]")?.getAttribute("data-kimi-login")).toBe("starting");
  await act(async () => { vi.advanceTimersByTime(1000); });
  await flush();
  expect(env.poll).toHaveBeenCalledWith("ka-work", ID);
  expect(host.querySelector("[data-kimi-login-code]")?.textContent).toBe("WXYZ-2345");
  expect(host.querySelector("[data-kimi-login-url]")?.textContent).toMatch(/^https:\/\/www\.kimi\.com/);
  expect(env.open).not.toHaveBeenCalled();
  env.open.mockResolvedValue(undefined);
  await act(async () => button("kimi-accounts.login.open")!.click());
  expect(env.open).toHaveBeenCalledWith("https://www.kimi.com/code/authorize_device?user_code=WXYZ-2345");
  await act(async () => { vi.advanceTimersByTime(2000); });
  await flush();
  expect(host.querySelector("[data-kimi-login]")?.getAttribute("data-kimi-login")).toBe("succeeded");
  expect(onDone).toHaveBeenCalled();
});

it("takes over a running login and cancels it", async () => {
  env.cancel.mockResolvedValue({ ok: true, login: login({ state: "cancelled" }) });
  const onDone = vi.fn();
  act(() => root.render(h(LoginPanel, { account, initial: login(), onDone, onClose: vi.fn() })));
  expect(env.start).not.toHaveBeenCalled();
  await act(async () => button("kimi-accounts.login.cancel")!.click());
  await flush();
  expect(env.cancel).toHaveBeenCalledWith("ka-work", ID);
  expect(host.querySelector("[data-kimi-login]")?.getAttribute("data-kimi-login")).toBe("cancelled");
  expect(onDone).toHaveBeenCalled();
});

it("a refused start says why (no Kimi Code on the host) and offers a retry", async () => {
  env.start.mockResolvedValue({ ok: false, error: { code: "kimi_runtime_unavailable", message: "kimi-runtime component is not installed" } });
  act(() => root.render(h(LoginPanel, { account, initial: null, onDone: vi.fn(), onClose: vi.fn() })));
  await flush();
  // The test's t() echoes keys, so the known-code lookup falls through to cutex's message.
  expect(host.textContent).toContain("kimi-runtime component is not installed");
  expect(button("kimi-accounts.login.retry")).toBeTruthy();
});

it("a login the daemon forgot (restart) says so", async () => {
  env.poll.mockResolvedValue({ ok: false, error: { code: "kimi_login_not_found", message: "no login" } });
  const onDone = vi.fn();
  act(() => root.render(h(LoginPanel, { account, initial: login(), onDone, onClose: vi.fn() })));
  await act(async () => { vi.advanceTimersByTime(2000); });
  await flush();
  expect(host.textContent).toContain("kimi-accounts.login.lost");
  expect(onDone).toHaveBeenCalled();
});

// QA r265b-kimi (login cancel race): a poll GET in flight when the DELETE answers `cancelled` must not put the panel back
// to waiting; the request generation fence drops its late answer.
const phase = () => host.querySelector("[data-kimi-login]")?.getAttribute("data-kimi-login");
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => (resolve = r)); return { promise, resolve }; }

it("a poll answering pending after the DELETE answered cancelled keeps the panel cancelled", async () => {
  const poll = deferred<unknown>();
  env.poll.mockReturnValue(poll.promise);
  env.cancel.mockResolvedValue({ ok: true, login: login({ state: "cancelled" }) });
  act(() => root.render(h(LoginPanel, { account, initial: login(), onDone: vi.fn(), onClose: vi.fn() })));
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(env.poll).toHaveBeenCalledTimes(1); // the GET is in flight
  await act(async () => button("kimi-accounts.login.cancel")!.click());
  await flush();
  expect(phase()).toBe("cancelled");
  await act(async () => { poll.resolve({ ok: true, login: login() }); });
  await flush();
  expect(phase()).toBe("cancelled");
  await act(async () => { vi.advanceTimersByTime(10_000); });
  await flush();
  expect(env.poll).toHaveBeenCalledTimes(1); // a final state polls no more
  expect(phase()).toBe("cancelled");
});

it("a poll answering pending while the DELETE is still out does not win over the cancel", async () => {
  const poll = deferred<unknown>();
  const del = deferred<unknown>();
  env.poll.mockReturnValue(poll.promise);
  env.cancel.mockReturnValue(del.promise);
  act(() => root.render(h(LoginPanel, { account, initial: login(), onDone: vi.fn(), onClose: vi.fn() })));
  await act(async () => { vi.advanceTimersByTime(2000); });
  await act(async () => button("kimi-accounts.login.cancel")!.click());
  await act(async () => { poll.resolve({ ok: true, login: login({ interval: 1 }) }); });
  await flush();
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(env.poll).toHaveBeenCalledTimes(1); // no new poll while the DELETE is out
  await act(async () => { del.resolve({ ok: true, login: login({ state: "cancelled" }) }); });
  await flush();
  expect(phase()).toBe("cancelled");
});

it("a refused cancel says why and keeps following the login", async () => {
  env.cancel.mockResolvedValue({ ok: false, error: { code: "kimi_login_busy", message: "busy" } });
  env.poll.mockResolvedValue({ ok: true, login: login({ state: "succeeded" }) });
  act(() => root.render(h(LoginPanel, { account, initial: login(), onDone: vi.fn(), onClose: vi.fn() })));
  await act(async () => button("kimi-accounts.login.cancel")!.click());
  await flush();
  expect(host.textContent).toContain("busy");
  await act(async () => { vi.advanceTimersByTime(2000); });
  await flush();
  expect(env.poll).toHaveBeenCalledTimes(1);
  expect(phase()).toBe("succeeded");
});
