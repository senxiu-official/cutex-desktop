// Standalone browser probe, bundled only by scripts/check-font-terminal.cjs.
// It mounts the real terminal body against the existing in-memory dev bridge.
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { bridge } from "../src/renderer/src/bridge";
import { TerminalBody } from "../src/renderer/src/modules/terminal/TerminalBody";
import { DEFAULT_APPEARANCE, getFontStatus, setAppearance, subscribeFontChanges } from "../src/renderer/src/lib/appearance";
import type { Appearance } from "../src/renderer/src/lib/appearance";
import type { SideBodyProps } from "../src/renderer/src/modules/slots";
import type { TerminalState } from "../src/renderer/src/modules/terminal/terminalState";

declare global { interface Window { terminalProbeResult?: unknown; terminalProbeCaptureReady?: boolean; terminalProbeCaptured?: boolean } }
const snapshots: unknown[] = [];
const calls: { name: string; args: unknown[] }[] = [];

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fontChange(patch: Partial<Appearance>) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error("Font generation did not publish")); }, 6000);
    const off = subscribeFontChanges(() => { clearTimeout(timer); off(); resolve(); });
    setAppearance(patch, false);
  });
  await frame(); await frame();
}

async function probe() {
  const opened: Terminal[] = [];
  let disposed = 0;
  const originalOpen = Terminal.prototype.open, originalDispose = Terminal.prototype.dispose;
  Terminal.prototype.open = function (element) { opened.push(this); return originalOpen.call(this, element); };
  Terminal.prototype.dispose = function () { disposed++; return originalDispose.call(this); };

  const api = bridge.api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const name of ["terminalCreate", "terminalAttach", "terminalDetach", "terminalResize", "terminalKill"]) {
    const original = api[name]!;
    api[name] = (...args) => { calls.push({ name, args }); return original(...args); };
  }
  await fontChange({ ...DEFAULT_APPEARANCE, monoFont: "Consolas", cjkFont: "KingHwa_OldSong", monoFontSize: 16 });
  const summary = await bridge.api.terminalCreate({ kind: "project", id: "font-probe" }, 80, 24);
  const props: SideBodyProps<TerminalState> = {
    instance: { id: "font-terminal-instance", kind: "terminal.pty", binding: { kind: "workspace", hostId: "local", key: "project:font-probe" }, state: { terminalId: summary.terminalId }, pinned: true },
    hostId: "local", sessionId: null, visible: true, active: true, mode: "normal", where: "card", revealed: 0,
    setState: () => {}, close: () => {}, open: () => ({ status: "unavailable", reason: "unknown-kind" }),
  };
  const box = document.getElementById("root")!;
  const root = createRoot(box);
  const render = (visible: boolean) => { box.style.display = visible ? "block" : "none"; root.render(<TerminalBody {...props} visible={visible} />); };
  render(true);
  await pause(350);
  assert(opened.length === 1, "Expected exactly one real xterm instance");
  const term = opened[0]!;
  await bridge.api.terminalInput(summary.terminalId, "font probe ABC 中文 😀\r");
  await pause(80);
  function snapshot(label: string) {
    const internal = term as unknown as { _core: { _charSizeService: { width: number; height: number }; _renderService: { dimensions: unknown } } };
    const value = {
      label, fontFamily: term.options.fontFamily, fontSize: term.options.fontSize,
      cols: term.cols, rows: term.rows, charWidth: internal._core._charSizeService.width,
      dimensions: structuredClone(internal._core._renderService.dimensions),
      resizeCount: calls.filter((call) => call.name === "terminalResize").length,
      opened: opened.length, disposed, fontStatus: getFontStatus(),
      host: { rootDisplay: box.style.display, rootWidth: box.clientWidth, rootHeight: box.clientHeight,
        width: document.querySelector<HTMLElement>("[data-terminal-view]")?.clientWidth,
        height: document.querySelector<HTMLElement>("[data-terminal-view]")?.clientHeight,
        visibility: document.visibilityState },
      renderedText: document.querySelector(".xterm-rows")?.textContent,
      output: Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true)).join("\n"),
    };
    snapshots.push(value);
    return value;
  }
  const initial = snapshot("initial");
  assert(initial.output.includes("font probe ABC 中文"), "Real terminal did not receive mock PTY output");
  await fontChange({ monoFont: "Courier New" });
  await pause(250);
  const family = snapshot("font-ready");
  assert(family.fontFamily !== initial.fontFamily, "Font-ready event did not update terminal fontFamily");
  assert(family.fontSize === initial.fontSize, "Family change unexpectedly changed the size");
  assert(family.resizeCount > initial.resizeCount, "Family change did not use terminalResize");

  setAppearance({ monoFontSize: 20 }, false);
  await pause(250);
  const size = snapshot("size-only");
  assert(size.fontSize === 19, "monoFontSize update did not reach the existing terminal");
  assert(size.resizeCount > family.resizeCount, "Size change did not use terminalResize");

  render(false);
  await frame(); await pause(200);
  const hiddenBefore = snapshot("hidden-before");
  await fontChange({ monoFont: "Consolas", monoFontSize: 22 });
  await pause(250);
  const hidden = snapshot("hidden-updated");
  assert(hidden.fontFamily !== size.fontFamily && hidden.fontSize === 21, "Hidden terminal did not receive font options");
  assert(hidden.resizeCount === hiddenBefore.resizeCount, "Hidden terminal sent an invalid fit/resize");

  box.style.width = "720px";
  render(true);
  await frame(); await frame();
  await pause(350);
  const revealed = snapshot("revealed");
  assert(revealed.resizeCount > hidden.resizeCount && revealed.cols > 1, "Revealed terminal did not refit");
  assert(revealed.fontSize === 21 && revealed.output.includes("font probe ABC 中文"), "Reveal lost updated options or scrollback");
  assert(revealed.renderedText?.includes("font probe ABC 中文"), "Revealed DOM renderer did not paint preserved output");
  assert(opened.length === 1 && disposed === 0, "Appearance or visibility recreated xterm");
  assert(calls.filter((call) => call.name === "terminalCreate").length === 1, "Appearance recreated PTY");
  assert(calls.filter((call) => call.name === "terminalAttach").length === 1, "Appearance reattached PTY");
  assert(!calls.some((call) => call.name === "terminalKill" || call.name === "terminalDetach"), "Appearance detached/killed PTY");
  window.terminalProbeCaptureReady = true;
  const captureDeadline = performance.now() + 3000;
  while (!window.terminalProbeCaptured && performance.now() < captureDeadline) await pause(25);
  assert(window.terminalProbeCaptured, "Runner did not capture the live terminal");
  root.unmount(); await pause(30);
  assert(Number(disposed) === 1, "Final unmount did not dispose xterm");
  return { passed: true, userAgent: navigator.userAgent, snapshots, calls, finalDisposed: disposed };
}

void probe().then((result) => { window.terminalProbeResult = result; }, (error: unknown) => {
  window.terminalProbeResult = { passed: false, error: error instanceof Error ? error.stack : String(error), snapshots, calls };
});
