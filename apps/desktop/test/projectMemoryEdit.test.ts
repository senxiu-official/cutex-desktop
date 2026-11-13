// @vitest-environment jsdom
// 项目 → 记忆 editing (cutex `project-memory`): the file / frontmatter rules, the MEMORY.md line rule, the save flow
// with revisions, and the main-process wire (PUT / DELETE, refusals as data).
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {}, app: { getPath: () => "" } }));
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { DaemonService, memoryRefusal } from "../src/main/daemon";
import {
  memoryDraftProblems,
  memoryFileProblem,
  nextMemoryIndex,
  parseMemory,
  saveMemoryEntry,
  serializeMemory,
  slugify,
  yamlScalar,
  type MemoryApi,
} from "../src/shared/projectMemory";
import { memoryApi } from "../src/renderer/src/modules/projects/mock";

const FILE = `---
name: owner-prefs
description: Owner likes plain words
metadata:
  type: user
  extra: kept
source: hand
---

Body line one.
**Why:** reasons.
`;

describe("file and frontmatter rules", () => {
  it("accepts cutex file names and refuses the index, odd names and taken ones", () => {
    expect(memoryFileProblem("feedback-x_1.2.md")).toBeNull();
    expect(memoryFileProblem("MEMORY.md")).toBe("fileIndex");
    for (const bad of ["Upper.md", "-lead.md", ".md", "a.txt", "a/b.md", "../x.md", "a b.md", `${"a".repeat(126)}.md`]) expect(memoryFileProblem(bad)).toBe("fileName");
    expect(memoryFileProblem("x.md", ["x.md"])).toBe("fileTaken");
  });

  it("validates name, description, type and size like cutex", () => {
    const ok = { name: "a-b-1", description: "one line", type: "project", body: "x", frontmatter: null };
    expect(memoryDraftProblems(ok)).toEqual([]);
    expect(memoryDraftProblems({ ...ok, name: "A b" })).toEqual(["name"]);
    expect(memoryDraftProblems({ ...ok, name: "a--b" })).toEqual(["name"]);
    expect(memoryDraftProblems({ ...ok, name: "a".repeat(65) })).toEqual(["name"]);
    expect(memoryDraftProblems({ ...ok, description: "  " })).toEqual(["description"]);
    expect(memoryDraftProblems({ ...ok, description: "x".repeat(301) })).toEqual(["description"]);
    expect(memoryDraftProblems({ ...ok, description: "two\nlines" })).toEqual(["descriptionLines"]);
    expect(memoryDraftProblems({ ...ok, type: "other" })).toEqual(["type"]);
    expect(memoryDraftProblems({ ...ok, body: "字".repeat(22_000) })).toEqual(["tooLarge"]);
    expect(slugify("My Fact: Windows ACL!")).toBe("my-fact-windows-acl");
  });

  it("parses the fields cutex reads and round-trips an untouched file", () => {
    const d = parseMemory(FILE);
    expect([d.name, d.description, d.type]).toEqual(["owner-prefs", "Owner likes plain words", "user"]);
    expect(d.body).toBe("Body line one.\n**Why:** reasons.\n");
    expect(serializeMemory(d)).toBe(FILE);
  });

  it("rewrites only changed fields and keeps keys the form doesn't show", () => {
    const d = parseMemory(FILE);
    const out = serializeMemory({ ...d, description: "Plain words: always", type: "feedback", body: "New body" });
    expect(out).toContain('description: "Plain words: always"');
    expect(out).toContain("metadata:\n  type: feedback\n  extra: kept\nsource: hand");
    expect(out.endsWith("---\n\nNew body\n")).toBe(true);
    expect(parseMemory(out)).toMatchObject({ name: "owner-prefs", description: "Plain words: always", type: "feedback" });
  });

  it("builds a full frontmatter for a new file or one without a block", () => {
    const out = serializeMemory({ name: "n", description: "d", type: "reference", body: "b", frontmatter: null });
    expect(out).toBe("---\nname: n\ndescription: d\nmetadata:\n  type: reference\n---\n\nb\n");
    const legacy = parseMemory("# just text\n");
    expect(legacy.frontmatter).toBeNull();
    expect(parseMemory(serializeMemory({ ...legacy, name: "x", description: "y", type: "project" }))).toMatchObject({ name: "x", type: "project", body: "# just text\n" });
  });

  it("quotes scalars that would read back differently", () => {
    for (const v of ["a: b", "x #y", "- lead", "true", "123", '"q"', "back\\slash \"q\" #c", "ends:"]) {
      expect(yamlScalar(v)).not.toBe(v);
      expect(parseMemory(`---\ndescription: ${yamlScalar(v)}\n---\n`).description).toBe(v);
    }
    expect(yamlScalar("plain words, 中文")).toBe("plain words, 中文");
  });
});

