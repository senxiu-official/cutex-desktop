// KDE Wayland keep-above for the desk pet (main/kwinKeepAbove.ts): the KWin script touches only this process's pet
// window (now, when it appears later, or once its title is set), on KWin 6 and 5; the D-Bus calls, their fallback, and
// a desktop without KWin.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { keepAboveOnKwin, kwinPluginName, kwinScriptSource, parseScriptId, type DbusRunner } from "../src/main/kwinKeepAbove";

type Win = { pid: number; caption: string; keepAbove: boolean; onAllDesktops: boolean; skipTaskbar: boolean; skipPager: boolean; skipSwitcher: boolean; captionChanged: Signal };
type Signal = { connect(f: (...a: unknown[]) => void): void; fire(...a: unknown[]): void };
const signal = (): Signal => {
  const fs: ((...a: unknown[]) => void)[] = [];
  return { connect: (f) => fs.push(f), fire: (...a) => fs.forEach((f) => f(...a)) };
};
const win = (pid: number, caption: string): Win => ({ pid, caption, keepAbove: false, onAllDesktops: false, skipTaskbar: false, skipPager: false, skipSwitcher: false, captionChanged: signal() });
const kept = (w: Win) => [w.keepAbove, w.onAllDesktops, w.skipTaskbar, w.skipPager, w.skipSwitcher].every(Boolean);
const untouched = (w: Win) => ![w.keepAbove, w.onAllDesktops, w.skipTaskbar, w.skipPager, w.skipSwitcher].some(Boolean);

function runScript(kwin: 5 | 6, windows: Win[]) {
  const added = signal();
  const workspace = kwin === 6 ? { windowList: () => windows, windowAdded: added } : { clientList: () => windows, clientAdded: added };
  runInNewContext(kwinScriptSource(4242, "Cutex desk pet"), { workspace });
  return added;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("KWin keep-above script", () => {
  it.each([6, 5] as const)("KWin %i: only this process's pet window, now and when it appears or gets its title later", (kwin) => {
    const pet = win(4242, "Cutex desk pet");
    const pet2 = win(4242, "Cutex desk pet <2>");
    const main = win(4242, "Cutex");
    const other = win(9999, "Cutex desk pet");
    const added = runScript(kwin, [pet, pet2, main, other]);
    expect([kept(pet), kept(pet2), untouched(main), untouched(other)]).toEqual([true, true, true, true]);
    const later = win(4242, "Cutex desk pet");
    added.fire(later);
    expect(kept(later)).toBe(true);
    const titled = win(4242, "");
    added.fire(titled);
    expect(untouched(titled)).toBe(true);
    titled.caption = "Cutex desk pet";
    titled.captionChanged.fire();
    expect(kept(titled)).toBe(true);
    added.fire(win(1, "Cutex desk pet"));
    added.fire(null);
  });

  it("the caption and pid cannot break out of the script", () => {
    const source = kwinScriptSource(12.7, `"); evil(); ("`);
    expect(source).toContain("var PID = 12;");
    expect(source).toContain(`var CAPTION = "\\"); evil(); (\\"";`);
  });

  it("reads the script id from gdbus and dbus-send; -1 or nothing is no script", () => {
    expect(parseScriptId("(7,)\n")).toBe(7);
    expect(parseScriptId("method return time=1 sender=:1.2 -> destination=:1.9 serial=5 reply_serial=2\n   int32 3\n")).toBe(3);
    expect(parseScriptId("(-1,)")).toBeNull();
    expect(parseScriptId("")).toBeNull();
    expect(parseScriptId(null)).toBeNull();
  });
});

describe("loading it over D-Bus", () => {
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "kwin-above-"));
    dirs.push(d);
    return d;
  };

  it("writes the script, replaces an old one of the same name, loads and runs it", async () => {
    const file = join(tmp(), "new-dir", "kwin-keep-above.js");
    const calls: string[][] = [];
    const run: DbusRunner = async (bin, args) => {
      calls.push([bin, ...args]);
      return args.includes("org.kde.kwin.Scripting.loadScript") ? "(5,)\n" : "()\n";
    };
    expect(await keepAboveOnKwin({ pid: 4242, caption: "Cutex desk pet", file, run })).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("var PID = 4242;");
    const base = ["gdbus", "call", "--session", "--dest", "org.kde.KWin", "--object-path"];
    expect(calls).toEqual([
      [...base, "/Scripting", "--method", "org.kde.kwin.Scripting.unloadScript", kwinPluginName(4242)],
      [...base, "/Scripting", "--method", "org.kde.kwin.Scripting.loadScript", file, kwinPluginName(4242)],
      [...base, "/Scripting/Script5", "--method", "org.kde.kwin.Script.run"],
    ]);
  });

  it("falls back to dbus-send without gdbus", async () => {
    const calls: string[][] = [];
    const run: DbusRunner = async (bin, args) => {
      calls.push([bin, ...args]);
      if (bin === "gdbus") return null;
      return args.includes("org.kde.kwin.Scripting.loadScript") ? "method return\n   int32 2\n" : "method return\n";
    };
    expect(await keepAboveOnKwin({ pid: 7, caption: "Cutex desk pet", file: join(tmp(), "s.js"), run })).toBe(true);
    expect(calls.at(-1)).toEqual(["dbus-send", "--session", "--print-reply", "--dest=org.kde.KWin", "/Scripting/Script2", "org.kde.kwin.Script.run"]);
    expect(calls.find((c) => c[0] === "dbus-send" && c.includes("org.kde.kwin.Scripting.loadScript"))!.slice(-2)).toEqual([`string:${join(dirs.at(-1)!, "s.js")}`, "string:cutex-desk-pet-7"]);
  });

  it("no KWin on the bus (GNOME and others), or KWin says no: false, and nothing is run", async () => {
    const calls: string[][] = [];
    const none: DbusRunner = async (bin, args) => (calls.push([bin, ...args]), null);
    expect(await keepAboveOnKwin({ pid: 7, caption: "x", file: join(tmp(), "s.js"), run: none })).toBe(false);
    expect(calls.some((c) => c.includes("org.kde.kwin.Script.run"))).toBe(false);
    const refused: DbusRunner = async (_bin, args) => (args.includes("org.kde.kwin.Scripting.loadScript") ? "(-1,)" : "()");
    expect(await keepAboveOnKwin({ pid: 7, caption: "x", file: join(tmp(), "s.js"), run: refused })).toBe(false);
  });
});
