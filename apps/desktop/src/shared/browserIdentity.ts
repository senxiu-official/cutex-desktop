// 浏览器身份 (browser identities: Edge-style profiles of the owner's browser), its history, search and saved passwords —
// the shared contract (design: artifact browser-profiles-design v3). One identity = one set of logins: a persistent
// partition per (identity, host). The default identity 「个人」 is today's owner partition. The agent pool is not an
// identity. Main owns everything here; the renderer gets display views only (never a cookie, never a password unless
// the owner asked to show one after the store's system check).
//
// Code names: "browser identity" (owner-facing 浏览器身份). Not "profile" (an agent Profile) and not the tab's
// provenance `BrowserMountIdentity` in ./browser.

export const BROWSER_IDENTITY_CHANNEL = "cutex-desktop:browser-identity";

/** The identity behind today's owner partition `persist:browser-<hostId>`; cannot be deleted. */
export const DEFAULT_BROWSER_IDENTITY_ID = "default";
/** Main-minted ids of the other identities, immutable; partitions `persist:browser-id-<id>-<hostId>`. New ids are 32 lowercase
 *  hex (cutex r297 `browser-identity-sync-v1` ids); 8 hex stays accepted. Sync carries only id / name / color / revision /
 *  deletions; initial, current choice, tabs, cookies, permissions, search, history and passwords stay on this desktop. */
export const BROWSER_IDENTITY_ID = /^(?:default|[a-f0-9]{8}|[a-f0-9]{32})$/;
export const isBrowserIdentityId = (v: unknown): v is string => typeof v === "string" && BROWSER_IDENTITY_ID.test(v);

/** Tab-tint colours (light + dark pairs live in the renderer theme). No red (danger / close confirm), no emerald (busy dot). */
export const BROWSER_IDENTITY_COLORS = ["teal", "violet", "orange", "indigo", "pink", "slate"] as const;
export type BrowserIdentityColor = typeof BROWSER_IDENTITY_COLORS[number];
export const isBrowserIdentityColor = (v: unknown): v is BrowserIdentityColor => typeof v === "string" && (BROWSER_IDENTITY_COLORS as readonly string[]).includes(v);
export const BROWSER_IDENTITY_NAME_MAX = 40;

export interface BrowserIdentityView {
  id: string;
  name: string;
  /** null: the default identity, drawn untinted (exactly today's look). */
  color: BrowserIdentityColor | null;
  /** One character shown in the switcher / settings (the owner may change it; default: the name's first character). */
  initial: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  /** Bumps on every change (sync, revision-guarded edits). */
  revision: number;
  /** Hosts whose partition of this identity holds data (as far as main knows). */
  hosts: string[];
  /** Open owner tabs of this identity, all windows and hosts. */
  openTabs: number;
}

export interface BrowserIdentityState {
  identities: BrowserIdentityView[];
  /** The identity new owner tabs use (the switcher's choice). */
  current: string;
}

export interface BrowserIdentityStorage {
  hostId: string;
  /** Partition directory minus cache; null: not measurable. */
  siteDataBytes: number | null;
  cacheBytes: number | null;
}

export type BrowserClearDataType = "siteData" | "cache" | "history";
/** Only history honours a range (Electron's session.clearData has none). */
export const BROWSER_HISTORY_RANGES = ["hour", "day", "week", "month", "all"] as const;
export type BrowserHistoryRange = typeof BROWSER_HISTORY_RANGES[number];

export interface BrowserClearDataRequest {
  identityId: string;
  /** One host, or every host this identity has data on. */
  hostId: string | "all";
  types: BrowserClearDataType[];
  /** Exact origins (https://example.com); absent = every site. */
  origins?: string[];
  /** History only; absent = all. */
  historyRange?: BrowserHistoryRange;
}

export type BrowserHistoryTransition = "typed" | "link" | "reload" | "backForward" | "other";
export interface BrowserHistoryEntry {
  id: string;
  identityId: string;
  hostId: string;
  url: string;
  title: string;
  /** Epoch milliseconds. */
  visitedAt: number;
  transition: BrowserHistoryTransition;
}
export interface BrowserHistoryQuery {
  identityId: string;
  hostId: string;
  /** Matches title or URL (case-insensitive substring). */
  text?: string;
  /** Cursor: entries strictly older than this visitedAt. */
  before?: number;
  /** 1..200, default 100. */
  limit?: number;
}
export interface BrowserHistoryPage {
  entries: BrowserHistoryEntry[];
  nextBefore: number | null;
}
export interface BrowserTopSite {
  url: string;
  title: string;
  visits: number;
}
export type BrowserHistoryDelete =
  | { identityId: string; hostId: string; ids: string[] }
  | { identityId: string; hostId: string; origin: string };

