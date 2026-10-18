// Browser-preview data for proxy v1 (cutex proxy-modes / profile-proxy; dev/mockTypes.ts): the host proxy
// in `/v2/settings.proxy` (follow system detects an environment proxy) and each Profile's proxy. URLs
// are stored with their login like cutex and always shown without it.
import type { HostProxyPatch, HostProxyView, ProfileProxyPatch, ProfileProxyView } from "../../../../shared/proxy";
import type { ModuleMock } from "../../dev/mockTypes";

interface Stored {
  enabled: boolean;
  url: string | null;
  noProxy: string | null;
}
const SYSTEM = { url: "http://127.0.0.1:7890/", source: "environment" as const };
let host: Stored | null = null;
const profiles = new Map<string, Stored | null>([["GLM", { enabled: true, url: "http://alice:secret@10.0.0.2:3128", noProxy: null }]]);

function redact(url: string | null): { url: string | null; creds: boolean } {
  if (!url) return { url: null, creds: false };
  try {
    const u = new URL(url);
    const creds = !!(u.username || u.password);
    u.username = "";
    u.password = "";
    return { url: u.toString(), creds };
  } catch {
    return { url, creds: false };
  }
}
function check(url: string | null | undefined): string {
  if (!url || !/^(https?|socks5h?|socks4a?):\/\/[^/\s]+/i.test(url.trim())) throw new Error("400 invalid_request: Proxy URL must look like scheme://[user:password@]host[:port]");
  return url.trim();
}
function merge(current: Stored | null, patch: HostProxyPatch | ProfileProxyPatch, unset: string): Stored | null {
  if (patch.mode === unset) return null;
  // Like cutex: none remembers the manual address (validated), a bare manual restores it, url: null forgets it.
  if (patch.mode === "none") {
    const url = patch.url === undefined ? (current?.url ?? null) : patch.url === null ? null : check(patch.url);
    return { enabled: false, url, noProxy: url ? (patch.noProxy === undefined ? (current?.noProxy ?? null) : patch.noProxy) : null };
  }
  if (patch.mode !== "manual") throw new Error(`400 invalid_request: proxy.mode must be ${unset}, none or manual`);
  const kept = current;
  return { enabled: true, url: check(patch.url === undefined ? kept?.url : patch.url), noProxy: patch.noProxy === undefined ? (kept?.noProxy ?? null) : patch.noProxy };
}
function hostView(): HostProxyView {
  const r = redact(host?.url ?? null);
  const mode = !host ? "system" : host.enabled ? "manual" : "none";
  return {
    mode,
    url: r.url,
    urlHasCredentials: r.creds,
    noProxy: host?.noProxy ?? null,
    loopbackNoProxy: ["127.0.0.1", "localhost", "::1"],
    system: SYSTEM,
    pacSupported: false,
    editable: !new URLSearchParams(location.search).has("proxyReadOnly"),
    warning: host?.enabled && /^socks/i.test(host.url ?? "") ? "cutex's own downloads (upgrades, components, quota readers) need an http:// or https:// proxy; a SOCKS URL only reaches the runtimes" : null,
  };
}
function profileView(name: string): ProfileProxyView {
  const own = profiles.get(name) ?? null;
  const effective = own ?? host;
  const r = redact(own?.url ?? null);
  const e = redact(effective?.url ?? null);
  return {
    mode: !own ? "inherit" : own.enabled ? "manual" : "none",
    url: r.url,
    urlHasCredentials: r.creds,
    noProxy: own?.noProxy ?? null,
    effective: !effective ? { mode: "system", url: SYSTEM.url, source: "environment" } : effective.enabled ? { mode: "manual", url: e.url, source: "manual" } : { mode: "none", url: null, source: null },
    editable: true,
  };
}

export const mock: ModuleMock = {
  features: { new: ["proxy-modes", "profile-proxy"] },
  settings: () => ({ proxy: hostView() }),
  api: (core) => ({
    async patchProxySettings(patch) {
      if (new URLSearchParams(location.search).has("proxyReadOnly")) throw new Error("403 proxy_owner_credential_required: proxy settings can only be changed with the host's own credential");
      host = merge(host, patch, "system");
      console.info("[mock] PATCH /v2/settings proxy", { mode: patch.mode });
      return core.settingsView() as never;
    },
  }),
  profile: {
    fields: (p, core) => (core.legacy ? {} : { proxy: profileView(p.name) }),
    patch(p, body, core) {
      if (!("proxy" in body)) return [];
      if (core.legacy) throw new Error("400 invalid_request: unsupported field: proxy");
      const patch = (body.proxy ?? { mode: "inherit" }) as ProfileProxyPatch;
      profiles.set(p.name, merge(profiles.get(p.name) ?? null, patch, "inherit"));
      return ["proxy"];
    },
  },
};
