/** N2's optional upstream (owner switch 「浏览器通过系统代理上网」): the handshake that turns a socket dialed to the
 * owner's own proxy into a tunnel to one public target. No Electron imports, no credentials, no TLS, no retries.
 * HTTP CONNECT (RFC 9110 §9.3.6) and SOCKS5 without authentication (RFC 1928, domain-name address type, so the
 * proxy resolves the name). Anything else the system names (HTTPS / SOCKS4 proxies) is refused, never dialed direct.
 */
import { isIP, type Socket } from "node:net";

export interface BrowserUpstreamProxy { scheme: "http" | "socks5"; host: string; port: number }
/** Largest proxy reply head N2 reads before the tunnel starts. */
const REPLY_LIMIT = 16 * 1024;

/** Chromium's resolveProxy answer (first entry) as an upstream N2 can speak; null = DIRECT; undefined = unusable. */
export function browserUpstreamProxy(answer: unknown): BrowserUpstreamProxy | null | undefined {
  if (typeof answer !== "string" || answer.length > 4096) return undefined;
  const first = answer.split(";")[0]?.trim() ?? "";
  if (!first || /^DIRECT$/i.test(first)) return null;
  const match = /^(PROXY|SOCKS5)\s+(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]{1,253}):(\d{1,5})$/i.exec(first);
  if (!match) return undefined;
  const port = Number(match[3]);
  if (!(port > 0 && port < 65536) || String(port) !== match[3]) return undefined;
  const host = match[2]!.replace(/^\[|\]$/g, "").toLowerCase();
  if (match[2]!.startsWith("[") && isIP(host) !== 6) return undefined;
  return { scheme: match[1]!.toUpperCase() === "PROXY" ? "http" : "socks5", host, port };
}

function read(socket: Socket, done: (buffer: Buffer) => number | undefined): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => { socket.off("data", data); socket.off("error", fail); socket.off("close", gone); };
    const fail = () => { cleanup(); reject(new Error("upstream_failed")); };
    const gone = () => { cleanup(); reject(new Error("upstream_closed")); };
    const data = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let used: number | undefined;
      try { used = done(buffer); } catch { cleanup(); reject(new Error("upstream_refused")); return; }
      if (used === undefined) { if (buffer.length > REPLY_LIMIT) { cleanup(); reject(new Error("upstream_reply_limit")); } return; }
      cleanup(); socket.pause();
      // Bytes the target already sent behind the reply belong to the tunnel.
      if (used < buffer.length) socket.unshift(buffer.subarray(used));
      resolve(buffer.subarray(0, used));
    };
    socket.on("data", data); socket.once("error", fail); socket.once("close", gone);
    socket.resume();
  });
}

/** Opens a tunnel to `hostname:port` through `proxy` on an already connected socket. Rejects on any refusal. */
export async function openUpstreamTunnel(socket: Socket, proxy: BrowserUpstreamProxy, hostname: string, port: number): Promise<void> {
  const authority = isIP(hostname) === 6 ? `[${hostname}]:${port}` : `${hostname}:${port}`;
  if (proxy.scheme === "http") {
    socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    const head = await read(socket, buffer => { const end = buffer.indexOf("\r\n\r\n"); return end < 0 ? undefined : end + 4; });
    if (!/^HTTP\/1\.[01] 200[ \r]/.test(head.toString("latin1"))) throw new Error("upstream_refused");
    return;
  }
  // SOCKS5: no-auth method only, then CONNECT by domain name (or the literal address).
  socket.write(Buffer.from([5, 1, 0]));
  await read(socket, buffer => {
    if (buffer.length < 2) return undefined;
    if (buffer[0] !== 5 || buffer[1] !== 0) throw new Error("upstream_refused");
    return 2;
  });
  socket.resume();
  const family = isIP(hostname);
  const address = family === 4 ? Buffer.from([1, ...hostname.split(".").map(Number)])
    : family === 6 ? Buffer.concat([Buffer.from([4]), ipv6Bytes(hostname)])
    : Buffer.concat([Buffer.from([3, Buffer.byteLength(hostname)]), Buffer.from(hostname, "ascii")]);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, Buffer.from([port >> 8, port & 0xff])]));
  await read(socket, buffer => {
    if (buffer.length < 5) return undefined;
    if (buffer[0] !== 5 || buffer[1] !== 0) throw new Error("upstream_refused");
    const length = buffer[3] === 1 ? 4 : buffer[3] === 4 ? 16 : buffer[3] === 3 ? 1 + buffer[4]! : -1;
    if (length < 0) throw new Error("upstream_refused");
    return buffer.length >= 4 + length + 2 ? 4 + length + 2 : undefined;
  });
}

function ipv6Bytes(address: string): Buffer {
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [head, tail] = canonical.includes("::") ? canonical.split("::") as [string, string] : [canonical, undefined];
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  const bytes = Buffer.alloc(16);
  groups.forEach((group, index) => bytes.writeUInt16BE(Number.parseInt(group || "0", 16), index * 2));
  return bytes;
}