export const BROWSER_HISTORY_RETENTIONS = ["30d", "90d", "1y", "off"] as const;
export type BrowserHistoryRetention = typeof BROWSER_HISTORY_RETENTIONS[number];

export const BROWSER_SEARCH_ENGINES = ["google", "bing", "duckduckgo", "baidu"] as const;
export type BrowserSearchEngine = typeof BROWSER_SEARCH_ENGINES[number];
/** `%s` = the encoded query. */
export const BROWSER_SEARCH_URLS: Record<BrowserSearchEngine, string> = {
  google: "https://www.google.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  duckduckgo: "https://duckduckgo.com/?q=%s",
  baidu: "https://www.baidu.com/s?wd=%s",
};
export const browserSearchUrl = (engine: BrowserSearchEngine, query: string): string => BROWSER_SEARCH_URLS[engine].replace("%s", encodeURIComponent(query));

/** Global (all identities) preferences of this desktop. */
export interface BrowserIdentityPrefs {
  searchEngine: BrowserSearchEngine;
  historyRetention: BrowserHistoryRetention;
  /** 「登录时询问是否保存密码」 */
  offerSavePasswords: boolean;
  /** 「点到登录框时提示已保存的登录」 */
  offerFillPasswords: boolean;
  /** 「验证后 5 分钟内不再问」: Windows Hello grace in main memory only (default off: Hello before every fill / show / copy). */
  passwordHelloGrace: boolean;
}
export const DEFAULT_BROWSER_IDENTITY_PREFS: BrowserIdentityPrefs = { searchEngine: "google", historyRetention: "90d", offerSavePasswords: true, offerFillPasswords: true, passwordHelloGrace: false };

/**
 * The secure store's state. Entries are encrypted with a key only Windows Hello unlocks: after a Hello reset, on a new
 * PC or without Hello they cannot be read (only deleted and saved again) — the UI says so plainly.
 */
export interface BrowserPasswordStoreStatus {
  available: boolean;
  reason?: "noHello" | "noKeyring" | "unsupported";
  keyLost: boolean;
  /** Entries that can no longer be decrypted. */
  unreadable: number;
  graceMinutes: 0 | 5;
}

/** A saved login as the renderer sees it: never the password. */
export interface BrowserSavedLoginView {
  id: string;
  identityId: string;
  origin: string;
  username: string;
  createdAt: number;
  updatedAt: number;
}

/** Main asks the owner whether to save (or update) what they just submitted. Password stays in main. */
export interface BrowserPasswordPromptView {
  promptId: string;
  hostId: string;
  tabKey: string;
  identityId: string;
  origin: string;
  username: string;
  kind: "save" | "update";
}
export type BrowserPasswordPromptChoice = "save" | "notNow" | "never";

/** Owner's native click into a login field: the logins main can fill (usernames only), drawn by the app at `field`. */
export interface BrowserFillOfferView {
  offerId: string;
  hostId: string;
  tabKey: string;
  identityId: string;
  origin: string;
  /** CSS pixels relative to the guest's viewport. */
  field: { x: number; y: number; width: number; height: number };
  logins: { id: string; username: string }[];
  /** The tab is granted to an agent: no fill (it could read the page); the UI offers 收回并填写. */
  grantedTo?: { agentName: string };
}

export type BrowserIdentityEvent =
  | { kind: "identities"; state: BrowserIdentityState }
  | { kind: "history"; identityId: string; hostId: string }
  | { kind: "passwords"; identityId: string }
  | { kind: "passwordPrompt"; prompt: BrowserPasswordPromptView }
  | { kind: "passwordPromptClosed"; promptId: string }
  | { kind: "fillOffer"; offer: BrowserFillOfferView }
  | { kind: "fillOfferClosed"; offerId: string };

