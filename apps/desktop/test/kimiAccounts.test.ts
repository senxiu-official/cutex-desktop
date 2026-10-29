// @vitest-environment jsdom
// Kimi accounts (cutex kimi-accounts, r266; docs/design/049): request sanitizers in main, the account state and the
// device-code login view in the section. No token ever passes the desktop; only cutex's URL / code / state.
import { describe, expect, it } from "vitest";
import { KIMI_ACCOUNTS_FEATURE, kimiAccountCreateBody, kimiAccountId, kimiAccountRenameBody, kimiEffortOf, kimiLoginFinal, kimiLoginId, kimiVerificationUrl, type KimiAccount, type KimiLogin } from "../src/shared/kimiAccounts";
import { accountsNeedingLogin, activeLogin, countdown, kimiAccountState, loginView, nextPollMs, sortKimiAccounts } from "../src/renderer/src/modules/kimi-accounts/accountView";
import { kimiAccountOptions } from "../src/renderer/src/lib/kimiAccounts";
import { OWNER_ONLY_CAPABILITIES } from "../src/shared/users";

const login = (over: Partial<KimiLogin> = {}): KimiLogin => ({ loginId: `kl-${"a".repeat(32)}`, accountId: "ka-work", state: "pending", verificationUri: "https://www.kimi.com/code/authorize_device?user_code=WXYZ-2345", userCode: "WXYZ-2345", expiresAt: "2026-10-27T10:15:00Z", interval: 5, startedAt: null, finishedAt: null, error: null, ...over });
const account = (over: Partial<KimiAccount> = {}): KimiAccount => ({ id: "ka-work", label: "Work", kind: "subscription", region: "mainland-cn", home: null, createdAt: null, credentialsPresent: true, status: { state: "loggedIn", loggedIn: true, expiresAt: null, scope: null, checkedAt: null }, login: null, models: [], profiles: [], sessions: { active: 0, online: 0, retired: 0 }, removable: true, ...over });

describe("request bodies (main)", () => {
  it("ids and labels", () => {
    expect(kimiAccountId("ka-abc123")).toBe("ka-abc123");
    expect(() => kimiAccountId("ca-abc")).toThrow();
    expect(() => kimiAccountId("ka-../x")).toThrow();
    expect(kimiLoginId(`kl-${"0f".repeat(16)}`)).toMatch(/^kl-/);
    expect(() => kimiLoginId("kl-xyz")).toThrow();
  });

  it("create: label + optional region, nothing else", () => {
    expect(kimiAccountCreateBody({ label: "  Work ", region: "global", token: "x" })).toEqual({ label: "Work", region: "global" });
    expect(kimiAccountCreateBody({ label: "Work" })).toEqual({ label: "Work" });
    expect(() => kimiAccountCreateBody({ label: "" })).toThrow();
    expect(() => kimiAccountCreateBody({ label: "W", region: "mars" })).toThrow();
    expect(kimiAccountRenameBody(" New ")).toEqual({ label: "New" });
    expect(kimiEffortOf("medium")).toBe("medium");
    expect(kimiEffortOf("xhigh")).toBeUndefined();
  });

  it("only an https verification URL may be opened (loopback http for a debug cutex)", () => {
    expect(kimiVerificationUrl("https://www.kimi.com/code/authorize_device?user_code=A")).toMatch(/^https:/);
    expect(kimiVerificationUrl("http://127.0.0.1:41000/device")).toMatch(/^http:/);
    expect(kimiVerificationUrl("http://evil.example/device")).toBeNull();
    expect(kimiVerificationUrl("javascript:alert(1)")).toBeNull();
    expect(kimiVerificationUrl("file:///etc/passwd")).toBeNull();
    expect(kimiVerificationUrl(null)).toBeNull();
  });
});

describe("account state", () => {
  it("signed in, signed out, revoked, signing in", () => {
    expect(kimiAccountState(account())).toBe("loggedIn");
    expect(kimiAccountState(account({ credentialsPresent: false, status: { state: "loggedOut", loggedIn: false, expiresAt: null, scope: null, checkedAt: null } }))).toBe("loggedOut");
    expect(kimiAccountState(account({ credentialsPresent: false, status: { state: "revoked", loggedIn: false, expiresAt: null, scope: null, checkedAt: null } }))).toBe("revoked");
    expect(kimiAccountState(account({ login: login() }))).toBe("loggingIn");
    expect(kimiAccountState(account({ login: login({ state: "succeeded" }) }))).toBe("loggedIn");
    expect(activeLogin(account({ login: login({ state: "expired" }) }))).toBeNull();
  });

  it("counts accounts that need a login; signed-in ones sort first", () => {
    const out = account({ id: "ka-b", label: "A", credentialsPresent: false, status: { state: "revoked", loggedIn: false, expiresAt: null, scope: null, checkedAt: null } });
    expect(accountsNeedingLogin([account(), out])).toBe(1);
    expect(sortKimiAccounts([out, account()]).map((a) => a.id)).toEqual(["ka-work", "ka-b"]);
  });

  it("select options keep a chosen account the host no longer lists", () => {
    expect(kimiAccountOptions([account()], "ka-gone")).toEqual([{ id: "ka-work", label: "Work", ready: true, missing: false }, { id: "ka-gone", label: "ka-gone", ready: false, missing: true }]);
  });
});

describe("device-code login view", () => {
  const now = Date.parse("2026-10-27T10:00:00Z") / 1000;
  it("pending: URL, code and the time left", () => {
    const v = loginView(login(), now);
    expect(v).toMatchObject({ phase: "waiting", code: "WXYZ-2345", remaining: 900 });
    expect(v.url).toMatch(/^https:\/\/www\.kimi\.com/);
    expect(countdown(900)).toBe("15:00");
    expect(countdown(61)).toBe("1:01");
  });

  it("starting has no code yet; a non-https URL is never offered", () => {
    expect(loginView(login({ state: "starting", verificationUri: null, userCode: null }), now)).toMatchObject({ phase: "starting", url: null, code: null });
    expect(loginView(login({ verificationUri: "http://evil.example/x" }), now).url).toBeNull();
  });

  it("final states and their error", () => {
    for (const s of ["succeeded", "failed", "expired", "denied", "cancelled"]) {
      expect(kimiLoginFinal(s)).toBe(true);
      expect(loginView(login({ state: s }), now).phase).toBe(s);
    }
    expect(loginView(login({ state: "failed", error: { code: "kimi_login_failed", message: "denied" } }), now).error?.code).toBe("kimi_login_failed");
  });

  it("polls at cutex's interval (2–30 s), 1 s while starting, never after the end", () => {
    expect(nextPollMs(login({ interval: 5 }))).toBe(5000);
    expect(nextPollMs(login({ interval: 0 }))).toBe(2000);
    expect(nextPollMs(login({ interval: 600 }))).toBe(30000);
    expect(nextPollMs(login({ interval: null }))).toBe(5000);
    expect(nextPollMs(login({ state: "starting" }))).toBe(1000);
    expect(nextPollMs(login({ state: "succeeded" }))).toBeNull();
  });
});

describe("owner-only", () => {
  it("kimi-accounts is in the owner capability list (a non-owner connection never sees it)", () => {
    expect(OWNER_ONLY_CAPABILITIES).toContain(KIMI_ACCOUNTS_FEATURE);
  });
});
