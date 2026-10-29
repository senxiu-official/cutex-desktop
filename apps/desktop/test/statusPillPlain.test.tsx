// @vitest-environment jsdom
// A sidebar IM row (design 040 §3.1): the request is the avatar's corner badge; beside it the reason is plain text,
// not a pill (components/AgentStatus StatusPill `plain`).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { I18nProvider } from "../src/renderer/src/i18n";
import { StatusPill } from "../src/renderer/src/components/AgentStatus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
const needs = (count: number) => ({ count, reasons: ["confirm"], askIds: [], notificationIds: [] }) as never;

it("plain: text without a pill, the count left to the badge; the default stays a Tag", () => {
  const plain = render(h(StatusPill, { signal: "needsYou", needs: needs(5), plain: true }));
  const el = plain.querySelector("[data-tail-plain]")!;
  expect(el.textContent).toBe("Needs you");
  expect(plain.querySelector("[data-tag]")).toBeNull();
  const pill = render(h(StatusPill, { signal: "needsYou", needs: needs(5) }));
  expect(pill.querySelector("[data-tag]")!.textContent).toBe("Needs you ×5");
});

it("plain and compact: nothing beside the avatar", () => {
  const host = render(h(StatusPill, { signal: "error", plain: true, compact: true }));
  expect(host.textContent).toBe("");
});
