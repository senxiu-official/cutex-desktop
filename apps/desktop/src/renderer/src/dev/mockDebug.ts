import type { DebugBridge, DebugEvent, DebugState } from "../../../shared/debug";
export function mockDebug(platform: string, emit: (event: DebugEvent) => void): DebugBridge {
  let enabled = localStorage.getItem("cutex-desktop.debugMode") === "true";
  let state: DebugState = { enabled, since: enabled ? Date.now() : null, frames: 0, bytes: 0, windows: 0, lastBundle: null, error: null };
  return {
    initiallyEnabled: enabled,
    state: async () => ({ ...state }),
    enable: async value => { enabled = value; localStorage.setItem("cutex-desktop.debugMode", String(value)); state = { ...state, enabled, since: enabled ? Date.now() : null }; emit({ state }); return { ...state }; },
    save: async () => {
      if (!enabled) throw new Error("debug mode is off");
      const root = platform === "darwin" ? "~/Library/Application Support/Cutex" : platform === "win32" ? "%APPDATA%/Cutex" : "~/.config/Cutex";
      state = { ...state, lastBundle: root + "/logs/debug/mock-preview" }; emit({ state }); return { ...state };
    },
    reveal: async () => {}, devtools: async () => {},
    report: async entries => { if (enabled) for (const error of entries) if (error.kind === "error") emit({ error }); },
  };
}
