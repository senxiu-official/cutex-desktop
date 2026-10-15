// xterm helpers for the terminal card: colours from the app's tokens (re-read when the theme changes)
// and the base64 output the daemon streams.
import type { ITheme } from "@xterm/xterm";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function terminalTheme(): ITheme {
  return { background: cssVar("--bg"), foreground: cssVar("--fg"), cursor: cssVar("--fg"), selectionBackground: cssVar("--surface-2") };
}

/** Calls `onChange` when the app theme (data-theme) or the system colour scheme changes. */
export function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

/** `prefix` (ASCII) followed by `bytes`, as one write. */
export function concat(prefix: string, bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(prefix.length + bytes.length);
  for (let i = 0; i < prefix.length; i++) out[i] = prefix.charCodeAt(i);
  out.set(bytes, prefix.length);
  return out;
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
