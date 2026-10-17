import { isIP } from "node:net";

/** Conservative public-only development profile; no LAN switch. Special-purpose
 * ranges (including globally routed protocol exceptions) are intentionally denied.
 * Sources, checked 2026-10-11:
 * https://www.iana.org/assignments/iana-ipv4-special-registry/
 * https://www.iana.org/assignments/iana-ipv6-special-registry/
 * Multicast is separately denied; IPv6 is limited to native 2000::/3 unicast,
 * excluding protocol/transition/documentation ranges, not NAT64 or mapped IPv4.
 */
export function isPublicEgressAddress(address: string): boolean {
  if (typeof address !== "string" || address.includes("%")) return false;
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number) as [number, number, number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 31 && c === 196) ||
        (b === 52 && c === 193) || (b === 88 && c === 99) || b === 168 || (b === 175 && c === 48))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const first = Number.parseInt(canonical.split(":")[0]!, 16);
  // Leading :: produces an empty first component; positive allowlisting also
  // rejects NaN rather than accidentally admitting mapped/unspecified addresses.
  if (!(first >= 0x2000 && first <= 0x3fff)) return false;
  const second = Number.parseInt(canonical.split(":")[1] || "0", 16);
  return !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8) || first === 0x2002 ||
    first === 0x3fff && second <= 0x0fff || canonical.startsWith("2620:4f:8000:"));
}

/** LAN-class unicast an owner may open by typing it: RFC 1918, the tailnet/CGNAT 100.64/10 range
 * and IPv6 ULA fc00::/7. Loopback, link-local (incl. cloud metadata 169.254.169.254), unspecified,
 * multicast, benchmarking, documentation and other reserved ranges are never LAN targets. */
export function isLanEgressAddress(address: string): boolean {
  if (typeof address !== "string" || address.includes("%")) return false;
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(address) !== 6) return false;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const first = Number.parseInt(canonical.split(":")[0]!, 16);
  return first >= 0xfc00 && first <= 0xfdff;
}
/** An address a proxied connection may dial: public, or LAN only for an owner-admitted authority. */
export function isAllowedEgressAddress(address: string, lan: boolean): boolean {
  return isPublicEgressAddress(address) || (lan && isLanEgressAddress(address));
}

export interface BrowserEgressTarget {
  protocol: "http:" | "https:" | "ws:" | "wss:";
  hostname: string;
  port: number;
  authority: string;
  path: string;
}

function authority(value: string, defaultPort: number, requirePort = false, lan = false): { hostname: string; port: number } | undefined {
  if (!value || /[\x00-\x20\x7f-\x9f\\/@?#%]/.test(value)) return;
  const match = /^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?$/.exec(value);
  if (!match || (requirePort && !match[2])) return;
  const rawHost = match[1]!.toLowerCase(), hostname = rawHost.startsWith("[") ? rawHost.slice(1, -1) : rawHost;
  const port = match[2] === undefined ? defaultPort : Number(match[2]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || match[2] !== undefined && String(port) !== match[2]) return;
  if (isIP(hostname)) {
    if (rawHost.startsWith("[") !== (isIP(hostname) === 6) || !isAllowedEgressAddress(hostname, lan)) return;
  } else if (lan) {
    // LAN names: single-label / .local / .lan / .home.arpa are fine, *.localhost and a trailing dot never.
    if (hostname.length > 253 || hostname.endsWith(".") || hostname === "localhost" || hostname.endsWith(".localhost") ||
      !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || /^[0-9.]+$/.test(hostname)) return;
  } else {
    // No single-label/search-domain, mDNS, .localhost, trailing-dot or URL-normalized
    // integer/hex/short IPv4 aliases. DNS answers are checked again at connection time.
    if (hostname.length > 253 || !hostname.includes(".") || hostname.endsWith(".") ||
      !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(hostname) || hostname.endsWith(".home.arpa")) return;
  }
  try {
    const canonicalHost = new URL(`http://${value}/`).hostname;
    if (canonicalHost !== rawHost) return;
  } catch { return; }
  return { hostname, port };
}

/** Syntactic public candidate, NOT a DNS authorization. No network side effects. */
export function parsePublicBrowserUrl(value: unknown, allowFragment = true): BrowserEgressTarget | undefined { return parseBrowserTarget(value, allowFragment, false); }
/** Syntactic LAN-or-public candidate (an owner-admitted authority). NOT a DNS authorization. */
export function parseLanBrowserUrl(value: unknown, allowFragment = true): BrowserEgressTarget | undefined { return parseBrowserTarget(value, allowFragment, true); }
function parseBrowserTarget(value: unknown, allowFragment: boolean, lan: boolean): BrowserEgressTarget | undefined {
  if (typeof value !== "string" || value.length > 16_384 || /[\x00-\x20\x7f-\x9f\\]/.test(value)) return;
  const match = /^(https?|wss?):\/\/([^/?#]+)(?:[/?#]|$)/.exec(value);
  if (!match || !allowFragment && value.includes("#")) return;
  const protocol = `${match[1]}:` as BrowserEgressTarget["protocol"];
  const parsed = authority(match[2]!, protocol === "https:" || protocol === "wss:" ? 443 : 80, false, lan);
  if (!parsed) return;
  try {
    const url = new URL(value);
    if (url.username || url.password) return;
    return { protocol, ...parsed, authority: url.host, path: `${url.pathname || "/"}${url.search}` };
  } catch { return; }
}

/** CONNECT is authority-form only, with a mandatory explicit port. */
export function parsePublicConnectAuthority(value: unknown, lan = false): BrowserEgressTarget | undefined {
  if (typeof value !== "string" || value.length > 512) return;
  const parsed = authority(value, 443, true, lan);
  return parsed ? { protocol: "https:", ...parsed, authority: value.toLowerCase(), path: "/" } : undefined;
}

export function matchesEgressHost(value: unknown, target: BrowserEgressTarget, lan = false): boolean {
  if (typeof value !== "string") return false;
  const parsed = authority(value, target.protocol === "https:" || target.protocol === "wss:" ? 443 : 80, false, lan);
  return parsed?.hostname === target.hostname && parsed.port === target.port;
}
