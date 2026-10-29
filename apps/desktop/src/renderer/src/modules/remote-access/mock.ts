// Browser-preview data for remote access (listen-settings view, device pairing, client tokens;
// dev/mockTypes.ts). The stored managementListen list lives in the core settings (PATCH /v2/settings).
// client-token-rename: this mock serves `renameClientToken` for every token list (MockCore clientTokenNames);
// desktops carry their own `desktop-…` labels (shown as 「WORKSTATION」, 「kai-laptop 上的 cutex_dev」).
// Owner devices (cutex 21123b6): tokens carry `scope` / `issuedVia`; `updateClientToken` (name / scope)
// and `revokeClientToken` reach every token list (MockCore clientTokenNames); owner pairing codes live
// 5 minutes (`ownerDevice`); `?ownerdevice` (this desktop is a paired owner device on HOST-A) refuses
// a code with 403 owner_local_only {action: "pairingCode"}; `?scope=chat|read` refuses writes with
// device_scope_denied; `?noownerlocal`: an older cutex (none of the new fields).
// client-remote-close (用户 → 在线的桌面): this desktop (MOCK_SELF_INSTANCE) and host-a · cutex 桌面 0.1.5;
// 关闭 on host-a → closeRequested, 5 s later closing, then it leaves the list (its countdown ran out);
// `?closenoreply`: host-a never reports (the list gives up after 30 s with a timeout). Three remote rows:
// the current launch, a leftover of the previous launch of the same install (last heartbeat before the
// new launch connected: the list hides it) and a second install on the same device (a dev run with its
// own userData), whose owner cancels the countdown (关闭 there ends in 已取消).
// `?remoteclose`: host-a asks this desktop to close (dev/mockRemoteClose.ts).
// client-presence-lifecycle (r264; `?nolifecycle` = a cutex with remote close but without it): cutex already
// replaced the remote leftover (no such row), a closed desktop leaves with `stateChanged` exited, a cancelled
// one shows as online again; `?peerexit[=s]`: host-a quits normally s seconds (default 8) after start
// (`closing exited` → its row leaves at once).
import type { MockCore, ModuleMock } from "../../dev/mockTypes";
import type { OnlineClient } from "@cutex-desktop/cutex-client";

