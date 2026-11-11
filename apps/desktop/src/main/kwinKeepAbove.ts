// Linux Wayland under KDE Plasma (test/kwinKeepAbove.test.ts; docs/desktop-modules.md §29.3): xdg-shell has no "keep
// above", and Chromium's Wayland backend ignores setAlwaysOnTop, setVisibleOnAllWorkspaces and skipTaskbar, so KWin
// keeps the desk pet in the normal layer and it sinks under any window the owner clicks. KWin lets the session's user
// load a script over D-Bus (org.kde.KWin /Scripting). This one only touches windows of this process (pid) whose caption
// starts with the pet's title, and gives them what the window asked for: keep above, every desktop, no taskbar, pager or
// switcher entry. It stays loaded while the app runs, so a pet window made again later is caught too; it is unloaded
// when the app quits. Other Wayland desktops have no such path: the pet then stays a normal window (Settings says so).
import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Runs a D-Bus client; stdout, or null when it is missing or fails. */
export type DbusRunner = (file: string, args: string[]) => Promise<string | null>;

const runDbus: DbusRunner = (file, args) =>
  new Promise((resolve) => execFile(file, args, { timeout: 3000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout))));

export const kwinPluginName = (pid: number) => `cutex-desk-pet-${pid}`;

/** The script KWin runs: plain ES5 for its JavaScript engine; KWin 6 names first, KWin 5 as the fallback. */
export function kwinScriptSource(pid: number, caption: string): string {
  return `// Cutex desk pet (pid ${pid}): keep its window above others, on every desktop, out of the taskbar.
(function () {
  var PID = ${Math.trunc(pid)};
  var CAPTION = ${JSON.stringify(caption)};
  function fit(w) {
    if (!w || w.pid !== PID || String(w.caption).indexOf(CAPTION) !== 0) return;
    if (!w.keepAbove) w.keepAbove = true;
    if (!w.onAllDesktops) w.onAllDesktops = true;
    w.skipTaskbar = true;
    w.skipPager = true;
    w.skipSwitcher = true;
  }
  function added(w) {
    if (!w || w.pid !== PID) return;
    fit(w);
    if (w.captionChanged) w.captionChanged.connect(function () { fit(w); });
  }
  var all = workspace.windowList ? workspace.windowList() : workspace.clientList();
  for (var i = 0; i < all.length; i++) added(all[i]);
  (workspace.windowAdded || workspace.clientAdded).connect(added);
})();
`;
}

/** gdbus prints "(7,)", dbus-send "int32 7". */
export function parseScriptId(stdout: string | null): number | null {
  const m = stdout && (/^\s*\((-?\d+),?\)\s*$/.exec(stdout) ?? /int32\s+(-?\d+)/.exec(stdout));
  const id = m ? Number(m[1]) : NaN;
  return Number.isInteger(id) && id >= 0 ? id : null;
}

type Call = { path: string; method: string; args: string[] };
const gdbusArgs = (c: Call) => ["call", "--session", "--dest", "org.kde.KWin", "--object-path", c.path, "--method", c.method, ...c.args];
const dbusSendArgs = (c: Call) => ["--session", "--print-reply", "--dest=org.kde.KWin", c.path, c.method, ...c.args.map((a) => `string:${a}`)];

async function call(run: DbusRunner, c: Call): Promise<string | null> {
  return (await run("gdbus", gdbusArgs(c))) ?? (await run("dbus-send", dbusSendArgs(c)));
}

/**
 * Loads and runs the keep-above script for this process's pet window. False = no KWin on the session bus (GNOME and
 * others), or KWin refused it: the window stays where the compositor puts it.
 */
export async function keepAboveOnKwin(opts: { pid: number; caption: string; file: string; run?: DbusRunner }): Promise<boolean> {
  const run = opts.run ?? runDbus;
  const name = kwinPluginName(opts.pid);
  try {
    await mkdir(dirname(opts.file), { recursive: true });
    await writeFile(opts.file, kwinScriptSource(opts.pid, opts.caption), "utf8");
  } catch {
    return false;
  }
  // A script of the same name (this process asked before) would make loadScript answer -1.
  await call(run, { path: "/Scripting", method: "org.kde.kwin.Scripting.unloadScript", args: [name] });
  const id = parseScriptId(await call(run, { path: "/Scripting", method: "org.kde.kwin.Scripting.loadScript", args: [opts.file, name] }));
  if (id === null) return false;
  return (await call(run, { path: `/Scripting/Script${id}`, method: "org.kde.kwin.Script.run", args: [] })) !== null;
}

/** On quit: unload the script without waiting for the answer. */
export function releaseKwin(pid: number): void {
  try {
    const child = spawn("gdbus", gdbusArgs({ path: "/Scripting", method: "org.kde.kwin.Scripting.unloadScript", args: [kwinPluginName(pid)] }), { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Nothing to do: a stale script only matches a window of this process id with the pet's title.
  }
}
