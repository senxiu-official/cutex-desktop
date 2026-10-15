// Is this machine a host ("本机")? Windows / Linux: always (the desktop runs next to its cutex; a
// missing daemon shows the 未安装 / 未运行 setup notice). macOS builds are front-end only — no cutex
// runs there — so the implicit local host exists only when a local cutex is actually configured,
// found the way discovery (`discoverLocalDaemon`) finds it: an explicit management URL or
// CUTEX_HOME, or a management token in `<home>/.cutex/config.json` (the same token that tells
// 未运行 from 未安装, shared/hosts `localDaemonSetup`; a config.json without one, e.g. left by an old
// CLI-only cutex, does not count). Otherwise the app starts with no host and guides to adding a
// remote (SSH) host instead of a dead 「重连」 banner for 127.0.0.1:24270.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LocalHostProbe {
  /** Dev override of the directory containing `.cutex` (CUTEX_DESKTOP_HOME). */
  home?: string;
  /** Dev override of the management URL. */
  baseUrl?: string;
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** A local cutex is configured: an explicit URL / instance home, or a management token in the default home's config.json. */
export function localCutexConfigured(probe: LocalHostProbe = {}, env: NodeJS.ProcessEnv = process.env, read: (path: string) => string | null = readText): boolean {
  if (probe.baseUrl || env.CUTEX_MANAGEMENT_URL || env.CUTEX_HOME) return true;
  const text = read(join(probe.home ?? homedir(), ".cutex", "config.json"));
  if (text === null) return false;
  try {
    const token = (JSON.parse(text) as { management_api_token?: unknown } | null)?.management_api_token;
    return typeof token === "string" && token.length > 0;
  } catch {
    // Unreadable JSON: discovery would report it as an error on this machine — show the host.
    return true;
  }
}

/** Whether the implicit local host is shown and connected (see the header). */
export function hasImplicitLocalHost(platform: NodeJS.Platform, configured: boolean): boolean {
  return platform !== "darwin" || configured;
}