// listen-settings / device-pairing: what cutex derives from the stored list + the token store.
const MOCK_LISTEN_DEFAULT = ["127.0.0.1"];
const MOCK_CORS_DEFAULT = ["http://localhost", "https://localhost", "capacitor://localhost"];
// The same tokens as modules/users/mock.ts (the 用户 → 设备 list); 接入 lists them only on a host without
// cutex `users` (`?legacy`), otherwise it just links there.
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const query = () => (typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams());
/** `?noownerlocal`: a cutex before owner devices (no scope / issuedVia / ttlSeconds / ownerDevice). */
const NO_OWNER_LOCAL = query().has("noownerlocal");
const LIFECYCLE = !query().has("nolifecycle");
type Scope = "full" | "chat" | "read";
const owned = (scope: Scope, issuedVia: "hostCli" | "pairing") => (NO_OWNER_LOCAL ? {} : { scope, issuedVia });
const mockClientTokens: import("../../../../shared/ipc").ClientTokenView[] = [
  { tokenId: "mct-1a2b3c4d5e6f7a8b", label: "Pixel 9", kind: "device", deviceName: "Pixel 9", platform: "android", createdAt: ago(3 * 86_400_000), lastUsedAt: ago(12 * 60_000), lastAddress: "100.64.0.7", ...owned("full", "pairing") },
  { tokenId: "mct-9f8e7d6c5b4a3f2e", label: "desktop-WORKSTATION-Cutex-4f9a1c", kind: "client", deviceName: null, platform: null, createdAt: ago(20 * 86_400_000), lastUsedAt: ago(86_400_000), lastAddress: "100.64.0.97", ...owned("full", "hostCli") },
  { tokenId: "mct-3c4d5e6f7a8b9c0d", label: "Mia's iPad", kind: "device", deviceName: "iPad", platform: "ios", createdAt: ago(2 * 86_400_000), lastUsedAt: ago(3_600_000), lastAddress: "100.64.0.12", ...owned("chat", "pairing") },
  { tokenId: "mct-5d6e7f8091a2b3c4", label: "desktop-mia-laptop-Cutex-71c0de", kind: "client", deviceName: null, ownerName: "Mia 的笔记本", platform: null, createdAt: ago(2 * 86_400_000), lastUsedAt: ago(120_000), lastAddress: "100.64.0.15", ...owned("full", "hostCli") },
  { tokenId: "mct-7e6d5c4b3a291807", label: "desktop-kai-laptop-cutex_dev-3b7e02", kind: "client", deviceName: null, platform: null, createdAt: ago(40 * 60_000), lastUsedAt: ago(30 * 60_000), lastAddress: "100.64.0.31", ...owned("full", "hostCli") },
  { tokenId: "mct-0a1b2c3d4e5f6071", label: "Galaxy Tab", kind: "device", deviceName: "Galaxy Tab S10", platform: "android", createdAt: ago(5 * 60_000), lastUsedAt: null, lastAddress: null, ...owned("read", "pairing") },
  // owner-device-notice: the owner's new phone, paired 10 minutes ago (modules/users/mock.ts lists it as unacknowledged).
  { tokenId: "mct-6f7a8b9c0d1e2f30", label: "iPhone 16", kind: "device", deviceName: "iPhone 16", platform: "ios", createdAt: ago(10 * 60_000), lastUsedAt: ago(4 * 60_000), lastAddress: "100.64.0.21", ...owned("full", "pairing") },
];
/** This connection's scope on HOST-A (`?scope=chat|read`; dev/mockBridge.ts mockConnectionUser). */
const connectionScope = (): Scope => (NO_OWNER_LOCAL ? "full" : ((["chat", "read"] as const).find((v) => v === query().get("scope")) ?? "full"));
/** `?ownerdevice` (no value / `local`): this desktop reaches HOST-A with a paired owner device token (not owner-local). */
const pairedHere = () => !NO_OWNER_LOCAL && query().has("ownerdevice") && (query().get("ownerdevice") || "local") === "local";
const scopeDenied = (required: Scope) => new Error(`device_scope_denied: this device's scope (${connectionScope()}) does not allow this (needs ${required})`);
function mockListenView(core: MockCore) {
  const list = (core.settings.managementListen as string[] | null) ?? MOCK_LISTEN_DEFAULT;
  const rows = list.map((entry) => {
    const lower = entry.toLowerCase();
    const port = Number(/:(\d+)$/.exec(entry)?.[1] ?? 24270);
    const host = lower.startsWith("tailscale") ? "tailscale" : entry.replace(/^\[|\](:\d+)?$/g, "").replace(/:\d+$/, "");
    const kind = host === "tailscale" ? "tailscale" : host === "127.0.0.1" || host === "::1" ? "loopback" : host === "0.0.0.0" || host === "::" ? "wildcard" : "address";
    return { entry, kind, port, warning: kind === "wildcard" ? "listens on every network interface (LAN, VPN and public networks); only client / device tokens are accepted remotely" : null };
  });
  return {
    managementListenDefault: MOCK_LISTEN_DEFAULT,
    managementListenEntries: rows,
    managementListenActiveRemote: ["100.101.102.103:24270"],
    managementCorsOriginsDefault: MOCK_CORS_DEFAULT,
    remoteAccess: { clientTokens: mockClientTokens.length, devices: mockClientTokens.filter((t) => t.kind === "device").length },
  };
}
/** This preview desktop's instance id — the same literal as dev/mockRemoteClose.ts (neither may import the other). */
const MOCK_SELF_INSTANCE = "5b1e0c7a-0000-4000-8000-00000000self";

// client-remote-close: the desktops registered on HOST-A.
const mockDesktops: OnlineClient[] = [
  { instanceId: MOCK_SELF_INSTANCE, installId: "mock-install-self", appName: "cutex-desktop", appVersion: "0.1.6", deviceName: "sam-laptop", platform: "linux", userId: "owner", tokenId: null, local: true, connectedSince: ago(2 * 3_600_000), lastSeen: ago(20_000), allowRemoteClose: true, state: "online", current: true },
  { instanceId: "9d2c41e8-7a55-4c3b-9e0f-2b8e5d7c1a40", installId: "mock-install-host-a", appName: "cutex-desktop", appVersion: "0.1.5", deviceName: "host-a", platform: "win32", userId: "owner", tokenId: "mct-9f8e7d6c5b4a3f2e", local: false, connectedSince: ago(26 * 3_600_000), lastSeen: ago(45_000), allowRemoteClose: true, state: "online", current: false },
];

