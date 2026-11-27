// @vitest-environment jsdom
// 「更新项目记忆 · …」 (owner 2026-11-28): file edits inside a project memory directory are one row of their own, every
// memory edit of a turn in that row. Item shapes as the runtimes send them: Claude Write / Edit through the Claude
// adapter (cute_claude/native_tools.py applied_change: add = the whole text, update = structuredPatch hunks) and Codex
// apply_patch (app-server v2 FileUpdateChange: add / delete carry the file body, update a unified diff).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawItem, TimelineEntry } from "../src/renderer/src/lib/timeline";
import { segmentEntries } from "../src/renderer/src/lib/workGroups";
import { memoryEditsOf, memoryGatherKey, memoryPathOf, memoryRow, sameMemoryDir } from "../src/renderer/src/modules/projects/memoryEdits";

const env = vi.hoisted(() => ({
  projectId: "cutex-e" as string | null,
  dir: "C:\\Users\\owner\\.cutex\\projects\\cutex-e-301fa5b7fa0d\\memory",
  reads: 0,
  opened: [] as unknown[],
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${v.n}` : k) }) }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvHost: () => "eva" }));
vi.mock("../src/renderer/src/lib/userLayoutToggle", () => ({ useUserLayoutToggle: () => (f: () => void) => f() }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { openPage: (...a: unknown[]) => env.opened.push(a) } } }));
vi.mock("../src/renderer/src/store", () => ({
  sidebarOf: () => ({ hostRows: { s1: { projectId: env.projectId } } }),
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ hosts: { active: "local" } }) }),
  hostApi: () => ({
    projectMemory: async () => {
      env.reads += 1;
      return { dir: env.dir, entries: [{ file: "feedback-gate-before-push.md", name: "gate-before-push", description: "Read the gate's exit before pushing" }] };
    },
  }),
}));
const { MemoryEditRow } = await import("../src/renderer/src/modules/projects/MemoryEditRow");

const WIN = "C:\\Users\\owner\\.cutex\\projects\\cutex-e-301fa5b7fa0d\\memory";
const POSIX = "/home/owner/.cutex/projects/cutex-e-301fa5b7fa0d/memory";
const file = (id: string, changes: unknown[], status = "completed"): RawItem => ({ type: "fileChange", id, changes, status }) as RawItem;

// Claude Write of a new file (adapter: `{'type': 'add'}`, diff = the content).
const claudeCreate = file("toolu_01", [{
  path: `${WIN}\\project-memory-row.md`,
  kind: { type: "add" },
  diff: "---\nname: project-memory-row\ndescription: Memory edits show as their own row\nmetadata:\n  type: project\n---\n\nThe row.\n",
}]);
// Claude Edit of an existing entry (structuredPatch hunks; no frontmatter in the hunk).
const claudeEdit = file("toolu_02", [{
  path: `${WIN}\\feedback-gate-before-push.md`,
  kind: { type: "update", move_path: null },
  diff: "@@ -6,3 +6,3 @@\n \n-Read the gate.\n+Read the gate's exit before pushing.\n",
}]);
// Claude Edit of MEMORY.md (the index line).
const claudeIndex = file("toolu_03", [{
  path: `${WIN}\\MEMORY.md`,
  kind: { type: "update", move_path: null },
  diff: "@@ -1,2 +1,3 @@\n+- [Memory row](project-memory-row.md) — own row\n - [Gate before push](feedback-gate-before-push.md) — read gate exit\n",
}]);
// Codex apply_patch: update + delete in one patch, POSIX paths.
const codexPatch = file("call_9", [
  { path: `${POSIX}/user-prefs.md`, kind: { type: "update", move_path: null }, diff: "@@ -1,4 +1,4 @@\n ---\n-name: user-prefs\n+name: owner-prefs\n description: Owner preferences\n" },
  { path: `${POSIX}/old-note.md`, kind: { type: "delete" }, diff: "---\nname: old-note\ndescription: Outdated note\n---\nGone.\n" },
]);

describe("memory paths", () => {
  it("cutex's project memory folder on Windows, POSIX and \\\\?\\ paths", () => {
    expect(memoryPathOf(`${WIN}\\x.md`)).toEqual({ dir: WIN.replace(/\\/g, "/"), projectKey: "cutex-e-301fa5b7fa0d", file: "x.md" });
    expect(memoryPathOf(`${POSIX}/MEMORY.md`)?.file).toBe("MEMORY.md");
    expect(memoryPathOf(`\\\\?\\${WIN}\\a_b.c-d.md`)?.file).toBe("a_b.c-d.md");
    expect(memoryPathOf("D:/home/projects/project-0123456789ab/memory/n.md")?.projectKey).toBe("project-0123456789ab");
  });
  it("not memory: Claude Code's own memory folder, a repo's projects/…/memory, other file names", () => {
    for (const p of [
      "C:\\Users\\owner\\.claude\\projects\\D--Programs-cutex-desktop\\memory\\MEMORY.md",
      "/repo/docs/projects/alpha/memory/notes.md",
      `${POSIX}/Notes.md`,
      `${POSIX}/notes.txt`,
      `${POSIX}/sub/x.md`,
      "x.md",
    ]) expect(memoryPathOf(p)).toBeNull();
  });
  it("same folder across separators and drive-letter case", () => {
    expect(sameMemoryDir(WIN, "c:/Users/owner/.cutex/projects/cutex-e-301fa5b7fa0d/memory/")).toBe(true);
    expect(sameMemoryDir(POSIX, "/home/owner/.cutex/projects/other-0123456789ab/memory")).toBe(false);
  });
});

describe("memory edits of a tool call", () => {
  it("Claude Write create: an add with the frontmatter's name", () => {
    expect(memoryEditsOf(claudeCreate)).toMatchObject([{ file: "project-memory-row.md", kind: "add", name: "project-memory-row", description: "Memory edits show as their own row" }]);
  });
  it("Claude Edit: an update; the name is not in the hunk", () => {
    expect(memoryEditsOf(claudeEdit)).toMatchObject([{ file: "feedback-gate-before-push.md", kind: "update", name: null }]);
  });
  it("Codex apply_patch: update (name from the hunk's lines) and delete (from the old text)", () => {
    expect(memoryEditsOf(codexPatch)).toMatchObject([
      { file: "user-prefs.md", kind: "update", name: "owner-prefs", description: "Owner preferences" },
      { file: "old-note.md", kind: "delete", name: "old-note" },
    ]);
  });
  it("a patch that also edits code, a move out of the folder, a shell command: not a memory row", () => {
    expect(memoryEditsOf(file("p", [...(codexPatch.changes as unknown[]), { path: "/repo/src/a.ts", kind: { type: "update", move_path: null }, diff: "" }]))).toBeNull();
    expect(memoryEditsOf(file("m", [{ path: `${POSIX}/a.md`, kind: { type: "update", move_path: "/tmp/a.md" }, diff: "" }]))).toBeNull();
    // Shell writes into the folder stay command rows (best effort: never shown as a memory edit they may not be).
    expect(memoryEditsOf({ type: "commandExecution", id: "c", command: `rm ${POSIX}/old-note.md`, commandActions: [{ type: "unknown", command: "rm" }], status: "completed" } as RawItem)).toBeNull();
    expect(memoryGatherKey({ type: "dynamicToolCall", namespace: "claude", tool: "Read", arguments: { file_path: `${WIN}\\MEMORY.md` }, id: "r" } as RawItem)).toBeNull();
  });
});

describe("the row of a turn", () => {
  it("one file: its verb and name; with MEMORY.md, 「及索引」", () => {
    const row = memoryRow([...memoryEditsOf(claudeCreate)!, ...memoryEditsOf(claudeIndex)!])!;
    expect(row).toMatchObject({ verb: "add", index: true, files: [{ file: "project-memory-row.md", label: "project-memory-row" }] });
  });
  it("names the host knows fill in an edit's; a file edited twice is one file", () => {
    const known = new Map([["feedback-gate-before-push.md", { name: "gate-before-push", description: "Read the gate's exit" }]]);
    const row = memoryRow([...memoryEditsOf(claudeEdit)!, ...memoryEditsOf({ ...claudeEdit, id: "toolu_04" })!], known)!;
    expect(row.files).toHaveLength(1);
    expect(row.files[0]).toMatchObject({ kind: "update", label: "gate-before-push", description: "Read the gate's exit" });
    expect(row.files[0]!.edits).toHaveLength(2);
  });
  it("mixed kinds read 更新; created then edited stays 新增; only the index → 更新项目记忆索引", () => {
    expect(memoryRow([...memoryEditsOf(claudeCreate)!, ...memoryEditsOf(codexPatch)!])!.verb).toBe("update");
    const later = file("toolu_05", [{ path: `${WIN}\\project-memory-row.md`, kind: { type: "update", move_path: null }, diff: "@@ -8 +8 @@\n-The row.\n+The row, grouped.\n" }]);
    expect(memoryRow([...memoryEditsOf(claudeCreate)!, ...memoryEditsOf(later)!])!.files[0]).toMatchObject({ kind: "add", label: "project-memory-row" });
    expect(memoryRow(memoryEditsOf(claudeIndex)!)).toMatchObject({ verb: "index", files: [], index: true });
  });
  it("a running or failed edit marks the row", () => {
    expect(memoryRow(memoryEditsOf({ ...claudeEdit, status: "inProgress" })!)!.status).toBe("running");
    expect(memoryRow([...memoryEditsOf(claudeCreate)!, ...memoryEditsOf({ ...claudeEdit, status: "failed" })!])!.status).toBe("failed");
  });
});

describe("segmentEntries `gather`: a turn's memory edits are one row, outside the work groups", () => {
  const tool = (item: RawItem, turnId = "t1"): TimelineEntry => ({ kind: "tool", id: item.id, turnId, item });
  const cmd = (id: string): RawItem => ({ type: "commandExecution", id, command: "pnpm test", status: "completed", exitCode: 0 }) as RawItem;
  const code = file("code", [{ path: "/repo/src/a.ts", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-a\n+b\n" }]);
  const opts = { gather: memoryGatherKey, standalone: (item: RawItem) => memoryEditsOf(item) !== null };
  it("the first edit holds the place; later ones join it and do not split the work group", () => {
    const segs = segmentEntries([tool(code), tool(claudeCreate), tool(cmd("c1")), tool(claudeIndex), tool(cmd("c2")), tool(claudeEdit, "t2")], opts);
    expect(segs.map((s) => (s.kind === "work" ? `work:${s.steps.map((x) => x.id).join("+")}` : `${s.entry.id}[${s.gathered?.map((g) => g.id).join("+")}]`))).toEqual([
      "work:code",
      "toolu_01[toolu_01+toolu_03]",
      "work:c1+c2",
      "toolu_02[toolu_02]",
    ]);
  });
  it("without gather the segments are as before", () => {
    const segs = segmentEntries([tool(code), tool(cmd("c1"))]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe("work");
  });
});

let root: Root | undefined;
let box: HTMLDivElement;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
async function mount(items: RawItem[]) {
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root!.render(h(MemoryEditRow, { item: items[0]!, items, sessionId: "s1" })));
}
beforeEach(() => {
  env.projectId = "cutex-e";
  env.dir = WIN;
  env.opened = [];
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  box?.remove();
});

describe("MemoryEditRow", () => {
  it("one line: verb · names · count · 及索引; expanded: each file's diff and 在记忆页打开", async () => {
    await mount([claudeCreate, claudeEdit, claudeIndex]);
    const line = box.querySelector('[data-tool-row="memoryEdit"]')!;
    expect(line.getAttribute("data-memory-verb")).toBe("update");
    expect(box.textContent).toContain("projects.memoryEdit.update");
    expect(box.querySelector("[data-memory-names]")!.textContent).toBe("· project-memory-row" + "projects.memoryEdit.separator" + "gate-before-push");
    expect(box.querySelector("[data-memory-count]")!.textContent).toBe("· projects.memoryEdit.count:2");
    expect(box.querySelector("[data-memory-index]")).not.toBeNull();
    expect(box.querySelector("[data-memory-edit-details]")).toBeNull();
    act(() => box.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    expect([...box.querySelectorAll("[data-memory-file]")].map((x) => x.getAttribute("data-memory-file"))).toEqual(["project-memory-row.md", "feedback-gate-before-push.md", "MEMORY.md"]);
    expect(box.querySelectorAll("[data-memory-edit-diff]")).toHaveLength(3);
    act(() => box.querySelector<HTMLButtonElement>("[data-memory-open]")!.click());
    expect(env.opened).toEqual([["projects.page", { project: "cutex-e", tab: "memory", host: "eva" }]]);
  });
  it("another project's memory folder (or no project): the row stays, without 在记忆页打开", async () => {
    // The conversation is in another project (the rows' read of the host's memory list is cached per project).
    env.projectId = "other";
    env.dir = "C:/Users/owner/.cutex/projects/other-0123456789ab/memory";
    await mount([claudeEdit]);
    expect(box.querySelector("[data-memory-names]")!.textContent).toBe("· feedback-gate-before-push");
    act(() => box.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    expect(box.querySelector("[data-memory-open]")).toBeNull();
  });
});