describe("MEMORY.md line", () => {
  const index = "# Index\n\n- [Plain words](a.md) — owner's own hook\n- [b](b.md) — old\n";

  it("leaves the line alone when name and description didn't change", () => {
    expect(nextMemoryIndex(index, "a.md", { name: "a", description: "d" }, { name: "a", description: "d" })).toBeNull();
  });

  it("keeps an owner title, follows a rename only when the title was the name, and updates the hook", () => {
    expect(nextMemoryIndex(index, "a.md", { name: "a", description: "d" }, { name: "a2", description: "new" })).toBe("# Index\n\n- [Plain words](a.md) — new\n- [b](b.md) — old\n");
    expect(nextMemoryIndex(index, "b.md", { name: "b", description: "old" }, { name: "b2", description: "old2" })).toBe("# Index\n\n- [Plain words](a.md) — owner's own hook\n- [b2](b.md) — old2\n");
  });

  it("adds a missing line at the top of the entries (newest first) or starts an index", () => {
    expect(nextMemoryIndex(index, "c.md", null, { name: "c", description: "see" })).toBe("# Index\n\n- [c](c.md) — see\n- [Plain words](a.md) — owner's own hook\n- [b](b.md) — old\n");
    expect(nextMemoryIndex(null, "c.md", null, { name: "c", description: "see" })).toBe("- [c](c.md) — see\n");
  });
});

describe("save flow", () => {
  const draft = { name: "c", description: "see", type: "project", body: "b", frontmatter: null };

  it("creates with create-only, then writes the index with its revision", async () => {
    const api = { projectMemory: vi.fn().mockResolvedValue({ dir: "", index: "- [a](a.md) — x\n", indexRevision: "ir", entries: [{ file: "c.md", name: "c", revision: "r2" }] }), projectMemoryDelete: vi.fn(), projectMemoryWrite: vi.fn().mockResolvedValue({ ok: true, file: "x", revision: "r2", indexUpdated: false }) } satisfies MemoryApi;
    const r = await saveMemoryEntry(api, "p", { file: "c.md", draft, baseRevision: null, prev: null });
    expect(r).toEqual({ ok: true, revision: "r2", indexError: null });
    expect(api.projectMemoryWrite.mock.calls).toEqual([
      ["p", "c.md", serializeMemory(draft), null, false],
      ["p", "MEMORY.md", "- [c](c.md) — see\n- [a](a.md) — x\n", "ir", false],
    ]);
  });

  it("returns an entry conflict without touching the index", async () => {
    const api = { projectMemory: vi.fn(), projectMemoryDelete: vi.fn(), projectMemoryWrite: vi.fn().mockResolvedValue({ ok: false, code: "revision_conflict", currentRevision: "now", message: "m" }) } satisfies MemoryApi;
    const r = await saveMemoryEntry(api, "p", { file: "c.md", draft, baseRevision: "old", prev: { name: "c", description: "x" } });
    expect(r).toMatchObject({ ok: false, code: "revision_conflict", currentRevision: "now" });
    expect(api.projectMemoryWrite).toHaveBeenCalledTimes(1);
  });

  it("re-reads and re-applies the line once when MEMORY.md changed meanwhile", async () => {
    const write = vi.fn()
      .mockResolvedValueOnce({ ok: true, file: "c.md", revision: "r", indexUpdated: false })
      .mockResolvedValueOnce({ ok: false, code: "revision_conflict", currentRevision: "ir2", message: "m" })
      .mockResolvedValueOnce({ ok: true, file: "MEMORY.md", revision: "ir3", indexUpdated: false });
    const read = vi.fn()
      .mockResolvedValueOnce({ dir: "", index: null, indexRevision: null, entries: [{ file: "c.md", name: "c", revision: "r" }] })
      .mockResolvedValueOnce({ dir: "", index: "- [z](z.md) — agent added\n", indexRevision: "ir2", entries: [{ file: "c.md", name: "c", revision: "r" }] });
    const api = { projectMemory: read, projectMemoryDelete: vi.fn(), projectMemoryWrite: write } satisfies MemoryApi;
    const r = await saveMemoryEntry(api, "p", { file: "c.md", draft, baseRevision: null, prev: null });
    expect(r).toEqual({ ok: true, revision: "r", indexError: null });
    expect(write.mock.calls[2]).toEqual(["p", "MEMORY.md", "- [c](c.md) — see\n- [z](z.md) — agent added\n", "ir2", false]);
  });

  it("reports an index that still can't be written, with the entry saved", async () => {
    const write = vi.fn()
      .mockResolvedValueOnce({ ok: true, file: "c.md", revision: "r", indexUpdated: false })
      .mockResolvedValue({ ok: false, code: "revision_conflict", currentRevision: "x", message: "busy" });
    const api = { projectMemory: vi.fn().mockResolvedValue({ dir: "", index: "", indexRevision: "x", entries: [{ file: "c.md", name: "c", revision: "r" }] }), projectMemoryDelete: vi.fn(), projectMemoryWrite: write } satisfies MemoryApi;
    expect(await saveMemoryEntry(api, "p", { file: "c.md", draft, baseRevision: null, prev: null })).toEqual({ ok: true, revision: "r", indexError: "busy" });
    expect(write).toHaveBeenCalledTimes(3);
  });
});

