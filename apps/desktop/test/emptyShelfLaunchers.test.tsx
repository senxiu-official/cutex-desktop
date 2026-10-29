// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { shelfLauncherSections } from "../src/renderer/src/lib/emptyShelfLaunchers";

const state = vi.hoisted(() => ({ items: [] as any[], launch: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/sideComponents", () => ({ useSideRegistry: () => new Map() }));
vi.mock("../src/renderer/src/lib/lazyPage", () => ({ preloadOnIntent: vi.fn() }));
vi.mock("../src/renderer/src/lib/sideMenus", () => ({ launchable: () => state.items, launch: state.launch }));
import { EmptyShelfLaunchers } from "../src/renderer/src/components/side/EmptyShelfLaunchers";

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => { act(() => root.render(null)); state.launch.mockClear(); });

it("groups metadata, derives status, and accepts unknown module launchers without a feature list", () => {
  const items = [
    { id: "third-party", group: "tool" as const },
    { id: "notes", category: "content" as const },
    { id: "alarm", category: "content" as const, group: "status" as const },
    { id: "files", category: "content" as const },
  ];
  expect(shelfLauncherSections(items)).toEqual([
    { section: "content", entries: [items[1], items[3]] },
    { section: "tool", entries: [items[0]] },
    { section: "status", entries: [items[2]] },
  ]);
  expect(shelfLauncherSections([])).toEqual([]);
  expect(shelfLauncherSections([items[0]!])).toEqual([{ section: "tool", entries: [items[0]] }]);
});

it("keeps DOM focus order equal to reading order, uses large icons, and opens the originating page", () => {
  const Icon = ({ size }: { size: number }) => <svg width={size} height={size} />;
  state.items = [
    { kind: "extension", label: "Maidling", Icon, params: { x: 1 } },
    { kind: "content", category: "content", label: "Files", Icon, params: {} },
    { kind: "status:custom", group: "status", label: "Status", Icon, params: {} },
  ];
  act(() => root.render(<EmptyShelfLaunchers pageId="original-page" />));
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons.map((b) => b.textContent)).toEqual(["Files", "Maidling", "Status"]);
  expect(buttons.every((b) => b.tabIndex === 0)).toBe(true);
  expect(buttons.every((b) => b.querySelector("svg")?.getAttribute("width") === "22")).toBe(true);
  act(() => buttons[1]!.click());
  expect(state.launch).toHaveBeenCalledWith("extension", { x: 1 }, "original-page");
  act(() => root.render(<EmptyShelfLaunchers pageId={null} />));
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(state.launch).toHaveBeenLastCalledWith("content", {}, null);
});

it("renders the existing empty availability message without empty group headings", () => {
  state.items = [];
  act(() => root.render(<EmptyShelfLaunchers pageId="empty" />));
  expect(host.textContent).toBe("side.launcher.none");
  expect(host.querySelector("section")).toBeNull();
});
