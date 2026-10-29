// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { SlashPalette } from "../src/renderer/src/components/SlashPalette";

it("groups agents before files and exposes the active option without moving editor focus", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const pick = vi.fn();
  await act(async () => root.render(<SlashPalette title="Mention" listId="mentions" selected={1} empty="Empty" onHover={() => {}} onPick={pick} rows={[
    { key: "local", label: "Astra", group: "Agents", ariaLabel: "Mention Astra Online", icon: <span>avatar</span> },
    { key: "remote", label: "Astra@remote", group: "Agents", ariaLabel: "Mention Astra@remote Offline" },
    { key: "file", label: "@README.md", group: "Files" },
  ]} />));
  expect(Array.from(container.querySelectorAll('[role="presentation"]'), item => item.textContent)).toEqual(["Agents", "Files"]);
  const options = container.querySelectorAll('[role="option"]');
  expect(options).toHaveLength(3);
  expect(options[1]!.id).toBe("mentions-1");
  expect(options[1]!.getAttribute("aria-selected")).toBe("true");
  expect(options[1]!.getAttribute("aria-label")).toContain("Astra@remote");
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  options[1]!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await act(async () => (options[1] as HTMLElement).click());
  expect(pick).toHaveBeenCalledWith(1);
  await act(async () => root.unmount());
  container.remove();
});