export type BrowserIdentityRequest =
  | { op: "state" }
  | { op: "create"; name: string; color: BrowserIdentityColor; initial?: string }
  | { op: "update"; id: string; expectedRevision: number; name?: string; color?: BrowserIdentityColor; initial?: string }
  | { op: "setCurrent"; id: string }
  | { op: "signOut"; id: string }
  | { op: "remove"; id: string }
  | { op: "storage"; id: string }
  | { op: "signedInSites"; id: string; hostId: string }
  | { op: "clearData"; request: BrowserClearDataRequest }
  | { op: "prefs"; patch?: Partial<BrowserIdentityPrefs> }
  | { op: "history"; query: BrowserHistoryQuery }
  | { op: "topSites"; identityId: string; hostId: string; limit?: number }
  | { op: "historyDelete"; target: BrowserHistoryDelete }
  | { op: "passwords"; identityId: string }
  | { op: "passwordUpdate"; id: string; username: string }
  | { op: "passwordRemove"; id: string }
  /** Main shows the value in its own native dialog after Windows Hello; nothing returns to the renderer. */
  | { op: "passwordReveal"; id: string }
  | { op: "passwordStatus" }
  /** Main writes the clipboard itself and clears it after 30 s (the secret never reaches the renderer). */
  | { op: "passwordCopy"; id: string }
  | { op: "neverSave"; identityId: string; remove?: string }
  | { op: "promptAnswer"; promptId: string; choice: BrowserPasswordPromptChoice }
  /** The owner's click on one login of an offer (main re-checks owner input, origin, grant). */
  | { op: "fill"; offerId: string; loginId: string }
  | { op: "dismissOffer"; offerId: string };

/** window.cutex.browser.identities (optional: older preloads / test mocks lack it). */
export interface BrowserIdentityBridge {
  state(): Promise<BrowserIdentityState>;
  create(name: string, color: BrowserIdentityColor, initial?: string): Promise<BrowserIdentityView>;
  update(id: string, expectedRevision: number, change: { name?: string; color?: BrowserIdentityColor; initial?: string }): Promise<BrowserIdentityView>;
  setCurrent(id: string): Promise<BrowserIdentityState>;
  /** Closes its tabs and clears every host partition of it; the identity stays. */
  signOut(id: string): Promise<void>;
  /** signOut + its history and passwords + the entry (not the default identity). */
  remove(id: string): Promise<void>;
  storage(id: string): Promise<BrowserIdentityStorage[]>;
  /** Cookie domains only (never values), at most 50. */
  signedInSites(id: string, hostId: string): Promise<string[]>;
  clearData(request: BrowserClearDataRequest): Promise<void>;
  prefs(patch?: Partial<BrowserIdentityPrefs>): Promise<BrowserIdentityPrefs>;
  history(query: BrowserHistoryQuery): Promise<BrowserHistoryPage>;
  topSites(identityId: string, hostId: string, limit?: number): Promise<BrowserTopSite[]>;
  historyDelete(target: BrowserHistoryDelete): Promise<void>;
  passwords(identityId: string): Promise<BrowserSavedLoginView[]>;
  passwordUpdate(id: string, username: string): Promise<void>;
  passwordRemove(id: string): Promise<void>;
  /** Main's native dialog after Windows Hello; the password never reaches the renderer. */
  passwordReveal(id: string): Promise<void>;
  passwordStatus(): Promise<BrowserPasswordStoreStatus>;
  passwordCopy(id: string): Promise<void>;
  neverSave(identityId: string, remove?: string): Promise<string[]>;
  promptAnswer(promptId: string, choice: BrowserPasswordPromptChoice): Promise<void>;
  fill(offerId: string, loginId: string): Promise<void>;
  dismissOffer(offerId: string): Promise<void>;
  subscribe(listener: (event: BrowserIdentityEvent) => void): () => void;
}

// ---- validation (main parses every request; the renderer may use the same checks) ----

const ORIGIN = /^https?:\/\/[^\s/?#]{1,253}$/;
export const isBrowserOrigin = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && ORIGIN.test(v);
const HOST_ID = /^(?:local|(?:ssh|dev)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,127})$/;
const isHostId = (v: unknown): v is string => typeof v === "string" && HOST_ID.test(v);
const isToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(v);
const isName = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= BROWSER_IDENTITY_NAME_MAX && !/[\x00-\x1f\x7f]/.test(v);
const isInitial = (v: unknown): v is string => typeof v === "string" && [...v].length === 1 && !/[\s\x00-\x1f\x7f]/.test(v);
const isLimit = (v: unknown, max: number) => v === undefined || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max);
const keys = (o: Record<string, unknown>, allowed: string[], required: string[] = []) =>
  Object.keys(o).every((k) => allowed.includes(k)) && required.every((k) => k in o);