describe("index consistency against the preview daemon", () => {
  const linesFor = (index: string | null | undefined, file: string) => (index ?? "").split("\n").filter((l) => l.includes(`](${file})`));

  it("edit, create and delete keep one MEMORY.md line per file and none for deleted ones", async () => {
    const api = memoryApi();
    let view = (await api.projectMemory("desktop"))!;
    const files = view.entries.map((e) => e.file);
    for (const f of files) expect(linesFor(view.index, f)).toHaveLength(1);

    // Edit the description of a file whose index title is the owner's own ("Decisions").
    const doc = await api.projectMemoryFile("desktop", "decisions.md");
    const d = parseMemory(doc.content);
    const edited = await saveMemoryEntry(api, "desktop", { file: "decisions.md", draft: { ...d, description: "what we decided" }, baseRevision: doc.revision!, prev: d });
    expect(edited.ok).toBe(true);
    view = (await api.projectMemory("desktop"))!;
    expect(linesFor(view.index, "decisions.md")).toEqual(["- [Decisions](decisions.md) — what we decided"]);
    expect(view.entries.find((e) => e.file === "decisions.md")).toMatchObject({ description: "what we decided" });

    // A stale revision is refused (an agent changed it meanwhile).
    const stale = await api.projectMemoryWrite("desktop", "decisions.md", doc.content, doc.revision!, false);
    expect(stale).toMatchObject({ ok: false, code: "revision_conflict" });

    // Create, then delete.
    const created = await saveMemoryEntry(api, "desktop", { file: "new-fact.md", draft: { name: "new-fact", description: "fresh", type: "project", body: "x", frontmatter: null }, baseRevision: null, prev: null });
    expect(created.ok).toBe(true);
    view = (await api.projectMemory("desktop"))!;
    expect(view.index!.split("\n")[0]).toBe("- [new-fact](new-fact.md) — fresh");
    const again = await api.projectMemoryWrite("desktop", "new-fact.md", serializeMemory({ name: "new-fact", description: "dup", type: "project", body: "", frontmatter: null }), null, false);
    expect(again).toMatchObject({ ok: false, code: "revision_conflict" });

    const rev = view.entries.find((e) => e.file === "new-fact.md")!.revision!;
    expect(await api.projectMemoryDelete("desktop", "new-fact.md", "sha256:wrong")).toMatchObject({ ok: false, code: "revision_conflict" });
    expect(await api.projectMemoryDelete("desktop", "new-fact.md", rev)).toMatchObject({ ok: true, indexUpdated: true });
    view = (await api.projectMemory("desktop"))!;
    expect(view.entries.map((e) => e.file)).toEqual(files);
    expect(linesFor(view.index, "new-fact.md")).toEqual([]);
    for (const f of files) expect(linesFor(view.index, f)).toHaveLength(1);
  });
});

