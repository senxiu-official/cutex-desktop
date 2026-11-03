// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PROJECT_EXTRA_COLORS, customProjectColor, projectHex, sameProjectColor } from "../src/renderer/src/lib/projectColors";
import { PROJECT_PALETTE, createProject } from "../src/renderer/src/lib/projectCreate";
import { projectColor } from "../src/renderer/src/lib/sidebar";
import { MARK_MIN_CONTRAST, markInk } from "../src/renderer/src/lib/projectMark";
import { contrast } from "../src/shared/windowChrome";
import { mockProjectColor } from "../src/renderer/src/dev/mockProjectColor";
import { groupColor } from "../src/renderer/src/lib/projectSeparation";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { ProjectColorPicker } from "../src/renderer/src/components/ProjectColorPicker";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

it("keeps the original named colours first and offers twelve distinct RGB colours with readable mark ink", () => {
  expect(PROJECT_PALETTE).toEqual(["cyan", "blue", "green", "magenta", "yellow", "red"]);
  expect(PROJECT_EXTRA_COLORS).toHaveLength(12);
  expect(new Set(PROJECT_EXTRA_COLORS).size).toBe(12);
  const change = vi.fn();
  act(() => root.render(<ProjectColorPicker value="cyan" onChange={change} />));
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons.slice(0, 6).map(b => b.title)).toEqual(PROJECT_PALETTE.map(c => `projects.iconColor.${c}`));
  act(() => buttons[6]!.click());
  expect(change).toHaveBeenCalledWith(PROJECT_EXTRA_COLORS[0]);
  for (const c of PROJECT_EXTRA_COLORS) {
    expect(contrast(markInk(c), c)).toBeGreaterThanOrEqual(MARK_MIN_CONTRAST);
    expect(groupColor(c)).toBe(c);
  }
});

it("shows an arbitrary stored RGB as selected custom, validates a full hex value and writes its canonical value once", () => {
  const change = vi.fn();
  act(() => root.render(<ProjectColorPicker value="#123abc" onChange={change} />));
  const custom = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  expect(custom.getAttribute("aria-pressed")).toBe("true");
  expect(custom.textContent).toContain("#123ABC");
  act(() => custom.click());
  const input = host.querySelector("input")!;
  const type = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  type("#123");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "settings.save")!.disabled).toBe(true);
  expect(change).not.toHaveBeenCalled();
  type("#a1B2c3");
  act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "settings.save")!.click());
  expect(change.mock.calls).toEqual([["#A1B2C3"]]);
  expect(host.querySelector("input")).toBeNull();
  expect(projectHex(" #a1b2c3 ")).toBe("#A1B2C3");
  expect(customProjectColor("#6e56cf")).toBeNull();
  expect(sameProjectColor("red", "#FA5252")).toBe(true);
  expect(sameProjectColor("red", "#E5484D")).toBe(false);
});

it("round-trips RGB through project creation and the mock host, while legacy rejection leaves the saved colour intact", async () => {
  let saved = "blue";
  const projectMutation = vi.fn(async (_id, _fresh, op) => {
    saved = mockProjectColor(op.presentation.color, false);
    return {};
  });
  await createProject({ projectMutation }, { id: "rgb", presentation: { display_name: "RGB", badge_label: "RG", color: "#3fa7a3" }, workspaceRoot: null, director: null }, true);
  expect(saved).toBe("#3FA7A3");
  expect(projectColor(saved)).toBe("#3FA7A3");
  expect(() => { saved = mockProjectColor("#a87956", true); }).toThrow("unsupported_project_color");
  expect(saved).toBe("#3FA7A3");
  expect(mockProjectColor("blue", true)).toBe("blue");
});