function parseClear(v: unknown): BrowserClearDataRequest | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!keys(o, ["identityId", "hostId", "types", "origins", "historyRange"], ["identityId", "hostId", "types"])) return null;
  if (!isBrowserIdentityId(o.identityId) || !(o.hostId === "all" || isHostId(o.hostId))) return null;
  const types = o.types;
  if (!Array.isArray(types) || !types.length || types.length > 3 || !types.every((t) => t === "siteData" || t === "cache" || t === "history") || new Set(types).size !== types.length) return null;
  if (o.origins !== undefined && (!Array.isArray(o.origins) || !o.origins.length || o.origins.length > 200 || !o.origins.every(isBrowserOrigin))) return null;
  if (o.historyRange !== undefined && !(BROWSER_HISTORY_RANGES as readonly unknown[]).includes(o.historyRange)) return null;
  return { identityId: o.identityId, hostId: o.hostId as string, types: types as BrowserClearDataType[], ...(o.origins ? { origins: o.origins as string[] } : {}), ...(o.historyRange ? { historyRange: o.historyRange as BrowserHistoryRange } : {}) };
}

function parsePrefs(v: unknown): Partial<BrowserIdentityPrefs> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!keys(o, ["searchEngine", "historyRetention", "offerSavePasswords", "offerFillPasswords", "passwordHelloGrace"])) return null;
  if (o.passwordHelloGrace !== undefined && typeof o.passwordHelloGrace !== "boolean") return null;
  if (o.searchEngine !== undefined && !(BROWSER_SEARCH_ENGINES as readonly unknown[]).includes(o.searchEngine)) return null;
  if (o.historyRetention !== undefined && !(BROWSER_HISTORY_RETENTIONS as readonly unknown[]).includes(o.historyRetention)) return null;
  if (o.offerSavePasswords !== undefined && typeof o.offerSavePasswords !== "boolean") return null;
  if (o.offerFillPasswords !== undefined && typeof o.offerFillPasswords !== "boolean") return null;
  return o as Partial<BrowserIdentityPrefs>;
}