describe("main process wire", () => {
  const service = (request: ReturnType<typeof vi.fn>) => Object.assign(Object.create(DaemonService.prototype), { requireClient: () => ({ request }) }) as DaemonService;

  it("PUTs content with the revision and index flag; DELETEs with the revision as a query", async () => {
    const request = vi.fn().mockResolvedValueOnce({ file: "a.md", revision: "r2", indexUpdated: true }).mockResolvedValueOnce({ file: "a.md", indexUpdated: true });
    const s = service(request);
    expect(await s.projectMemoryWrite("proj:a", "a.md", "c", "r1", false)).toEqual({ ok: true, file: "a.md", revision: "r2", indexUpdated: true });
    expect(await s.projectMemoryDelete("proj:a", "a.md", "r2")).toEqual({ ok: true, file: "a.md", revision: null, indexUpdated: true });
    expect(request.mock.calls).toEqual([
      ["PUT", "/v2/projects/proj%3Aa/memory/a.md", { body: { content: "c", expectedRevision: "r1", updateIndex: false } }],
      ["DELETE", "/v2/projects/proj%3Aa/memory/a.md", { query: { expectedRevision: "r2" } }],
    ]);
  });

  it("refuses malformed calls from the renderer", async () => {
    const s = service(vi.fn());
    await expect(s.projectMemoryWrite("p", "a.md", "c", "", false)).rejects.toThrow();
    await expect(s.projectMemoryWrite("p", "a.md", 1 as unknown as string, null, false)).rejects.toThrow();
    await expect(s.projectMemoryDelete("p", "a.md", "")).rejects.toThrow();
    await expect(s.projectMemoryDelete("", "a.md", "r")).rejects.toThrow();
  });

  it("turns cutex refusals into data and keeps the conflict's current revision; other failures throw", () => {
    expect(memoryRefusal(new CutexApiError(409, "revision_conflict", "m", false, { currentRevision: "now" }))).toEqual({ ok: false, code: "revision_conflict", currentRevision: "now", message: "revision_conflict: m" });
    expect(memoryRefusal(new CutexApiError(400, "invalid_memory_content", "bad"))).toMatchObject({ ok: false, code: "invalid_memory_content" });
    expect(memoryRefusal(new CutexApiError(404, "project_not_found", "x"))).toMatchObject({ ok: false, code: "other" });
    expect(() => memoryRefusal(new CutexApiError(503, "memory_store_unavailable", "io"))).toThrow();
    expect(() => memoryRefusal(new CutexApiError(403, "forbidden", "no"))).toThrow();
    expect(() => memoryRefusal(new Error("offline"))).toThrow();
  });
});

