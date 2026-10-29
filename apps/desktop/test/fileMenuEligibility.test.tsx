// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ info: vi.fn(), file: vi.fn(), state: { hosts: { hosts: [{ id: "local", kind: "local", label: "This computer" }] } } }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { platform: "win32", shell: { filePath: fx.file, filePathInfo: fx.info } } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => fx.state } }));
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key }));
const { fileActions } = await import("../src/renderer/src/lib/fileActions");
const { closeMenu, openMenuAt, openMenuFrom, openMenuAbove, useOverlayState } = await import("../src/renderer/src/lib/contextMenu");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const t = (key: string) => key;
function View() { const state = useOverlayState(); return h("div", null, state.menu ? state.menu.items.map((item) => typeof item === "object" ? item.label : "|").join(",") : "closed"); }
const entries = (path = "C:/Reports/report.txt") => fileActions({ hostId: "local", path, open: true }, t as never);
beforeEach(() => { fx.info.mockReset().mockResolvedValue({ canOpen: false }); fx.file.mockReset(); closeMenu(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root.render(h(View))); });
afterEach(() => { act(() => { closeMenu(); root.unmount(); }); host.remove(); });

it.each(["point", "below", "above"])("%s menu shows Open only after main confirms the resolved non-executable file", async (where) => {
  let finish!: (value: { canOpen: boolean }) => void;
  fx.info.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  act(() => {
    if (where === "point") openMenuAt(1, 2, entries());
    else if (where === "below") openMenuFrom(host, entries());
    else openMenuAbove(host, entries());
  });
  expect(host.textContent).toContain("menu.revealExplorer"); expect(host.textContent).not.toContain("menu.openFile");
  await act(async () => finish({ canOpen: true }));
  expect(host.textContent).toContain("menu.openFile");
  expect(fx.info).toHaveBeenCalledExactlyOnceWith("local", "C:/Reports/report.txt");
});

it("hides executable targets, failed probes and blocked suffixes while preserving reveal", async () => {
  await act(async () => openMenuAt(1, 2, entries()));
  expect(host.textContent).not.toContain("menu.openFile"); expect(host.textContent).toContain("menu.revealExplorer");
  fx.info.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => openMenuAt(1, 2, entries()));
  expect(host.textContent).not.toContain("menu.openFile");
  fx.info.mockClear();
  for (const path of ["C:/payload.EXE", "C:/run.ps1", "C:/shortcut.lnk", "C:/run.sh", "C:/payload.exe. "]) {
    await act(async () => openMenuAt(1, 2, entries(path)));
    expect(host.textContent).not.toContain("menu.openFile"); expect(host.textContent).toContain("menu.revealExplorer");
  }
  expect(fx.info).not.toHaveBeenCalled();
});

it("does not reopen a closed or replaced menu when a delayed eligibility probe finishes", async () => {
  let finish!: (value: { canOpen: boolean }) => void;
  fx.info.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  act(() => openMenuAt(1, 2, entries())); act(() => closeMenu());
  await act(async () => finish({ canOpen: true })); expect(host.textContent).toBe("closed");
  fx.info.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  act(() => openMenuAt(1, 2, entries()));
  act(() => openMenuAt(3, 4, [{ label: "replacement", onSelect() {} }]));
  await act(async () => finish({ canOpen: true })); expect(host.textContent).toBe("replacement");
});