/** Strict parse of one renderer request (unknown keys, bad ids and oversize values are refused). */
export function parseBrowserIdentityRequest(raw: unknown): BrowserIdentityRequest {
  const bad = () => new Error("invalid_browser_request");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad();
  const o = raw as Record<string, unknown>;
  switch (o.op) {
    case "state": case "passwordStatus":
      if (!keys(o, ["op"])) throw bad();
      return { op: o.op };
    case "create":
      if (!keys(o, ["op", "name", "color", "initial"], ["name", "color"]) || !isName(o.name) || !isBrowserIdentityColor(o.color) || (o.initial !== undefined && !isInitial(o.initial))) throw bad();
      return { op: "create", name: o.name.trim(), color: o.color, ...(o.initial !== undefined ? { initial: o.initial as string } : {}) };
    case "update": {
      if (!keys(o, ["op", "id", "expectedRevision", "name", "color", "initial"], ["id", "expectedRevision"]) || !isBrowserIdentityId(o.id) || !Number.isSafeInteger(o.expectedRevision) || (o.expectedRevision as number) < 0) throw bad();
      if ((o.name !== undefined && !isName(o.name)) || (o.color !== undefined && !isBrowserIdentityColor(o.color)) || (o.initial !== undefined && !isInitial(o.initial))) throw bad();
      if (o.name === undefined && o.color === undefined && o.initial === undefined) throw bad();
      return { op: "update", id: o.id, expectedRevision: o.expectedRevision as number, ...(o.name !== undefined ? { name: (o.name as string).trim() } : {}), ...(o.color !== undefined ? { color: o.color as BrowserIdentityColor } : {}), ...(o.initial !== undefined ? { initial: o.initial as string } : {}) };
    }
    case "setCurrent": case "signOut": case "remove": case "storage":
      if (!keys(o, ["op", "id"], ["id"]) || !isBrowserIdentityId(o.id)) throw bad();
      return { op: o.op, id: o.id };
    case "signedInSites":
      if (!keys(o, ["op", "id", "hostId"], ["id", "hostId"]) || !isBrowserIdentityId(o.id) || !isHostId(o.hostId)) throw bad();
      return { op: "signedInSites", id: o.id, hostId: o.hostId };
    case "clearData": {
      const request = keys(o, ["op", "request"], ["request"]) ? parseClear(o.request) : null;
      if (!request) throw bad();
      return { op: "clearData", request };
    }
    case "prefs": {
      if (!keys(o, ["op", "patch"])) throw bad();
      if (o.patch === undefined) return { op: "prefs" };
      const patch = parsePrefs(o.patch);
      if (!patch) throw bad();
      return { op: "prefs", patch };
    }
    case "history": {
      const q = o.query as Record<string, unknown> | undefined;
      if (!keys(o, ["op", "query"], ["query"]) || !q || typeof q !== "object" || Array.isArray(q) || !keys(q, ["identityId", "hostId", "text", "before", "limit"], ["identityId", "hostId"])) throw bad();
      if (!isBrowserIdentityId(q.identityId) || !isHostId(q.hostId) || (q.text !== undefined && (typeof q.text !== "string" || q.text.length > 300)) || (q.before !== undefined && (!Number.isSafeInteger(q.before) || (q.before as number) < 0)) || !isLimit(q.limit, 200)) throw bad();
      return { op: "history", query: q as unknown as BrowserHistoryQuery };
    }
    case "topSites":
      if (!keys(o, ["op", "identityId", "hostId", "limit"], ["identityId", "hostId"]) || !isBrowserIdentityId(o.identityId) || !isHostId(o.hostId) || !isLimit(o.limit, 24)) throw bad();
      return { op: "topSites", identityId: o.identityId, hostId: o.hostId, ...(o.limit !== undefined ? { limit: o.limit as number } : {}) };
    case "historyDelete": {
      const t = o.target as Record<string, unknown> | undefined;
      if (!keys(o, ["op", "target"], ["target"]) || !t || typeof t !== "object" || Array.isArray(t) || !isBrowserIdentityId(t.identityId) || !isHostId(t.hostId)) throw bad();
      if (keys(t, ["identityId", "hostId", "ids"], ["ids"]) && Array.isArray(t.ids) && t.ids.length > 0 && t.ids.length <= 500 && t.ids.every(isToken))
        return { op: "historyDelete", target: { identityId: t.identityId, hostId: t.hostId, ids: t.ids as string[] } };
      if (keys(t, ["identityId", "hostId", "origin"], ["origin"]) && isBrowserOrigin(t.origin))
        return { op: "historyDelete", target: { identityId: t.identityId, hostId: t.hostId, origin: t.origin } };
      throw bad();
    }
    case "passwords":
      if (!keys(o, ["op", "identityId"], ["identityId"]) || !isBrowserIdentityId(o.identityId)) throw bad();
      return { op: "passwords", identityId: o.identityId };
    case "passwordUpdate":
      if (!keys(o, ["op", "id", "username"], ["id", "username"]) || !isToken(o.id) || typeof o.username !== "string" || o.username.length > 300 || /[\x00-\x1f\x7f]/.test(o.username)) throw bad();
      return { op: "passwordUpdate", id: o.id, username: o.username };
    case "passwordRemove": case "passwordReveal": case "passwordCopy":
      if (!keys(o, ["op", "id"], ["id"]) || !isToken(o.id)) throw bad();
      return { op: o.op, id: o.id };
    case "neverSave":
      if (!keys(o, ["op", "identityId", "remove"], ["identityId"]) || !isBrowserIdentityId(o.identityId) || (o.remove !== undefined && !isBrowserOrigin(o.remove))) throw bad();
      return { op: "neverSave", identityId: o.identityId, ...(o.remove !== undefined ? { remove: o.remove as string } : {}) };
    case "promptAnswer":
      if (!keys(o, ["op", "promptId", "choice"], ["promptId", "choice"]) || !isToken(o.promptId) || !(o.choice === "save" || o.choice === "notNow" || o.choice === "never")) throw bad();
      return { op: "promptAnswer", promptId: o.promptId, choice: o.choice };
    case "fill":
      if (!keys(o, ["op", "offerId", "loginId"], ["offerId", "loginId"]) || !isToken(o.offerId) || !isToken(o.loginId)) throw bad();
      return { op: "fill", offerId: o.offerId, loginId: o.loginId };
    case "dismissOffer":
      if (!keys(o, ["op", "offerId"], ["offerId"]) || !isToken(o.offerId)) throw bad();
      return { op: "dismissOffer", offerId: o.offerId };
    default:
      throw bad();
  }
}

/** The partition of an identity on a host (default: today's owner partition, unchanged). */
export function browserIdentityPartition(identityId: string, hostId: string): string {
  if (!isBrowserIdentityId(identityId) || !HOST_ID.test(hostId)) throw new Error("Invalid browser identity or host");
  return identityId === DEFAULT_BROWSER_IDENTITY_ID ? `persist:browser-${hostId}` : `persist:browser-id-${identityId}-${hostId}`;
}
