/// <reference types="vite/client" />

// Every window has its own observer constructors (multi-window P2: a desk element is observed with its window's,
// `new win.ResizeObserver(…)`, lib/ownerWindow); TypeScript's DOM lib declares them on globalThis only.
interface Window {
  ResizeObserver: typeof ResizeObserver;
  IntersectionObserver: typeof IntersectionObserver;
}
