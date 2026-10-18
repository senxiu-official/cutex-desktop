// @vitest-environment jsdom
// Owner Q11: an extra writable directory that contains the host's cutex home (`~/.cutex`, e.g. the
// user's home `~`) is allowed but warned about (lib/cutexHomeExposure, components/LaunchOptions
// WritableRootsEditor): picked, it waits for 「仍然添加」; stored, its chip carries a warning mark.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { defaultCutexHome, exposesCutexHome, normalizeHostPath } from "../src/renderer/src/lib/cutexHomeExposure";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

describe("exposesCutexHome", () => {
  it("POSIX: the cutex home and its ancestors, case-sensitive, not siblings / children", () => {
    const c = defaultCutexHome("/home/alex");
    expect(c).toBe("/home/alex/.cutex");
    for (const root of ["/home/alex", "/home/alex/", "/home", "/", "/home/alex/.cutex", "/home/./alex/../alex"]) expect(exposesCutexHome(root, c), root).toBe(true);
    for (const root of ["/home/alex/projects", "/home/alex/.cutex-dev", "/home/al", "/Home/alex", "/home/alex/.cutex/profiles", "relative/dir", ""]) expect(exposesCutexHome(root, c), root).toBe(false);
  });
  it("Windows: case-insensitive, either separator, drive letters, verbatim and UNC prefixes", () => {
    const c = defaultCutexHome("C:\\Users\\Alice");
    expect(c).toBe("C:\\Users\\Alice\\.cutex");
    for (const root of ["C:\\Users\\alice", "c:/users/ALICE/", "C:\\", "C:", "C:\\Users", "\\\\?\\C:\\Users\\alice"]) expect(exposesCutexHome(root, c), root).toBe(true);
    for (const root of ["D:\\", "D:\\Users\\alice", "C:\\Users\\alice\\projects", "C:\\Users\\alice2", "/Users/alice"]) expect(exposesCutexHome(root, c), root).toBe(false);
    const unc = defaultCutexHome("\\\\nas\\home\\alex");
    expect(exposesCutexHome("\\\\NAS\\home", unc)).toBe(true);
    expect(exposesCutexHome("\\\\?\\UNC\\nas\\home\\alex", unc)).toBe(true);
    expect(exposesCutexHome("\\\\nas\\other", unc)).toBe(false);
  });
  it("normalises paths to one comparable form", () => {
    expect(normalizeHostPath("C:\\A\\b\\")).toEqual({ key: "c:/a/b", windows: true });
    expect(normalizeHostPath("/A//b/")).toEqual({ key: "/A/b", windows: false });
    expect(normalizeHostPath("/")).toEqual({ key: "/", windows: false });
    expect(normalizeHostPath("x/y")).toBeNull();
  });
  it("ships the warning in zh-CN (Profile untranslated) and en (no Chinese)", () => {
    expect(zhCN["launch.rootExposesCutex"]).toContain("Profile");
    expect(zhCN["launch.rootExposesCutex"]).toContain("~/.cutex");
    expect(en["launch.rootExposesCutex"]).toMatch(/^[\x20-\x7e]+$/);
  });
});

const fx = vi.hoisted(() => ({ picked: null as string | null, home: "/home/alex" as string | null }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/remoteMode", () => ({ useFolderPickBlocked: () => false, pickDirectory: async () => fx.picked }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "local" }));
vi.mock("../src/renderer/src/lib/hostHome", () => ({ useHostHomeOf: () => fx.home, loadHostHome: async () => fx.home }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { WritableRootsEditor } = await import("../src/renderer/src/components/LaunchOptions");

function mount(roots: string[]) {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  const onChange = vi.fn();
  act(() => root.render(h(WritableRootsEditor, { roots, onChange })));
  const button = (label: string) => [...div.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;
  return { div, onChange, button, unmount: () => act(() => root.unmount()) };
}

describe("WritableRootsEditor", () => {
  it("asks before adding a directory that contains ~/.cutex; others are added at once", async () => {
    const m = mount([]);
    fx.picked = "/home/alex";
    await act(async () => m.button("launch.addRoot").click());
    expect(m.onChange).not.toHaveBeenCalled();
    expect(m.div.querySelector("[data-testid=root-exposes-cutex-confirm]")?.textContent).toContain("launch.rootExposesCutex");
    await act(async () => m.button("dialog.cancel").click());
    expect(m.div.querySelector("[data-testid=root-exposes-cutex-confirm]")).toBeNull();
    await act(async () => m.button("launch.addRoot").click());
    await act(async () => m.button("launch.addRootAnyway").click());
    expect(m.onChange).toHaveBeenLastCalledWith(["/home/alex"]);
    fx.picked = "/home/alex/projects";
    await act(async () => m.button("launch.addRoot").click());
    expect(m.onChange).toHaveBeenLastCalledWith(["/home/alex/projects"]);
    m.unmount();
  });
  it("marks a stored root that contains ~/.cutex; nothing without a known home", () => {
    const m = mount(["/home/alex", "/srv/data"]);
    expect(m.div.querySelectorAll("[data-testid=root-exposes-cutex]")).toHaveLength(1);
    m.unmount();
    fx.home = null;
    const n = mount(["/home/alex"]);
    expect(n.div.querySelectorAll("[data-testid=root-exposes-cutex]")).toHaveLength(0);
    n.unmount();
    fx.home = "/home/alex";
  });
});
