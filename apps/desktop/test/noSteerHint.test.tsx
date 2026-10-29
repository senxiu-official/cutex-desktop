// @vitest-environment jsdom
// DSH (no turnSteer): the composer says before sending that a message typed during a turn goes to the next turn.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { busyPlaceholderKey, noSteerHintShown } from "../src/renderer/src/lib/noSteerHint";
import { agentFeaturesOf, lacks } from "../src/renderer/src/lib/agentFeatures";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const { NoSteerSendHint } = await import("../src/renderer/src/components/NoSteerSendHint");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = { busy: true, noSteer: true, hasContent: true, delegation: false, paused: false };

it("shows only for a busy no-steer agent with a draft, not when another hint owns the line", () => {
  expect(noSteerHintShown(base)).toBe(true);
  for (const off of [{ busy: false }, { noSteer: false }, { hasContent: false }, { delegation: true }, { paused: true }]) expect(noSteerHintShown({ ...base, ...off })).toBe(false);
});

it("a DSH agent without explicit turnSteer is a no-steer agent and gets the next-turn placeholder", () => {
  const dsh = agentFeaturesOf({ runtime: { backend: "dsh" } });
  expect(lacks(dsh, "turnSteer")).toBe(true);
  expect(busyPlaceholderKey(lacks(dsh, "turnSteer"))).toBe("composer.placeholderBusyNoSteer");
  expect(busyPlaceholderKey(lacks(agentFeaturesOf(null), "turnSteer"))).toBe("composer.placeholderBusy");
});

it("renders the hint as a status line", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(h(NoSteerSendHint)));
  const line = host.querySelector('[data-testid="no-steer-send"]');
  expect(line?.getAttribute("role")).toBe("status");
  expect(line?.textContent).toBe("composer.noSteerHint");
  act(() => root.unmount());
});
