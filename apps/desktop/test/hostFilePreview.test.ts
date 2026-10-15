// Previewing files outside the workspace root by absolute host path (cutex fs-file-read).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { baseName, HOST_FILE_READ_FEATURE, resolveFileHref } from "../src/renderer/src/lib/workspace";
import { normalizeEntries, type MenuAction } from "../src/renderer/src/lib/contextMenu";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, onEvent: () => () => {} }));
const opened = vi.hoisted(() => [] as unknown[][]);
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideOpen: (...args: unknown[]) => (opened.push(args), { status: "opened", id: "i1", page: "p1", existing: false }) }));

const t = (key: string) => key;

describe("host file preview", () => {
  it("names the capability and labels host paths by their last segment", () => {
    expect(HOST_FILE_READ_FEATURE).toBe("fs-file-read");
    expect(baseName("/home/jy/.cutex/reports/issue 42.md")).toBe("issue 42.md");
    expect(baseName("C:\\Users\\sam\\scratch\\log.txt")).toBe("log.txt");
    expect(baseName("docs/DESIGN.md")).toBe("DESIGN.md");
  });

  it("outside-root menu: Preview first with the capability, absent without", async () => {
    const { outsideFileMenu } = await import("../src/renderer/src/lib/menus");
    const ref = resolveFileHref("/home/jy/.cutex/reports/issue.md:12", "/mnt/x/cutex")!;
    expect(ref).toMatchObject({ abs: "/home/jy/.cutex/reports/issue.md", rel: null, line: 12 });
    const preview = vi.fn();
    const labels = (entries: ReturnType<typeof outsideFileMenu>) =>
      normalizeEntries(entries).map((e) => (e === "separator" ? "|" : (e as MenuAction).label));
    const withPreview = outsideFileMenu(ref, "/home/jy/.cutex/reports/issue.md:12", true, t as never, preview);
    expect(labels(withPreview).slice(0, 3)).toEqual(["/home/jy/.cutex/reports/issue.md:12", "|", "menu.preview"]);
    const note = normalizeEntries(withPreview)[0] as MenuAction;
    expect(note.hint).toBe("menu.fileOutsideWorkspaceHost");
    (normalizeEntries(withPreview)[2] as MenuAction).onSelect();
    expect(preview).toHaveBeenCalledOnce();
    const without = outsideFileMenu(ref, "/home/jy/.cutex/reports/issue.md:12", true, t as never);
    expect(labels(without)).not.toContain("menu.preview");
    expect((normalizeEntries(without)[0] as MenuAction).hint).toBe("menu.fileOutsideWorkspace");
  });

  it("openHostFile opens the preview component on a host path (right side, v1.4)", async () => {
    const { openFile, openHostFile } = await import("../src/renderer/src/lib/sideOpen");
    openHostFile("/home/jy/report.md", 7);
    openFile("docs/DESIGN.md");
    openFile("docs/PLAN.md", null, "browse");
    // Ctrl/⌘ / middle click (lib/openModifiers): a new kept tab in the background; + Shift: shown.
    openFile("docs/TODO.md", null, "link", { newInstance: true, focus: false });
    openHostFile("/home/jy/b.md", null, { newInstance: true, focus: true });
    // 打开文件 = 替换 (default since 2026-10-12): every plain open replaces the preview.
    expect(opened).toEqual([
      ["workspace.preview", { path: "/home/jy/report.md", line: 7, host: true }, {}],
      ["workspace.preview", { path: "docs/DESIGN.md", line: null }, {}],
      ["workspace.preview", { path: "docs/PLAN.md", line: null }, {}],
      ["workspace.preview", { path: "docs/TODO.md", line: null }, { pin: true, background: true }],
      ["workspace.preview", { path: "/home/jy/b.md", line: null, host: true }, { pin: true, focus: true }],
    ]);
  });

  it("hostFile is exposed through preload and handled in main", () => {
    const root = join(__dirname, "..", "src");
    for (const file of ["preload/index.ts", "main/index.ts"]) {
      expect(readFileSync(join(root, file), "utf8")).toMatch(/"hostFile",/);
    }
    expect(readFileSync(join(root, "main/daemon.ts"), "utf8")).toMatch(/request<FsFile>\("GET", "\/v2\/fs\/file", \{ query: \{ path, maxBytes \} \}\)/);
  });
});
