// Preview is deliberately an inert browser card. The ordinary mock bridge has no browser namespace;
// BrowserBody shows its localized placeholder and never creates a webview / loads an external URL.
// The host reports browser-open-full-access (r236), so Settings → 浏览器 shows the full-access hint
// (`?legacy`: the older wording).
// `?browserBackground`: every browser card previews a background agent tab (main's offscreen
// carrier, 2026-10-18) with a locally drawn live thumbnail that ticks once per second.
// `?browserChrome=none|granted|operating|paused|pending` (`&browserPool=agent`, `&browserZoom=1.25`): every browser card
// shows an attached page in that control state, so the card's three rows can be looked at without a host (the buttons
// reach no bridge; a click reports a failure in the row).
// `&browserBlocked=open|noopen`: main refused an automatic navigation into a private origin — the in-tab notice, with or
// without 仍然打开 (which reaches no bridge here: clicking it shows the inline failure).
// `&browserNotice=certificate[,download,popup]`: main's one-click owner notices (ownerNotices.ts) on that page.
import type { ModuleMock } from "../../dev/mockTypes";
import { browserActivation, type BrowserTabView } from "../../../../shared/browser";
import { DEFAULT_BROWSER_IDENTITY_ID, DEFAULT_BROWSER_IDENTITY_PREFS, type BrowserHistoryEntry, type BrowserIdentityBridge, type BrowserIdentityEvent, type BrowserIdentityPrefs, type BrowserIdentityStorage, type BrowserIdentitySyncState, type BrowserIdentityView, type BrowserSavedLoginView } from "../../../../shared/browserIdentity";

