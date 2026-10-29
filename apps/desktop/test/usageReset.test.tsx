// @vitest-environment jsdom
// Identity menu → 用量: a window row shows its reset countdown inline, in the composer chips' compact format
// ("2d19h"); balances / errors leave the slot empty; the full label is the tooltip of the label cell.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { GaugeRow } = await import("../src/renderer/src/components/UsageFlyout");
const { I18nProvider } = await import("../src/renderer/src/i18n");

let root: ReturnType<typeof createRoot> | null = null;
const render = (el: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(h(I18nProvider, null, el)));
  return host;
};
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});
const gauge = (over: object) => ({ id: "g", label: "Claude", kind: "window", remainingPercent: 62, balance: null, resetAt: null, windowLabel: "7d", observedAt: null, stale: false, ...over }) as never;

it("shows the compact countdown after the percentage and keeps the exact time as the tooltip", () => {
  const resetAt = Math.floor(Date.now() / 1000) + (2 * 24 + 19) * 3600 + 120;
  const host = render(h(GaugeRow, { gauge: gauge({ resetAt }), view: "remaining" }));
  expect(host.querySelector("[data-usage-reset]")!.textContent).toBe("2d19h");
  expect(host.firstElementChild!.getAttribute("title")).toMatch(/7d/);
});

it("a balance without a reset shows its amount and an empty reset slot; an error shows no countdown", () => {
  const bal = render(h(GaugeRow, { gauge: gauge({ kind: "balance", balance: "88.08", windowLabel: null, label: "余额" }), view: "remaining" }));
  expect(bal.querySelector("[data-usage-reset]")!.textContent).toBe("");
  const err = render(h(GaugeRow, { gauge: gauge({ error: "bad", resetAt: Math.floor(Date.now() / 1000) + 3600 }), view: "remaining" }));
  expect(err.querySelector("[data-usage-reset]")!.textContent).toBe("");
});
