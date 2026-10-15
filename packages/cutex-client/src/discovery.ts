import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { DEFAULT_MANAGEMENT_URL, type DaemonEndpoint } from "./endpoint";

export interface DiscoverOptions {
  /** Directory containing `.cutex` (defaults to the OS home dir). */
  home?: string;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
}

/** Directories an instance home may not live in (relative to the OS home); as cutex. */
const PROTECTED_USER_DIRS = [".cutex", ".codex", ".codez-cli", ".codex-codez", ".claude"];

const SEPARATORS = /[\\/]+/;

/**
 * Path components after resolving the deepest existing ancestor (an alias of a directory compares
 * equal to it), case-folded on Windows. Mirrors cutex `config/instance.rs` `comparable`.
 */
async function comparable(path: string, platform: NodeJS.Platform): Promise<string[]> {
  let existing = path;
  const rest: string[] = [];
  let full = path;
  for (;;) {
    try {
      full = join(await realpath(existing), ...[...rest].reverse());
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) break;
      rest.push(basename(existing));
      existing = parent;
    }
  }
  const root = parse(full).root;
  const parts = [root, ...full.slice(root.length).split(SEPARATORS).filter((c) => c && c !== ".")];
  return platform === "win32" ? parts.map((c) => c.replaceAll("/", "\\").toLowerCase()) : parts;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);
const within = (path: string[], ancestor: string[]) => path.length > ancestor.length && ancestor.every((c, i) => path[i] === c);

export type HomeSelection = { kind: "default" } | { kind: "custom"; path: string };

/**
 * Which instance `CUTEX_HOME` selects, exactly like cutex `select_home` (config/instance.rs): unset
 * or empty = the default instance (`<home>/.cutex`); naming the default home itself = the default
 * instance too; otherwise an independent instance directory, which must be absolute, without `..`,
 * not a filesystem root, neither inside nor around the default home, and not inside the protected
 * per-user directories.
 */
export async function selectHome(custom: string | undefined, userHome: string, platform: NodeJS.Platform = process.platform): Promise<HomeSelection> {
  if (custom === undefined || custom === "") return { kind: "default" };
  if (!isAbsolute(custom)) throw new Error(`CUTEX_HOME must be an absolute path: ${custom}`);
  if (custom.split(SEPARATORS).includes("..")) throw new Error(`CUTEX_HOME must not contain "..": ${custom}`);
  const normalized = resolve(custom);
  if (dirname(normalized) === normalized) throw new Error(`CUTEX_HOME must not be a filesystem root: ${custom}`);
  const defaultHome = join(userHome, ".cutex");
  const candidate = await comparable(normalized, platform);
  const fallback = await comparable(defaultHome, platform);
  if (same(candidate, fallback)) return { kind: "default" };
  if (within(candidate, fallback)) throw new Error(`CUTEX_HOME must not be inside the default home ${defaultHome}`);
  if (within(fallback, candidate)) throw new Error(`CUTEX_HOME must not contain the default home ${defaultHome}`);
  for (const dir of PROTECTED_USER_DIRS) {
    const protectedPath = await comparable(join(userHome, dir), platform);
    if (same(candidate, protectedPath) || within(candidate, protectedPath)) throw new Error(`CUTEX_HOME must not be inside ${join(userHome, dir)}`);
  }
  return { kind: "custom", path: normalized };
}

/**
 * Locates the local cutex daemon: a CUTEX_HOME that selects an independent instance (as cutex
 * `select_home` reads it) is that instance's config directory; otherwise
 * use `<home>/.cutex/config.json`. Instance tokens may only go to the configured loopback port.
 * Legacy homes retain URL option / CUTEX_MANAGEMENT_URL / default precedence.
 * Node only: exported from `@cutex-desktop/cutex-client/node`, never from the main entry.
 */
export async function discoverLocalDaemon(options: DiscoverOptions = {}): Promise<DaemonEndpoint & { configPath: string }> {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  // Empty, or the default home itself, is the default instance (cutex select_home).
  const selection = await selectHome(env.CUTEX_HOME, home);
  const instanceHome = selection.kind === "custom" ? selection.path : undefined;
  const configPath = join(instanceHome ?? join(home, ".cutex"), "config.json");

  let token: string | null = null;
  let config: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid local daemon config");
    config = parsed as Record<string, unknown>;
    const value = config.management_api_token;
    token = typeof value === "string" && value.length > 0 ? value : null;
  } catch (error) {
    if (instanceHome !== undefined || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const independent = instanceHome !== undefined || Object.hasOwn(config, "management_port");
  const port = config.management_port;
  if (independent && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("Independent instance config requires a valid management_port");
  }
  const baseUrl = (options.baseUrl ?? env.CUTEX_MANAGEMENT_URL ??
    (independent ? `http://127.0.0.1:${port}` : DEFAULT_MANAGEMENT_URL)).replace(/\/+$/, "");
  if (independent) {
    const invalid = () => new Error("Independent instance URL must be loopback at its configured management_port, without credentials or a path");
    let url: URL;
    try { url = new URL(baseUrl); } catch { throw invalid(); }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    const effectivePort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!["http:", "https:"].includes(url.protocol) || !loopback || effectivePort !== port ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw invalid();
  }
  return { baseUrl, token, configPath };
}