// remote: this launch connected 70 s ago; the previous launch of the same install last beat 80 s before that.
const TETHYS_STARTED = Date.now() - 70_000;
const at = (ms: number) => new Date(ms).toISOString();
mockDesktops.push(
  { instanceId: "3f6a9b20-1c4d-4e8f-a7b5-6d2e0c9f1a33", installId: "mock-install-remote", appName: "cutex-desktop", appVersion: "0.2.1", deviceName: "remote", platform: "linux", userId: "owner", tokenId: "mct-7e6d5c4b3a291807", local: false, connectedSince: at(TETHYS_STARTED), lastSeen: ago(20_000), allowRemoteClose: true, state: "online", current: false },
  // The previous launch of the same install: a lifecycle host removed it when the new launch registered.
  ...(LIFECYCLE ? [] : [{ instanceId: "c81e44d0-9a2b-4f6c-8e1d-3b7a5c0d2e91", installId: "mock-install-remote", appName: "cutex-desktop", appVersion: "0.2.0", deviceName: "remote", platform: "linux", userId: "owner", tokenId: "mct-7e6d5c4b3a291807", local: false, connectedSince: at(TETHYS_STARTED - 5 * 3_600_000), lastSeen: at(TETHYS_STARTED - 80_000), allowRemoteClose: true, state: "online", current: false } satisfies OnlineClient]),
  { instanceId: "e2d7f051-6b3a-4c9e-b8f2-71a0c4d5e6f7", installId: "mock-install-remote-dev", appName: "cutex-desktop", appVersion: "0.2.1", deviceName: "remote", platform: "linux", userId: "owner", tokenId: "mct-7e6d5c4b3a291807", local: false, connectedSince: ago(40 * 60_000), lastSeen: ago(30_000), allowRemoteClose: true, state: "online", current: false },
);
/** Rows whose `lastSeen` stays as stored (the leftover stopped beating). */
const STOPPED = new Set(["c81e44d0-9a2b-4f6c-8e1d-3b7a5c0d2e91"]);
/** The remote dev run: its owner cancels the countdown. */
const CANCELS = new Set(["e2d7f051-6b3a-4c9e-b8f2-71a0c4d5e6f7"]);

/** A lifecycle host: the desktop reported `closing exited` — the row goes at once, with `stateChanged` exited. */
function exited(core: MockCore, instanceId: string): void {
  const i = mockDesktops.findIndex((d) => d.instanceId === instanceId);
  if (i < 0) return;
  mockDesktops.splice(i, 1);
  core.emitHost("cutex/client/stateChanged", { instanceId, state: "exited" });
}

function onlineClientsApi(core: MockCore) {
  const refuse = (code: string, message: string) => ({ ok: false as const, error: { code, message } });
  const setState = (instanceId: string, state: OnlineClient["state"]) => {
    const row = mockDesktops.find((d) => d.instanceId === instanceId);
    if (!row) return;
    row.state = state;
    core.emitHost("cutex/client/stateChanged", { instanceId, state });
  };
  return {
    async onlineClients() {
      return { ok: true as const, value: mockDesktops.map((d) => ({ ...structuredClone(d), lastSeen: d.state === "online" && !STOPPED.has(d.instanceId) ? new Date(Date.now() - (d.current ? 20_000 : 45_000)).toISOString() : d.lastSeen, self: d.instanceId === MOCK_SELF_INSTANCE })) };
    },
    async closeOnlineClient(instanceId: string) {
      if (instanceId === MOCK_SELF_INSTANCE) throw new Error("this desktop is closed from its own window");
      const row = mockDesktops.find((d) => d.instanceId === instanceId);
      if (!row) return refuse("client_not_found", "no such client");
      if (connectionScope() !== "full") return refuse("client_close_forbidden", "this device may not close clients");
      if (!row.allowRemoteClose) return refuse("remote_close_disabled", "this client does not allow remote close");
      core.emitHost("cutex/client/closeRequested", { instanceId, requestedBy: { deviceName: "sam-laptop", userId: "owner", local: true }, graceSeconds: 15, at: new Date().toISOString() });
      setState(instanceId, "closeRequested");
      if (CANCELS.has(instanceId)) {
        setTimeout(() => setState(instanceId, "cancelled"), 4000);
        return { ok: true as const, value: { instanceId, state: "closeRequested" as const } };
      }
      if (query().has("closenoreply")) return { ok: true as const, value: { instanceId, state: "closeRequested" as const } };
      setTimeout(() => setState(instanceId, "closing"), 5000);
      if (LIFECYCLE) {
        setTimeout(() => exited(core, instanceId), 6000);
        return { ok: true as const, value: { instanceId, state: "closeRequested" as const } };
      }
      setTimeout(() => {
        const i = mockDesktops.findIndex((d) => d.instanceId === instanceId);
        if (i >= 0 && mockDesktops[i]!.state === "closing") mockDesktops.splice(i, 1);
      }, 7000);
      return { ok: true as const, value: { instanceId, state: "closeRequested" as const } };
    },
  };
}

