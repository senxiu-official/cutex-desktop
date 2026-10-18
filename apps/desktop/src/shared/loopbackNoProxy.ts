// Requests from the desktop to cutex go to loopback only (the local daemon, SSH tunnels on
// 127.0.0.1, dev hosts). They must never go through a proxy. Today Node's fetch ignores
// HTTP(S)_PROXY, but with NODE_USE_ENV_PROXY=1 / NODE_OPTIONS=--use-env-proxy (set by some proxy
// tools) it sends loopback through the proxy as well — there is no built-in loopback exception — and
// child processes (ssh, git, pnpm) read the same variables. So main adds the loopback names to
// NO_PROXY / no_proxy at start, explicitly instead of relying on defaults. Node re-reads NO_PROXY per
// request, so setting it at start is enough.

export const LOOPBACK_NO_PROXY = ["127.0.0.1", "localhost", "::1", "[::1]"] as const;

/** `value` (a NO_PROXY list) with every loopback name present; unchanged when they all are. */
export function withLoopbackNoProxy(value: string | undefined): string {
  const entries = (value ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  const have = new Set(entries.map((e) => e.toLowerCase()));
  // `*` already bypasses everything.
  if (have.has("*")) return entries.join(",");
  const missing = LOOPBACK_NO_PROXY.filter((name) => !have.has(name));
  return [...entries, ...missing].join(",");
}

/** Set NO_PROXY and no_proxy on `env` (process.env in main) so both spellings carry loopback. */
export function applyLoopbackNoProxy(env: Record<string, string | undefined>, platform: string = process.platform): void {
  // Windows env names are case-insensitive (one variable); elsewhere both spellings exist separately.
  const upper = withLoopbackNoProxy(env.NO_PROXY ?? env.no_proxy);
  env.NO_PROXY = upper;
  if (platform !== "win32") env.no_proxy = withLoopbackNoProxy(env.no_proxy ?? env.NO_PROXY);
}
