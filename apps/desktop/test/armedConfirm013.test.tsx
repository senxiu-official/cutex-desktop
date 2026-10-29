// @vitest-environment jsdom
// Design 013: click-twice buttons explain themselves — the armed button counts down (ARMED_COUNTDOWN),
// gets the focus (Enter / Space = the second click), Esc disarms, and running out leaves a faint
// 「未开始：需要再点一次确认」 for ARMED_EXPIRED_MS.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.stubGlobal("navigator", { ...globalThis.navigator, language: "zh-CN" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { ARMED_BUTTON, ARMED_COUNTDOWN, ARMED_EXPIRED_MS, ARMED_TIMEOUT_MS, useArmed } = await import("../src/renderer/src/lib/armedConfirm");

const confirmed = vi.fn();
function Demo() {
  const [armed, setArmed] = useArmed();
  return armed
    ? h("button", { className: ARMED_BUTTON, "data-testid": "armed", onClick: () => (setArmed(false), confirmed()) }, "确认删除")
    : h("button", { "data-testid": "idle", onClick: () => setArmed(true) }, "删除");
}

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  confirmed.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(h(Demo)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll(".armed-expired").forEach((el) => el.remove());
  vi.useRealTimers();
});

const q = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid=${id}]`);
const arm = () => {
  const idle = q("idle")!;
  idle.focus();
  act(() => idle.click());
  act(() => vi.advanceTimersToNextFrame());
};

it("arms with its own label, a countdown and the focus; Enter-click confirms", () => {
  arm();
  const armed = q("armed")!;
  expect(armed.textContent).toBe("确认删除");
  expect(armed.classList.contains(ARMED_COUNTDOWN)).toBe(true);
  expect(document.activeElement).toBe(armed);
  act(() => armed.click());
  expect(confirmed).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".armed-expired")).toBeNull();
});

it("Esc disarms without the 未开始 note", () => {
  arm();
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(q("idle")).not.toBeNull();
  act(() => vi.advanceTimersByTime(ARMED_TIMEOUT_MS));
  expect(document.querySelector(".armed-expired")).toBeNull();
});

it("disarms after 5 s and leaves 「未开始」 for about 4 s", () => {
  expect(ARMED_TIMEOUT_MS).toBe(5000);
  arm();
  act(() => vi.advanceTimersByTime(ARMED_TIMEOUT_MS - 100));
  expect(q("armed")).not.toBeNull();
  act(() => vi.advanceTimersByTime(100));
  expect(q("idle")).not.toBeNull();
  const note = document.querySelector(".armed-expired")!;
  expect(note.textContent).toBe("未开始：需要再左键点击一次确认");
  expect(note.getAttribute("role")).toBe("status");
  act(() => vi.advanceTimersByTime(ARMED_EXPIRED_MS + 400));
  expect(document.querySelector(".armed-expired")).toBeNull();
  expect(confirmed).not.toHaveBeenCalled();
});
