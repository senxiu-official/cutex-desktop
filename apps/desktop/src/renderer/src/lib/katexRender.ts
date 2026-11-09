// KaTeX for Markdown math (lib/markdownMath.ts, components/MathNode.tsx): loaded as its own chunk (script,
// stylesheet and fonts all bundled; the renderer has no network), started on idle after the Markdown renderer
// loads so a reply with math rarely waits for it. Until it is there a formula shows its source text.
// Untrusted input: trust off (no \href / \url / \html* / \includegraphics), bounded size and macro expansion,
// and an error leaves the formula as its source text, not KaTeX's red error span.
import { useSyncExternalStore } from "react";

type Katex = typeof import("katex").default;

let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;
const listeners = new Set<() => void>();

export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([module]) => {
    katex = module.default;
    renders.clear();
    for (const listener of listeners) listener();
    return katex;
  });
  return loading;
}

/** Load ahead of need, when the renderer is idle. */
export function preloadKatex(): void {
  if (loading || typeof window === "undefined") return;
  const start = () => void loadKatex().catch(() => {});
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 500);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** KaTeX once loaded (and asks for it on first use), else null. */
export function useKatex(): Katex | null {
  const value = useSyncExternalStore(subscribe, () => katex, () => katex);
  if (!value) void loadKatex().catch(() => {});
  return value;
}

export type MathRender = { html: string } | { error: string };

const RENDER_CACHE = 500;
const renders = new Map<string, MathRender>();

/** HTML for one formula; cached (a remount or a re-render of a streaming reply does not re-typeset). */
export function renderMath(engine: Katex, tex: string, display: boolean): MathRender {
  const key = `${display ? "D" : "I"}${tex}`;
  const hit = renders.get(key);
  if (hit) {
    renders.delete(key);
    renders.set(key, hit);
    return hit;
  }
  let result: MathRender;
  try {
    result = {
      html: engine.renderToString(tex, {
        displayMode: display,
        throwOnError: true,
        trust: false,
        strict: "ignore",
        output: "htmlAndMathml",
        maxSize: 50,
        maxExpand: 1000,
      }),
    };
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  renders.set(key, result);
  if (renders.size > RENDER_CACHE) renders.delete(renders.keys().next().value as string);
  return result;
}

/** Test hook: render synchronously after `await loadKatex()`. */
export function katexLoaded(): boolean {
  return katex !== null;
}
