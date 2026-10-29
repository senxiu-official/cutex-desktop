// Browser-preview data for Settings → Profile → Kimi 账户 (`/v2/kimi/accounts`, shapes in shared/kimiAccounts.ts).
// "Work" is signed in (bound to the Kimi-kind Profile `kimi-work`, one agent), "Personal" was signed out (revoked).
// A login goes starting → pending (URL + code) → succeeded after a few polls; `?kimiLogin=hold` keeps it pending
// (screenshots), `?kimiLogin=pending` opens with Personal's login already pending, `?kimiLogin=fail` ends it expired.
// `?kimi=ready` reports the kimi-runtime component installed (capability `kimi-runtime`). Never a real Kimi login.
import { KIMI_ACCOUNTS_FEATURE, KIMI_RUNTIME_PROFILES_FEATURE, type KimiAccount, type KimiLogin } from "../../../../shared/kimiAccounts";
import type { ModuleMock } from "../../dev/mockTypes";

const QUERY = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const LOGIN_MODE = QUERY.get("kimiLogin");
const KIMI_READY = QUERY.get("kimi") === "ready";
const ROOT = "/home/owner/.config/cutex/kimi-accounts";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (offsetSec: number) => new Date(Date.now() + offsetSec * 1000).toISOString();

const MODELS: KimiAccount["models"] = [
  { id: "kimi-code/kimi-for-coding", displayName: "Kimi for Coding", inputModalities: ["text", "image"], supportedReasoningEfforts: ["off", "low", "medium", "high", "max"], defaultReasoningEffort: "high", isDefault: true },
  { id: "kimi-code/kimi-k3", displayName: "Kimi K3", inputModalities: ["text", "image"], supportedReasoningEfforts: ["off", "low", "medium", "high"], defaultReasoningEffort: "medium", isDefault: false },
];

function account(id: string, label: string, rest: Partial<KimiAccount>): KimiAccount {
  return { id, label, kind: "subscription", region: "mainland-cn", home: `${ROOT}/${id}`, createdAt: iso(-3 * 86400), credentialsPresent: false, status: { state: "loggedOut", loggedIn: false, expiresAt: null, scope: null, checkedAt: iso(-60) }, login: null, models: [], profiles: [], sessions: { active: 0, online: 0, retired: 0 }, removable: true, ...rest };
}

const accounts: KimiAccount[] = [
  account("ka-work7k2m9q", "Work", {
    credentialsPresent: true,
    status: { state: "loggedIn", loggedIn: true, expiresAt: iso(42 * 60), scope: "kimi-code", checkedAt: iso(-5 * 60) },
    models: MODELS,
    profiles: [{ id: "kimi-work", name: "kimi-work" }],
    sessions: { active: 1, online: 1, retired: 0 },
    removable: false,
  }),
  account("ka-pers3x8h1v", "Personal", { region: "global", status: { state: "revoked", loggedIn: false, expiresAt: null, scope: null, checkedAt: iso(-2 * 3600) } }),
];

/** Logins of this "daemon run" and how many polls each has seen. */
const logins = new Map<string, { login: KimiLogin; polls: number }>();

function newLogin(accountId: string): KimiLogin {
  const loginId = `kl-${Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
  return { loginId, accountId, state: "starting", verificationUri: null, userCode: null, expiresAt: null, interval: 2, startedAt: iso(0), finishedAt: null, error: null };
}

function advance(entry: { login: KimiLogin; polls: number }, a: KimiAccount): void {
  const l = entry.login;
  entry.polls++;
  if (l.state === "starting") {
    const host = a.region === "global" ? "www.kimi.ai" : "www.kimi.com";
    Object.assign(l, { state: "pending", userCode: "WXYZ-2345", verificationUri: `https://${host}/code/authorize_device?user_code=WXYZ-2345`, expiresAt: iso(15 * 60) });
  } else if (l.state === "pending" && LOGIN_MODE !== "hold" && LOGIN_MODE !== "pending" && entry.polls >= 4) {
    if (LOGIN_MODE === "fail") Object.assign(l, { state: "expired", finishedAt: iso(0), error: { code: "kimi_login_timeout", message: "device code expired" } });
    else {
      Object.assign(l, { state: "succeeded", finishedAt: iso(0) });
      Object.assign(a, { credentialsPresent: true, status: { state: "loggedIn", loggedIn: true, expiresAt: iso(60 * 60), scope: "kimi-code", checkedAt: iso(0) }, models: MODELS });
    }
  }
  a.login = structuredClone(l);
}

