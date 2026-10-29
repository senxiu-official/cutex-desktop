// @vitest-environment jsdom
// Built-in terminal: a real Tab / Shift+Tab keydown on xterm's focused textarea, with XtermView's custom key
// handler (!passThroughKey), becomes \t / CSI Z on onData — the data XtermView sends to terminalInput — and
// window listeners in the bubble phase never see it (xterm takes it). Checked against the mock preview over CDP
// 2026-10-26 too: the bytes reach terminalInput unchanged and focus stays in the terminal.
import { afterEach, describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { passThroughKey } from "../src/renderer/src/modules/terminal/terminalState";

let term: Terminal | null = null;
// jsdom has no matchMedia (xterm watches the device pixel ratio with it).
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
afterEach(() => {
  term?.dispose();
  term = null;
  document.body.innerHTML = "";
});

describe("terminal: Tab reaches the PTY input path", () => {
  it("xterm turns Tab / Shift+Tab into \t / CSI Z and no later window handler gets the key", () => {
    const host = document.createElement("div");
    host.setAttribute("data-terminal-view", "");
    document.body.appendChild(host);
    term = new Terminal();
    term.attachCustomKeyEventHandler((e) => !passThroughKey(e));
    term.open(host);
    const sent: string[] = [];
    term.onData((d) => sent.push(d));
    const seen: string[] = [];
    const onWindow = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", onWindow);
    try {
      term.textarea!.focus();
      for (const shiftKey of [false, true]) {
        const e = new KeyboardEvent("keydown", { key: "Tab", code: "Tab", keyCode: 9, shiftKey, bubbles: true, cancelable: true });
        term.textarea!.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true); // no browser focus traversal out of the terminal
      }
    } finally {
      window.removeEventListener("keydown", onWindow);
    }
    expect(sent).toEqual(["\t", "\x1b[Z"]);
    expect(seen).toEqual([]);
    expect(document.activeElement).toBe(term.textarea);
  });
});
