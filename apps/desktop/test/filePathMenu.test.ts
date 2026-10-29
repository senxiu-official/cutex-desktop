// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import type { MenuAction } from "../src/renderer/src/lib/contextMenu";
const fx = vi.hoisted(() => ({
  platform: "win32", file: vi.fn(), copy: vi.fn(),
  state: { hosts: { hosts: [{ id: "local", kind: "local", label: "This computer" }, { id: "ssh", kind: "ssh", label: "remote" }] } },
}));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { get platform() { return fx.platform; }, shell: { filePath: fx.file } } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => fx.state } }));
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key }));
const { fileActions, performFilePathAction, canRevealLocal, revealFileLabel } = await import("../src/renderer/src/lib/fileActions");
const t = (key: string) => key;
const entries = (hostId: string, path = "/tmp/file", open = true) => fileActions({ hostId, path, open }, t as never).filter((row): row is MenuAction => !!row && typeof row === "object");
beforeEach(() => { fx.platform = "win32"; fx.state.hosts.hosts[0]!.kind = "local"; fx.file.mockReset().mockResolvedValue(undefined); fx.copy.mockReset().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: fx.copy } }); });

it("offers local reveal/open, sends exact paths to main, and keeps copy separate", async () => {
  const rows = entries("local");
  expect(rows.map((row) => row.label)).toEqual(["menu.copyPath", "menu.revealExplorer", "menu.openFile"]);
  await rows[1]!.onSelect(); await rows[2]!.onSelect(); await rows[0]!.onSelect();
  expect(fx.file.mock.calls).toEqual([["local", "/tmp/file", "reveal"], ["local", "/tmp/file", "open"]]);
  expect(fx.copy).toHaveBeenCalledWith("/tmp/file");
});

it("remote and unknown hosts only copy a path labelled with its host", async () => {
  expect(entries("ssh").map((row) => row.label)).toEqual(["menu.copyPath · remote"]);
  expect(entries("unknown").map((row) => row.label)).toEqual(["menu.copyPath · unknown"]);
  await expect(performFilePathAction("ssh", "/tmp/file", "open")).rejects.toThrow("not on this machine");
  expect(fx.file).not.toHaveBeenCalled();
});

it("never assumes an unknown or spoofed local id denotes this machine", () => {
  fx.state.hosts.hosts[0]!.kind = "ssh";
  expect(canRevealLocal({ hostId: "local", path: "/tmp/file" })).toBe(false);
  expect(entries("local")).toHaveLength(1);
});

it("accepts picker-proven local paths without needing a configured local daemon", () => {
  fx.state.hosts.hosts[0]!.kind = "ssh";
  expect(canRevealLocal({ hostId: "local", path: "/tmp/file", knownLocal: true })).toBe(true);
  expect(canRevealLocal({ hostId: "ssh", path: "/tmp/file", knownLocal: true })).toBe(false);
});

it("uses platform file-manager names and offers downloads only when supplied", () => {
  fx.platform = "darwin"; expect(revealFileLabel(t as never)).toBe("menu.revealFinder");
  fx.platform = "linux"; expect(revealFileLabel(t as never)).toBe("menu.revealFileManager");
  expect(entries("local", "https://example.com/file")).toHaveLength(1);
  const download = vi.fn();
  const rows = fileActions({ hostId: "ssh", path: "/tmp/file", download }, t as never).filter(Boolean) as MenuAction[];
  expect(rows.map((row) => row.label)).toEqual(["menu.copyPath · remote", "menu.downloadToLocal"]);
  rows[1]!.onSelect(); expect(download).toHaveBeenCalledOnce();
});

it.each(["\\\\server\\share\\file.txt", "//server/share/file.txt", "\\\\?\\C:\\file.txt", "\\\\.\\C:\\file.txt"])("never offers local actions for network/device path %s", (path) => {
  expect(entries("local", path).map((entry) => entry.label)).toEqual(["menu.copyPath"]);
});