// `?browserIdentities` (浏览器身份, package 0 skeleton): an in-memory identities / history / prefs / passwords bridge for
// the identity UI (switcher, settings, history page, password pages). The rest of the browser bridge is inert here.
export function mockBrowserIdentities(): BrowserIdentityBridge {
  const now = Date.now();
  const view = (id: string, name: string, color: BrowserIdentityView["color"], initial: string, openTabs: number): BrowserIdentityView =>
    ({ id, name, color, initial, isDefault: id === DEFAULT_BROWSER_IDENTITY_ID, createdAt: now - 864e5, updatedAt: now - 864e5, revision: 1, hosts: ["local"], openTabs });
  let identities = [view(DEFAULT_BROWSER_IDENTITY_ID, "个人", null, "人", 1), view("1a2b3c4d", "工作 Outlook", "teal", "工", 2), view("5e6f7a8b", "学校", "violet", "学", 1)];
  let current = "1a2b3c4d";
  let prefs: BrowserIdentityPrefs = { ...DEFAULT_BROWSER_IDENTITY_PREFS };
  const sites: [string, string][] = [["https://outlook.office.com/mail/", "邮件 - 工作 Outlook"], ["https://outlook.office.com/calendar/", "日历"], ["https://teams.microsoft.com/v2/", "Teams 聊天"], ["https://www.electronjs.org/docs/latest/api/session", "Electron session API"]];
  let history: BrowserHistoryEntry[] = Array.from({ length: 60 }, (_, i) => {
    const [url, title] = sites[i % sites.length] as [string, string];
    return { id: `h${i}`, identityId: "1a2b3c4d", hostId: "local", url, title, visitedAt: now - i * 47 * 60_000, transition: i % 3 ? "link" as const : "typed" as const };
  });
  let logins: BrowserSavedLoginView[] = [
    { id: "pw1", identityId: "1a2b3c4d", origin: "https://login.microsoftonline.com", username: "yang.j@company.com", createdAt: now - 5 * 864e5, updatedAt: now - 864e5 },
    { id: "pw2", identityId: "1a2b3c4d", origin: "https://login.microsoftonline.com", username: "it-admin@company.com", createdAt: now - 9 * 864e5, updatedAt: now - 9 * 864e5 },
  ];
  let never: Record<string, string[]> = { "1a2b3c4d": ["https://accounts.example.org"] };
  const listeners = new Set<(event: BrowserIdentityEvent) => void>();
  const state = () => ({ identities: structuredClone(identities), current });
  const emit = (event: BrowserIdentityEvent) => { for (const l of listeners) l(event); };
  const changed = () => { emit({ kind: "identities", state: state() }); return state(); };
  // `&browserPassword=save|update|fill|granted`: every preview tab gets that password prompt / fill offer.
  const pw = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("browserPassword");
  if (pw && typeof window !== "undefined") {
    const sent = new Set<string>();
    window.addEventListener("cutex-preview-browser-tab", (event) => {
      const { hostId, tabKey } = (event as CustomEvent<{ hostId: string; tabKey: string }>).detail;
      if (sent.has(tabKey)) return;
      sent.add(tabKey);
      setTimeout(() => {
        if (pw === "save" || pw === "update") emit({ kind: "passwordPrompt", prompt: { promptId: `preview-prompt-${tabKey}`, hostId, tabKey, identityId: "1a2b3c4d", origin: "https://login.microsoftonline.com", username: "sam@uni.example.edu", kind: pw } });
        else emit({ kind: "fillOffer", offer: { offerId: `preview-offer-${tabKey}`, hostId, tabKey, identityId: "1a2b3c4d", origin: "https://login.microsoftonline.com", field: { x: 40, y: 120, width: 280, height: 32 },
          logins: [{ id: "l1", username: "sam@uni.example.edu" }, { id: "l2", username: "sam.work@example.com" }], ...(pw === "granted" ? { grantedTo: { agentName: "Mika" } } : {}) } });
      }, 400);
    });
  }
  const find = (id: string) => { const v = identities.find((i) => i.id === id); if (!v) throw new Error("unknown_identity"); return v; };
  // 跨主机同步: two hosts (this one synced, the workstation at the limit), an identity another host deleted whose data
  // is still here (清除 / 暂不), and a rename arriving from another host a moment later. `&browserSync=reasons` adds
  // hosts without a switch (old cutex, not the owner's connection); `&browserSync=none` = a main without sync.
  const syncMode = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("browserSync");
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
  let sync: BrowserIdentitySyncState = {
    hosts: [
      { hostId: "local", state: "synced", lastSyncAt: minutesAgo(3) },
      { hostId: "ssh-7a3f01c2", state: "limit", lastSyncAt: minutesAgo(42) },
      ...(syncMode === "reasons" ? [{ hostId: "ssh-ae3e47b1", state: "unsupported" as const, lastSyncAt: null }, { hostId: "dev-preview", state: "notOwner" as const, lastSyncAt: null }] : []),
    ],
    cleanups: [{ identityId: "9c0d1e2f", name: "旧项目", color: "orange", deletionRevision: 7, hosts: ["local", "ssh-7a3f01c2"] }],
  };
  // Per identity: this computer, a configured SSH host, and a leftover of an SSH host removed before removals were tracked.
  const MB = 1024 * 1024;
  const stored: Record<string, BrowserIdentityStorage[]> = {};
  const storageOf = (id: string) => (stored[id] ??= [
    { hostId: "local", siteDataBytes: 13 * MB, cacheBytes: 173 * MB },
    { hostId: "ssh-7a3f01c2", siteDataBytes: 4 * MB, cacheBytes: 38 * MB },
    { hostId: "ssh-b79c33a8", siteDataBytes: 21 * MB, cacheBytes: null, removedHost: true },
  ]);
  const syncChanged = () => { emit({ kind: "sync", state: structuredClone(sync) }); return structuredClone(sync); };
  if (syncMode !== "none" && typeof window !== "undefined") setTimeout(() => {
    const school = identities.find((i) => i.id === "5e6f7a8b");
    if (school) { Object.assign(school, { name: "学校 · 研究生", revision: school.revision + 1 }); changed(); }
  }, 1500);
  return {
    state: async () => state(),
    create: async (name, color, initial) => { const v = view(Math.random().toString(16).slice(2, 10).padEnd(8, "0"), name, color, initial ?? [...name][0]!, 0); identities = [...identities, v]; changed(); return v; },
    update: async (id, expectedRevision, change) => {
      const v = find(id);
      if (v.revision !== expectedRevision) throw new Error("revision_conflict");
      Object.assign(v, change, { revision: v.revision + 1, updatedAt: Date.now() });
      changed(); return structuredClone(v);
    },
    setCurrent: async (id) => { find(id); current = id; return changed(); },
    signOut: async (id) => { find(id).openTabs = 0; changed(); },
    signOutHost: async (id, hostId) => { find(id); storageOf(id).forEach((s) => { if (s.hostId === hostId) Object.assign(s, { siteDataBytes: 0, cacheBytes: 0 }); }); changed(); },
    clearLeftover: async (id, hostId) => { find(id); stored[id] = storageOf(id).filter((s) => s.hostId !== hostId); changed(); },
    remove: async (id) => { if (id === DEFAULT_BROWSER_IDENTITY_ID) throw new Error("default_identity"); identities = identities.filter((i) => i.id !== id); if (current === id) current = DEFAULT_BROWSER_IDENTITY_ID; changed(); },
    storage: async (id) => structuredClone(storageOf(id)),
    signedInSites: async (id, hostId) => storageOf(id).some((s) => s.hostId === hostId && s.removedHost) ? [] : hostId === "local" ? ["outlook.office.com", "login.microsoftonline.com", "teams.microsoft.com"] : ["github.com", "outlook.office.com"],
    clearData: async (request) => {
      if (request.types.includes("history")) { history = history.filter((h) => h.identityId !== request.identityId); emit({ kind: "history", identityId: request.identityId, hostId: "local" }); }
    },
    prefs: async (patch) => (prefs = { ...prefs, ...patch }),
    history: async (query) => {
      const text = query.text?.toLowerCase();
      const rows = history.filter((h) => h.identityId === query.identityId && h.hostId === query.hostId && (query.before === undefined || h.visitedAt < query.before) && (!text || `${h.title} ${h.url}`.toLowerCase().includes(text)));
      const entries = rows.slice(0, query.limit ?? 100);
      return { entries, nextBefore: rows.length > entries.length ? entries.at(-1)!.visitedAt : null };
    },
    topSites: async (identityId, hostId, limit = 8) => sites.slice(0, limit).map(([url, title], i) => ({ url, title, visits: 20 - i })).filter(() => identityId !== "" && hostId !== ""),
    historyDelete: async (target) => { history = history.filter((h) => !("ids" in target ? target.ids.includes(h.id) : new URL(h.url).origin === target.origin)); emit({ kind: "history", identityId: target.identityId, hostId: target.hostId }); },
    passwords: async (identityId) => logins.filter((l) => l.identityId === identityId),
    passwordUpdate: async (id, username) => { logins = logins.map((l) => (l.id === id ? { ...l, username, updatedAt: Date.now() } : l)); },
    passwordRemove: async (id) => { logins = logins.filter((l) => l.id !== id); },
    passwordReveal: async () => {},
    passwordStatus: async () => ({ available: true, keyLost: false, unreadable: 0, graceMinutes: prefs.passwordHelloGrace ? 5 : 0 }),
    passwordCopy: async () => {},
    neverSave: async (identityId, remove) => (never[identityId] = (never[identityId] ?? []).filter((o) => o !== remove)),
    promptAnswer: async (promptId) => emit({ kind: "passwordPromptClosed", promptId }),
    fill: async (offerId) => emit({ kind: "fillOfferClosed", offerId }),
    dismissOffer: async (offerId) => emit({ kind: "fillOfferClosed", offerId }),
    syncState: async () => { if (syncMode === "none") throw new Error("unsupported_operation"); return structuredClone(sync); },
    setHostSync: async (hostId, enabled) => {
      sync = { ...sync, hosts: sync.hosts.map((h) => h.hostId === hostId ? { ...h, state: enabled ? "syncing" : "off" } : h) };
      return syncChanged();
    },
    confirmCleanup: async (identityId, deletionRevision) => {
      sync = { ...sync, cleanups: sync.cleanups.filter((c) => !(c.identityId === identityId && c.deletionRevision === deletionRevision)) };
      return syncChanged();
    },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}


function previewNotices(kinds: string[]): BrowserTabView["ownerNotices"] {
  const all = {
    certificate: { id: "preview-notice-certificate", kind: "certificate" as const, url: "https://10.0.0.1/cgi-bin/luci",
      detail: "3F:9A:0C:51:E2:7B:44:D8:19:A6:C3:72:5E:0B:8F:D1:26:4C:9E:B7:03:58:AA:E4:61:1D:F2:89:C5:37:6B:0E" },
    download: { id: "preview-notice-download", kind: "download" as const, url: "https://example.org/export/report-2026-11.csv", detail: "report-2026-11.csv" },
    popup: { id: "preview-notice-popup", kind: "popup" as const, url: "https://accounts.example.com/oauth/authorize?client_id=demo" },
  };
  return kinds.flatMap(kind => kind in all ? [all[kind as keyof typeof all]] : []);
}
// `&browserIdentity=1a2b3c4d,default,5e6f7a8b`: the preview tabs take these 浏览器身份 in turn.
let identityTurn = 0;
function previewIdentity(params: URLSearchParams): { browserIdentityId?: string } {
  const list = params.get("browserIdentity")?.split(",").filter(Boolean) ?? [];
  return list.length ? { browserIdentityId: list[identityTurn++ % list.length] } : {};
}
function previewChrome(params: URLSearchParams): void {
  const state = params.get("browserChrome");
  if (!state) return;
  browserActivation.complete(browserActivation.begin());
  window.addEventListener("cutex-preview-browser-tab", (event) => {
    const { hostId, tabKey, url } = (event as CustomEvent<{ hostId: string; tabKey: string; url: string }>).detail;
    const service = url.startsWith("cutex:service/");
    const lease = state === "none" ? undefined : { leaseId: "preview-lease", sessionId: "s-moth", agentName: "Moth", state: state === "pending" ? "pending" as const : "active" as const, origin: "owner" as const };
    const view: BrowserTabView = {
      hostId, tabKey, guestId: "preview-guest", pageGeneration: 1, status: "attached", loading: false, canGoBack: true, canGoForward: false,
      // `&browserBlank`: the page is about:blank (the new tab page of an owner tab).
      url: service ? url : params.has("browserBlank") ? "about:blank" : "https://example.org/research/notes", title: service ? "RNA velocity" : params.has("browserBlank") ? "" : "Research notes · Example",
      pool: params.get("browserPool") === "agent" ? "agent" : "owner", ...previewIdentity(params), zoom: Number(params.get("browserZoom")) || undefined, lease,
      control: lease && state !== "pending" ? { grantee: "Moth", state: state === "paused" ? "paused" : "granted", operating: state === "operating" } : undefined,
      ownerNotices: params.has("browserNotice") ? previewNotices(params.get("browserNotice")!.split(",")) : undefined,
      blockedNavigation: params.has("browserBlocked") ? { id: "preview-blocked-1", url: "http://10.0.0.20:8123/lovelace/0?kiosk", canOpen: params.get("browserBlocked") !== "noopen" } : undefined,
    };
    // browserCache.ts takes it (dev-only listener): a module mock reaches module state only through events.
    window.dispatchEvent(new CustomEvent("cutex-preview-browser-view", { detail: view }));
  });
}

function drawThumbnail(tick: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = 480; canvas.height = 270;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#fafafa"; g.fillRect(0, 0, 480, 270);
  g.fillStyle = `hsl(${(tick * 37) % 360} 60% 55%)`; g.fillRect(0, 0, 48, 48);
  g.fillStyle = "#222"; g.font = "18px sans-serif";
  g.fillText("Agent page (preview)", 24, 90);
  g.fillText(`step ${tick}`, 24, 120);
  return canvas.toDataURL("image/jpeg", 0.7);
}
export const mock: ModuleMock = {
  features: { new: ["browser-open-full-access"] },
  bridge() {
    // `?browserIdentities`: identities.ts takes this dev-only bridge while the preview has no browser bridge (set here,
    // before the modules start).
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("browserIdentities")) (window as { __cutexPreviewBrowserIdentities?: unknown }).__cutexPreviewBrowserIdentities = mockBrowserIdentities();
    return {};
  },
  start() {
    if (typeof document === "undefined") return;
    previewChrome(new URLSearchParams(location.search));
    if (!new URLSearchParams(location.search).has("browserBackground")) return;
    let tick = 0;
    // The preview has no browser bridge: hand the frame to thumbnails.ts's dev-only listener.
    const paint = () => { const image = drawThumbnail(++tick); if (image) window.dispatchEvent(new CustomEvent("cutex-preview-browser-thumbnail", { detail: image })); };
    paint(); setInterval(paint, 1000);
  },
};
