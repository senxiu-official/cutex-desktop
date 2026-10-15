// What the empty main area shows on this machine (components/FirstRun): cutex not installed / not
// running (a colleague's first run: desktop and cutex are installed separately), connected with no
// agents yet, no host at all (macOS without a local cutex: add an SSH host), or nothing special (the
// usual 「从左侧选择」 hint). Pure; remote hosts keep the banner.
import type { DaemonState } from "../../../shared/ipc";

/** The install guide the first-run steps name (docs/install/AGENT-INSTALL.md), on the public repo's
 *  `release` branch, which colleagues' installs follow. Opened in the system browser. */
export const INSTALL_GUIDE_URL = "https://github.com/senxiu-official/cutex-desktop/blob/release/docs/install/AGENT-INSTALL.md";

export type FirstRunView = "notInstalled" | "notRunning" | "empty" | "noHost" | null;

export function firstRunView(daemon: DaemonState, remote: boolean, agentCount: number | null, noHost = false): FirstRunView {
  if (noHost) return "noHost";
  if (remote) return null;
  if (daemon.kind === "unreachable" && daemon.setup) return daemon.setup;
  if (daemon.kind === "connected" && agentCount === 0) return "empty";
  return null;
}