export const mock: ModuleMock = {
  features: { new: ["client-token-rename", "client-remote-close", ...(LIFECYCLE ? ["client-presence-lifecycle"] : [])] },
  start: (core) => {
    const peerExit = query().get("peerexit");
    if (peerExit === null || !LIFECYCLE || core.legacy) return;
    setTimeout(() => exited(core, "9d2c41e8-7a55-4c3b-9e0f-2b8e5d7c1a40"), (Number(peerExit) > 0 ? Number(peerExit) : 8) * 1000);
  },
  api: (core) => {
    core.clientTokenNames.register({
      rename(tokenId, ownerName) {
        const token = mockClientTokens.find((t) => t.tokenId === tokenId);
        if (!token) return false;
        token.ownerName = ownerName;
        return true;
      },
      setScope(tokenId, scope) {
        const token = mockClientTokens.find((t) => t.tokenId === tokenId);
        if (!token) return false;
        token.scope = scope;
        return true;
      },
      revoke(tokenId) {
        const i = mockClientTokens.findIndex((t) => t.tokenId === tokenId);
        if (i < 0) return false;
        mockClientTokens.splice(i, 1);
        return true;
      },
    });
    return {
      ...onlineClientsApi(core),
      async createPairingCode(label, userId, scope) {
        if (connectionScope() !== "full") throw scopeDenied("full");
        if (pairedHere()) throw new Error("owner_local_only: creating a pairing code is only allowed on the host itself or over SSH");
        if (scope !== undefined && !["full", "chat", "read"].includes(scope)) throw new Error("invalid_scope: scope must be full, chat or read");
        const ownerDevice = !userId || userId === "owner";
        const ttlSeconds = NO_OWNER_LOCAL || !ownerDevice ? 600 : 300;
        const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        const raw = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
        const urls = ["http://100.101.102.103:24270", "http://host-a.tail1234.ts.net:24270"];
        const qr = `cutex-pair:v1?h=HOST-A&` + urls.map((u) => `u=${encodeURIComponent(u)}`).join("&") + `&c=${raw}`;
        // ?pairdemo: a phone pairs 8 s after the code is shown.
        if (new URLSearchParams(location.search).has("pairdemo")) {
          setTimeout(() => mockClientTokens.push({ tokenId: `mct-${raw.toLowerCase()}00000000`, label: label ?? "iPhone", kind: "device", deviceName: label ?? "iPhone", platform: "ios", createdAt: new Date().toISOString(), lastUsedAt: null, lastAddress: null, ...owned(scope ?? "full", "pairing") }), 8000);
        }
        const fresh = NO_OWNER_LOCAL ? {} : { ttlSeconds, userId: userId ?? "owner", scope: scope ?? "full", ownerDevice };
        return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(), label: label ?? null, hostId: "HOST-A", urls, qr, ...(userId && NO_OWNER_LOCAL ? { userId } : {}), ...fresh };
      },
      async clientTokens() {
        return structuredClone(mockClientTokens);
      },
      async revokeClientToken(tokenId) {
        if (connectionScope() !== "full") throw scopeDenied("full");
        if (!core.clientTokenNames.revoke(tokenId)) throw new Error("client_token_not_found: no client token with this id");
      },
      async renameClientToken(tokenId, name) {
        return core.clientTokenNames.rename(tokenId, name);
      },
      // client-token-rename + device-scope: one PATCH; refusals as values (like main's usersCall).
      async updateClientToken(tokenId, patch) {
        const refuse = (code: string, message: string, access?: Record<string, string>) => ({ ok: false as const, error: { code, message, ...(access ? { access } : {}) } });
        if (connectionScope() !== "full") return refuse("device_scope_denied", "this device's scope does not allow this", { scope: connectionScope(), required: "full" });
        if (patch.scope !== undefined && !["full", "chat", "read"].includes(patch.scope)) return refuse("invalid_scope", "scope must be full, chat or read");
        if (patch.name === undefined && patch.scope === undefined) return refuse("invalid_request", "name or scope is required");
        try {
          const renamed = patch.name !== undefined ? core.clientTokenNames.rename(tokenId, patch.name) : null;
          if (patch.scope !== undefined && !core.clientTokenNames.setScope(tokenId, patch.scope)) throw new Error("client_token_not_found: no client token with this id");
          const token = mockClientTokens.find((t) => t.tokenId === tokenId);
          return { ok: true as const, value: { tokenId, ownerName: renamed ? renamed.ownerName : (token?.ownerName ?? null), scope: NO_OWNER_LOCAL ? null : (token?.scope ?? patch.scope ?? "full") } };
        } catch (e) {
          const text = e instanceof Error ? e.message : String(e);
          const code = /^([a-z_]+):/.exec(text)?.[1] ?? "invalid_request";
          return refuse(code, text.slice(code.length + 2));
        }
      },
    };
  },
  settings: mockListenView,
};
