// @vitest-environment jsdom
// Owner 2026-10-23 (perf audit §4.3): looping animations rest while the window is not in front (blurred, minimised,
// covered) and run again when it is; one-shot animations always finish; loading placeholders pulse three times, then
// rest. 性能 → 流畅优先 keeps loops running while the window is not in front (setLoopPauseEnabled(false)).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compile } from "tailwindcss";
import { installLoopPause, setLoopPauseEnabled } from "../src/renderer/src/lib/loopPause";

type Fake = { animationName: string; playState: string; startTime: number | null; effect: { getTiming: () => { iterations: number } }; pause(): void };
const anim = (name: string, iterations: number): Fake => ({
  animationName: name,
  playState: "running",
  startTime: 500,
  effect: { getTiming: () => ({ iterations }) },
  pause() {
    this.playState = "paused";
  },
});

function world() {
  const on = new Map<string, ((e: Event) => void)[]>();
  const add = (type: string, l: (e: Event) => void) => on.set(type, [...(on.get(type) ?? []), l]);
  const remove = (type: string, l: (e: Event) => void) => on.set(type, (on.get(type) ?? []).filter((x) => x !== l));
  const state = { focus: true, visible: true, anims: [] as Fake[] };
  const fire = (type: string, e: Event = new Event(type)) => (on.get(type) ?? []).forEach((l) => l(e));
  const doc = {
    get visibilityState() {
      return state.visible ? "visible" : "hidden";
    },
    hasFocus: () => state.focus,
    getAnimations: () => state.anims,
    addEventListener: add,
    removeEventListener: remove,
  } as unknown as Document;
  const win = { addEventListener: add, removeEventListener: remove } as unknown as Window;
  return { doc, win, state, fire };
}

afterEach(() => setLoopPauseEnabled(true));

describe("loops rest while the window is not in front (lib/loopPause)", () => {
  it("blur pauses infinite loops only; focus runs them again in the shared phase", () => {
    const w = world();
    const ring = anim("agent-ring-spin", Infinity), fadeIn = anim("pane-in", 1);
    w.state.anims = [ring, fadeIn];
    const off = installLoopPause(w.win, w.doc);
    expect(ring.playState).toBe("running");
    w.state.focus = false;
    w.fire("blur");
    expect(ring.playState).toBe("paused");
    expect(fadeIn.playState).toBe("running");
    w.state.focus = true;
    w.fire("focus");
    expect(ring.startTime).toBe(0);
    off();
  });

  it("minimised / covered (hidden) rests too; a loop starting meanwhile rests at once", () => {
    const w = world();
    const off = installLoopPause(w.win, w.doc);
    w.state.visible = false;
    w.fire("visibilitychange");
    const el = document.createElement("span");
    const dots = anim("bounce", Infinity);
    w.state.anims = [dots];
    (el as unknown as { getAnimations: () => Fake[] }).getAnimations = () => [dots];
    const start = Object.assign(new Event("animationstart"), { animationName: "bounce" });
    Object.defineProperty(start, "target", { value: el });
    w.fire("animationstart", start);
    expect(dots.playState).toBe("paused");
    off();
    // Uninstalled: everything it paused runs again.
    expect(dots.startTime).toBe(0);
  });

  it("a loop removed while resting is not held or touched; the page's own pauses stay paused", () => {
    const w = world();
    const ring = anim("agent-ring-spin", Infinity), gone = anim("bounce", Infinity), own = anim("shimmer", Infinity);
    own.playState = "paused";
    w.state.anims = [ring, gone, own];
    const off = installLoopPause(w.win, w.doc);
    w.state.focus = false;
    w.fire("blur");
    expect(gone.playState).toBe("paused");
    // Its row left the list: no longer in document.getAnimations().
    w.state.anims = [ring, own];
    w.state.focus = true;
    w.fire("focus");
    expect(ring.startTime).toBe(0);
    expect(gone.startTime).toBe(500);
    expect(own.startTime).toBe(500);
    off();
  });

  it("流畅优先 (disabled): loops keep running when the window is not in front; turning it off wakes them", () => {
    const w = world();
    const ring = anim("agent-ring-spin", Infinity);
    w.state.anims = [ring];
    const off = installLoopPause(w.win, w.doc);
    w.state.focus = false;
    w.fire("blur");
    expect(ring.playState).toBe("paused");
    setLoopPauseEnabled(false);
    expect(ring.startTime).toBe(0);
    ring.playState = "running";
    w.fire("blur");
    expect(ring.playState).toBe("running");
    setLoopPauseEnabled(true);
    expect(ring.playState).toBe("paused");
    off();
  });
});

describe("loading placeholders pulse three times, then rest", () => {
  const SRC = join(__dirname, "../src/renderer/src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx$/.test(n) ? [join(dir, n)] : []));

  it("no placeholder block (bg-surface-2) uses the endless animate-pulse", () => {
    const endless = files(SRC).flatMap((p) => readFileSync(p, "utf8").split("\n").filter((l) => /animate-pulse/.test(l) && /bg-surface-2/.test(l)).map((l) => `${p}: ${l.trim()}`));
    expect(endless).toEqual([]);
  });

  it("animate-skeleton compiles to the pulse keyframes, 3 iterations", async () => {
    const stylesPath = join(SRC, "styles.css");
    const require = createRequire(import.meta.url);
    const twDir = dirname(require.resolve("tailwindcss/package.json"));
    const compiler = await compile(readFileSync(stylesPath, "utf8"), {
      base: dirname(stylesPath),
      loadStylesheet: async (id: string, base: string) => {
        const path = id === "tailwindcss" ? join(twDir, "index.css") : id.startsWith("tailwindcss/") ? join(twDir, `${id.slice(12)}.css`) : resolve(base, id);
        return { path, base: dirname(path), content: readFileSync(path, "utf8") };
      },
    });
    const out = compiler.build(["animate-skeleton"]);
    expect(out).toMatch(/\.animate-skeleton \{\s*animation: var\(--animate-skeleton\)/);
    expect(out).toMatch(/--animate-skeleton: pulse 2s cubic-bezier\(0\.4, 0, 0\.6, 1\) 3/);
    expect(out).toMatch(/@keyframes pulse/);
  });
});
