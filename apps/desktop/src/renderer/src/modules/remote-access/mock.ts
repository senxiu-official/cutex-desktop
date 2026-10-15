// Browser-preview data for remote access (listen-settings view, device pairing, client tokens;
// dev/mockTypes.ts). The stored managementListen list lives in the core settings (PATCH /v2/settings).
// client-token-rename: this mock serves `renameClientToken` for every token list (MockCore clientTokenNames);
// desktops carry their own `desktop-…` labels (shown as 「WORKSTATION」, 「kai-laptop 上的 cutex_dev」).
import type { MockCore, ModuleMock } from "../../dev/mockTypes";

// listen-settings / device-pairing: what cutex derives from the stored list + the token store.
const MOCK_LISTEN_DEFAULT = ["127.0.0.1"];
const MOCK_CORS_DEFAULT = ["http://localhost", "https://localhost", "capacitor://localhost"];
// The same tokens as modules/users/mock.ts (the 用户 → 设备 list); 接入 lists them only on a host without
// cutex `users` (`?legacy`), otherwise it just links there.
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const mockClientTokens: import("../../../../shared/ipc").ClientTokenView[] = [
  { tokenId: "mct-1a2b3c4d5e6f7a8b", label: "Pixel 9", kind: "device", deviceName: "Pixel 9", platform: "android", createdAt: ago(3 * 86_400_000), lastUsedAt: ago(12 * 60_000), lastAddress: "100.64.0.7" },
  { tokenId: "mct-9f8e7d6c5b4a3f2e", label: "desktop-WORKSTATION-Cutex-4f9a1c", kind: "client", deviceName: null, platform: null, createdAt: ago(20 * 86_400_000), lastUsedAt: ago(86_400_000), lastAddress: "100.64.0.97" },
  { tokenId: "mct-3c4d5e6f7a8b9c0d", label: "Mia's iPad", kind: "device", deviceName: "iPad", platform: "ios", createdAt: ago(2 * 86_400_000), lastUsedAt: ago(3_600_000), lastAddress: "100.64.0.12" },
  { tokenId: "mct-5d6e7f8091a2b3c4", label: "desktop-mia-laptop-Cutex-71c0de", kind: "client", deviceName: null, ownerName: "Mia 的笔记本", platform: null, createdAt: ago(2 * 86_400_000), lastUsedAt: ago(120_000), lastAddress: "100.64.0.15" },
  { tokenId: "mct-7e6d5c4b3a291807", label: "desktop-kai-laptop-cutex_dev-3b7e02", kind: "client", deviceName: null, platform: null, createdAt: ago(40 * 60_000), lastUsedAt: ago(30 * 60_000), lastAddress: "100.64.0.31" },
  { tokenId: "mct-0a1b2c3d4e5f6071", label: "Galaxy Tab", kind: "device", deviceName: "Galaxy Tab S10", platform: "android", createdAt: ago(5 * 60_000), lastUsedAt: null, lastAddress: null },
];
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
export const mock: ModuleMock = {
  features: { new: ["client-token-rename"] },
  api: (core) => {
    core.clientTokenNames.register({
      rename(tokenId, ownerName) {
        const token = mockClientTokens.find((t) => t.tokenId === tokenId);
        if (!token) return false;
        token.ownerName = ownerName;
        return true;
      },
    });
    return {
      async createPairingCode(label) {
        const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        const raw = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
        const urls = ["http://100.101.102.103:24270", "http://host-a.tail1234.ts.net:24270"];
        const qr = `cutex-pair:v1?h=HOST-A&` + urls.map((u) => `u=${encodeURIComponent(u)}`).join("&") + `&c=${raw}`;
        // ?pairdemo: a phone pairs 8 s after the code is shown.
        if (new URLSearchParams(location.search).has("pairdemo")) {
          setTimeout(() => mockClientTokens.push({ tokenId: `mct-${raw.toLowerCase()}00000000`, label: label ?? "iPhone", kind: "device", deviceName: label ?? "iPhone", platform: "ios", createdAt: new Date().toISOString(), lastUsedAt: null, lastAddress: null }), 8000);
        }
        return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), label: label ?? null, hostId: "HOST-A", urls, qr };
      },
      async clientTokens() {
        return structuredClone(mockClientTokens);
      },
      async revokeClientToken(tokenId) {
        const i = mockClientTokens.findIndex((t) => t.tokenId === tokenId);
        if (i < 0) throw new Error("404 client_token_not_found");
        mockClientTokens.splice(i, 1);
      },
      async renameClientToken(tokenId, name) {
        return core.clientTokenNames.rename(tokenId, name);
      },
    };
  },
  settings: mockListenView,
};