// Cross-review of c7a0476cb (GPT, MERGE AFTER FIXES): one regression test per finding.
describe("review fixes", () => {
  const linesFor = (index: string | null | undefined, file: string) => (index ?? "").split("\n").filter((l) => l.includes(`](${file})`));

  it("1: 'save mine' after another writer deleted the memory recreates it with its index line", async () => {
    const api = memoryApi();
    const stale = (await api.projectMemory("desktop"))!;
    const doc = await api.projectMemoryFile("desktop", "decisions.md");
    const d = parseMemory(doc.content);
    // Another writer deletes it while the owner edits the body; the conflict says it is gone (current = null).
    expect(await api.projectMemoryDelete("desktop", "decisions.md", doc.revision!)).toMatchObject({ ok: true });
    expect(linesFor((await api.projectMemory("desktop"))!.index, "decisions.md")).toEqual([]);
    const r = await saveMemoryEntry(api, "desktop", { file: "decisions.md", draft: { ...d, body: "Mine." }, baseRevision: null, prev: d });
    expect(r).toMatchObject({ ok: true, indexError: null });
    const now = (await api.projectMemory("desktop"))!;
    expect(now.entries.some((e) => e.file === "decisions.md")).toBe(true);
    expect(linesFor(now.index, "decisions.md")).toHaveLength(1);
  });

  it("2: an entry deleted between its write and the index write gets no link back, and the save says so", async () => {
    for (const [file, prevOf] of [["decisions.md", true], ["brand-new.md", false]] as const) {
      const real = memoryApi();
      // Another writer deletes the entry right after our entry write lands.
      const api: MemoryApi = {
        ...real,
        async projectMemoryWrite(projectId, f, content, expected, updateIndex) {
          const r = await real.projectMemoryWrite(projectId, f, content, expected, updateIndex);
          if (r.ok && f === file) await real.projectMemoryDelete(projectId, f, r.revision!);
          return r;
        },
      };
      const view = (await real.projectMemory("desktop"))!;
      const doc = prevOf ? await real.projectMemoryFile("desktop", file) : null;
      const d = doc ? parseMemory(doc.content) : { name: "brand-new", description: "fresh", type: "project", body: "x", frontmatter: null };
      const r = await saveMemoryEntry(api, "desktop", { file, draft: { ...d, description: "changed hook" }, baseRevision: doc?.revision ?? null, prev: doc ? d : null });
      expect(r, file).toMatchObject({ ok: false, code: "memory_not_found" });
      const now = (await real.projectMemory("desktop"))!;
      expect(now.entries.some((e) => e.file === file), file).toBe(false);
      expect(linesFor(now.index, file), file).toEqual([]);
    }
  });

  it("2b: an entry rewritten by someone else right after our write leaves the index to them and reports the conflict", async () => {
    const real = memoryApi();
    const api: MemoryApi = {
      ...real,
      async projectMemoryWrite(projectId, f, content, expected, updateIndex) {
        const r = await real.projectMemoryWrite(projectId, f, content, expected, updateIndex);
        if (r.ok && f === "decisions.md") await real.projectMemoryWrite(projectId, f, content.replace("Decisions", "Agent's decisions"), r.revision, false);
        return r;
      },
    };
    const before = (await real.projectMemory("desktop"))!;
    const doc = await real.projectMemoryFile("desktop", "decisions.md");
    const d = parseMemory(doc.content);
    const r = await saveMemoryEntry(api, "desktop", { file: "decisions.md", draft: { ...d, description: "mine" }, baseRevision: doc.revision!, prev: d });
    const now = (await real.projectMemory("desktop"))!;
    expect(r).toMatchObject({ ok: false, code: "revision_conflict", currentRevision: now.entries.find((e) => e.file === "decisions.md")!.revision });
    expect(now.index).toBe(before.index);
  });

  it("3: untouched frontmatter keeps its BOM, CRLF and '...' close byte for byte, also when only the body changes", () => {
    const raw = "﻿---\r\nname: crlf-fact\r\ndescription: kept as is\r\nmetadata:\r\n  type: project\r\n...\r\n\r\nBody one.\r\nBody two.\r\n";
    const d = parseMemory(raw);
    expect([d.name, d.description, d.type]).toEqual(["crlf-fact", "kept as is", "project"]);
    expect(serializeMemory(d)).toBe(raw);
    expect(serializeMemory({ ...d, body: "New body.\r\n" })).toBe("﻿---\r\nname: crlf-fact\r\ndescription: kept as is\r\nmetadata:\r\n  type: project\r\n...\r\n\r\nNew body.\r\n");
    // A metadata change keeps the file's BOM, line ends and closing delimiter.
    expect(serializeMemory({ ...d, description: "new hook" })).toBe("﻿---\r\nname: crlf-fact\r\ndescription: new hook\r\nmetadata:\r\n  type: project\r\n...\r\n\r\nBody one.\r\nBody two.\r\n");
  });
});