if (LOGIN_MODE === "pending") {
  const a = accounts[1]!;
  const entry = { login: newLogin(a.id), polls: 0 };
  advance(entry, a);
  logins.set(entry.login.loginId, entry);
}

const refusal = (code: string, message: string) => ({ ok: false as const, error: { code, message } });
const find = (id: string) => accounts.find((a) => a.id === id);

export const mock: ModuleMock = {
  features: { new: [KIMI_ACCOUNTS_FEATURE, KIMI_RUNTIME_PROFILES_FEATURE, ...(KIMI_READY ? ["kimi-runtime"] : [])] },
  api: (core) => ({
    async kimiAccounts() {
      await wait(200);
      if (core.legacy) return null;
      return { contractVersion: 2, accounts: structuredClone(accounts) };
    },
    async createKimiAccount(request) {
      await wait(250);
      if (accounts.some((a) => a.label.toLowerCase() === request.label.toLowerCase())) return refusal("kimi_account_label_taken", `a Kimi account labelled ${request.label} already exists`);
      const a = account(`ka-${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`, request.label, { region: request.region ?? "mainland-cn", createdAt: iso(0), status: { state: "loggedOut", loggedIn: false, expiresAt: null, scope: null, checkedAt: iso(0) } });
      accounts.push(a);
      return { ok: true as const, account: structuredClone(a) };
    },
    async renameKimiAccount(id, label) {
      await wait(200);
      const a = find(id);
      if (!a) return refusal("kimi_account_not_found", `no Kimi account ${id}`);
      a.label = label;
      return { ok: true as const, account: structuredClone(a) };
    },
    async deleteKimiAccount(id) {
      await wait(250);
      const i = accounts.findIndex((a) => a.id === id);
      const a = accounts[i];
      if (!a) return refusal("kimi_account_not_found", `no Kimi account ${id}`);
      if (!a.removable) return refusal("kimi_account_in_use", "Kimi account is in use");
      accounts.splice(i, 1);
      return { ok: true as const, removed: { id, removed: true as const, homeDeleted: false, keptHome: a.home } };
    },
    async checkKimiAccount(id) {
      await wait(400);
      const a = find(id);
      if (!a) return refusal("kimi_account_not_found", `no Kimi account ${id}`);
      a.status = { ...(a.status ?? { state: "loggedOut", loggedIn: false, expiresAt: null, scope: null }), checkedAt: iso(0) };
      return { ok: true as const, account: structuredClone(a) };
    },
    async logoutKimiAccount(id) {
      await wait(300);
      const a = find(id);
      if (!a) return refusal("kimi_account_not_found", `no Kimi account ${id}`);
      Object.assign(a, { credentialsPresent: false, status: { state: "revoked", loggedIn: false, expiresAt: null, scope: null, checkedAt: iso(0) } });
      return { ok: true as const, account: structuredClone(a) };
    },
    async startKimiLogin(id) {
      await wait(300);
      const a = find(id);
      if (!a) return refusal("kimi_account_not_found", `no Kimi account ${id}`);
      if (!KIMI_READY && !QUERY.has("kimiLogin")) return refusal("kimi_runtime_unavailable", "kimi-runtime component is not installed");
      const running = [...logins.values()].find((e) => e.login.accountId === id && (e.login.state === "starting" || e.login.state === "pending"));
      if (running) return { ok: true as const, login: structuredClone(running.login) };
      const entry = { login: newLogin(id), polls: 0 };
      logins.set(entry.login.loginId, entry);
      a.login = structuredClone(entry.login);
      return { ok: true as const, login: structuredClone(entry.login) };
    },
    async kimiLogin(id, loginId) {
      await wait(150);
      const a = find(id);
      const entry = logins.get(loginId);
      if (!a || !entry) return refusal("kimi_login_not_found", `no login ${loginId}`);
      advance(entry, a);
      return { ok: true as const, login: structuredClone(entry.login) };
    },
    async cancelKimiLogin(id, loginId) {
      await wait(150);
      const a = find(id);
      const entry = logins.get(loginId);
      if (!a || !entry) return refusal("kimi_login_not_found", `no login ${loginId}`);
      Object.assign(entry.login, { state: "cancelled", finishedAt: iso(0) });
      a.login = structuredClone(entry.login);
      return { ok: true as const, login: structuredClone(entry.login) };
    },
  }),
};
