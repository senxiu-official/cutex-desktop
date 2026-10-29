// @vitest-environment jsdom
// Select `group`: consecutive options sharing it sit under one <optgroup>; ungrouped ones stay flat.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { Select } = await import("../src/renderer/src/components/settings/Form");

it("groups consecutive options by window and leaves the rest flat", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const options = [
    { value: "default", label: "Default" },
    { value: "a1", label: "A 75", group: "A" },
    { value: "a2", label: "A 80", group: "A" },
    { value: "b1", label: "B 75", group: "B" },
    { value: "custom", label: "Custom" },
  ];
  act(() => root.render(h(Select<string>, { value: "a2", options, onChange: () => {} })));
  const select = host.querySelector("select")!;
  expect([...select.children].map((c) => c.tagName + ":" + (c.getAttribute("label") ?? (c as HTMLOptionElement).value))).toEqual(["OPTION:default", "OPTGROUP:A", "OPTGROUP:B", "OPTION:custom"]);
  expect([...select.querySelectorAll("optgroup")[0]!.children].map((o) => (o as HTMLOptionElement).value)).toEqual(["a1", "a2"]);
  expect(select.value).toBe("a2");
  act(() => root.unmount());
  host.remove();
});
