// The xterm view of one cutex PTY (split out of TerminalBody.tsx so xterm.js, ~400 KB, loads only
// when a terminal card first shows a PTY: TerminalBody imports this file lazily).
import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { bridge } from "../../bridge";
import { getAppearance, subscribeFontChanges, useAppearance } from "../../lib/appearance";
import { noteFocused, showTerminal, terminalApi } from "./terminals";
import { passThroughKey } from "./terminalState";
import { concat, decodeBase64, terminalTheme, watchTheme } from "./xtermTheme";

export function XtermView({ hostId, terminalId, instanceId, visible, revealed }: { hostId: string; terminalId: string; instanceId: string; visible: boolean; revealed: number }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const layoutRef = useRef<() => void>(() => {});
  const monoFontSize = useAppearance().monoFontSize;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    const el = host.current!;
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "Consolas, monospace",
      fontSize: getAppearance().monoFontSize - 1,
      cursorBlink: true,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    termRef.current = term;
    term.loadAddon(fit);
    // The app's shortcuts (Ctrl+`, Ctrl+Alt+B, Ctrl+Shift+1…9 / N / M, Shift+F11, F6) reach the window.
    term.attachCustomKeyEventHandler((e) => !passThroughKey(e));
    term.open(el);
    // xterm.css paints the viewport black under the themed screen: a dark hairline around a light theme.
    const paintViewport = () => {
      const viewport = el.querySelector<HTMLElement>(".xterm-viewport");
      if (viewport) viewport.style.backgroundColor = term.options.theme?.background ?? "";
    };
    paintViewport();
    const api = terminalApi(hostId);
    const offOut = bridge.on("terminalOutput", (e) => {
      if (e.terminalId !== terminalId || e.hostId !== hostId) return;
      // A replay starts over. ESC c (full reset) goes through the write queue, so output still queued
      // from an earlier stream is not drawn after it (term.reset() would run before that).
      term.write(e.reset ? concat("\x1bc", decodeBase64(e.data)) : decodeBase64(e.data));
    });
    const offExit = bridge.on("terminalExit", (e) => {
      if (e.terminalId === terminalId && e.hostId === hostId) term.write(`\r\n\x1b[2m[exited${e.exitCode === null ? "" : ` ${e.exitCode}`}]\x1b[0m\r\n`);
    });
    const input = term.onData((data) => void api.terminalInput(terminalId, data).catch(() => {}));
    const onFocus = () => noteFocused(instanceId);
    term.textarea?.addEventListener("focus", onFocus);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let release: (() => void) | null = null;
    // Fit only while on screen (an off-screen box is 1 px wide); the stream (and its scrollback
    // replay) starts after the first real fit, so the replay is drawn at the right width.
    const layout = () => {
      if (!visibleRef.current || el.clientWidth < 40 || el.clientHeight < 20) return;
      fit.fit();
      clearTimeout(timer);
      timer = setTimeout(() => void api.terminalResize(terminalId, term.cols, term.rows).catch(() => {}), release ? 150 : 0);
      if (!release) release = showTerminal(hostId, terminalId);
    };
    layoutRef.current = layout;
    // A loaded font changes glyph metrics without changing the host's box. Update the existing
    // terminal and use its normal visibility-aware fit/resize path; never recreate the PTY.
    const offFonts = subscribeFontChanges(() => {
      term.options.fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "Consolas, monospace";
      layout();
    });
    const observer = new ResizeObserver(layout);
    observer.observe(el);
    const offTheme = watchTheme(() => {
      term.options.theme = terminalTheme();
      paintViewport();
    });
    layout();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      offTheme();
      offFonts();
      input.dispose();
      term.textarea?.removeEventListener("focus", onFocus);
      offOut();
      offExit();
      release?.();
      term.dispose();
      termRef.current = null;
      layoutRef.current = () => {};
    };
  }, [hostId, terminalId, instanceId]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = monoFontSize - 1;
    layoutRef.current();
  }, [monoFontSize]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => layoutRef.current());
  }, [visible]);

  // services.side.reveal / a launcher with focus: the shell takes the keyboard.
  useEffect(() => {
    if (revealed > 0) requestAnimationFrame(() => termRef.current?.focus());
  }, [revealed]);

  return <div ref={host} data-terminal-view className="h-full min-h-0 w-full flex-1 bg-background px-2 pt-1" />;
}
