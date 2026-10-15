// DEV ONLY: direct loopback hosts for multi-host checks against isolated local daemons (e.g. two
// `cutex instance init` homes) without SSH. `CUTEX_DESKTOP_DEV_HOSTS` = JSON array of
// `{id, name, baseUrl, tokenFile}`; honoured only when the app is not packaged (a packaged build
// ignores the variable entirely). The base URL must be `http://127.0.0.1:<port>`. The token is read
// by main from `tokenFile` (a plain token file, or a cutex instance `config.json` →
// `management_api_token`) when the host connects: it never reaches the renderer and is never logged.
// These hosts are not stored in hosts.json; they use the same HostManager / DaemonService /
// HostBinding path as SSH hosts, minus the tunnel.
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { app } from "electron";
import { isValidPort } from "../shared/hosts";

export const DEV_HOSTS_ENV = "CUTEX_DESKTOP_DEV_HOSTS";

export interface DevHostConfig {
  /** `dev-<a-z0-9->`: cannot collide with "local" or a paired `ssh-…` host. */
  id: string;
  name: string;
  /** Always `http://127.0.0.1:<port>`. */
  baseUrl: string;
  tokenFile: string;
}

const ID = /^dev-[a-z0-9-]{1,32}$/;

/** The entry as a dev host, or why not (no secret is ever part of the reason). */
export function parseDevHost(raw: unknown): DevHostConfig | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not an object";
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID.test(r.id)) return "id must match dev-[a-z0-9-]{1,32}";
  if (typeof r.baseUrl !== "string") return "baseUrl missing";
  let url: URL;
  try {
    url = new URL(r.baseUrl);
  } catch {
    return "baseUrl is not a URL";
  }
  const port = Number(url.port);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || !isValidPort(port) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return "baseUrl must be http://127.0.0.1:<port>";
  }
  if (typeof r.tokenFile !== "string" || !isAbsolute(r.tokenFile)) return "tokenFile must be an absolute path";
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 64) : r.id;
  return { id: r.id, name, baseUrl: `http://127.0.0.1:${port}`, tokenFile: r.tokenFile };
}

/** Pure: the dev hosts of an env value; none in a packaged app. Bad entries are skipped with a warning. */
export function devHostsFrom(value: string | undefined, packaged: boolean, warn: (message: string) => void = (m) => console.warn(m)): DevHostConfig[] {
  if (packaged || !value) return [];
  let list: unknown;
  try {
    list = JSON.parse(value);
  } catch {
    warn(`[cutex-desktop] ${DEV_HOSTS_ENV}: not JSON, ignored`);
    return [];
  }
  if (!Array.isArray(list)) {
    warn(`[cutex-desktop] ${DEV_HOSTS_ENV}: not an array, ignored`);
    return [];
  }
  const out: DevHostConfig[] = [];
  list.forEach((entry, index) => {
    const parsed = parseDevHost(entry);
    if (typeof parsed === "string") warn(`[cutex-desktop] ${DEV_HOSTS_ENV}[${index}] ignored: ${parsed}`);
    else if (out.some((h) => h.id === parsed.id)) warn(`[cutex-desktop] ${DEV_HOSTS_ENV}[${index}] ignored: duplicate id`);
    else out.push(parsed);
  });
  return out;
}

/** The dev hosts of this process (dev runs only). */
export function loadDevHosts(env: NodeJS.ProcessEnv = process.env): DevHostConfig[] {
  return devHostsFrom(env[DEV_HOSTS_ENV], app.isPackaged !== false);
}

/** Reads the host's token (main only). Throws a message without the file's content. */
export function readDevToken(host: DevHostConfig): string {
  let text: string;
  try {
    text = readFileSync(host.tokenFile, "utf8");
  } catch (error) {
    throw new Error(`dev host ${host.id}: token file unreadable (${(error as NodeJS.ErrnoException).code ?? "error"})`);
  }
  let token = text.trim();
  if (token.startsWith("{")) {
    try {
      const value = (JSON.parse(token) as Record<string, unknown>).management_api_token;
      token = typeof value === "string" ? value : "";
    } catch {
      token = "";
    }
  }
  if (!token || /\s/.test(token)) throw new Error(`dev host ${host.id}: no token in the token file`);
  return token;
}
