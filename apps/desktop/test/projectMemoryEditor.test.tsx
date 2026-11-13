// @vitest-environment jsdom
// 项目 → 记忆 editor (components/ProjectMemory): edit / new / delete through the host api, the click-twice delete,
// the conflict notice, and no controls without cutex `project-memory`.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ api: null as any }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (s: any) => unknown) => select({ hosts: { active: "local" } }), hostApi: () => fx.api }));
vi.mock("../src/renderer/src/components/Markdown", () => ({ Markdown: ({ text }: { text: string }) => h("pre", { "data-md": "" }, text) }));
import { ProjectMemoryList } from "../src/renderer/src/components/ProjectMemory";
import { memoryApi } from "../src/renderer/src/modules/projects/mock";
import type { ProjectMemoryView } from "../src/shared/ipc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let memory: ProjectMemoryView | null = null;
const onChanged = vi.fn();

beforeEach(() => {
  const real = memoryApi();
  fx.api = { ...real, projectMemoryWrite: vi.fn(real.projectMemoryWrite), projectMemoryDelete: vi.fn(real.projectMemoryDelete) };
  // Reload like the page does; the caller's act (click + flush) commits it.
  onChanged.mockReset().mockImplementation(() => void fx.api.projectMemory("desktop").then((m: ProjectMemoryView) => {
    memory = m;
    root.render(view());
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

let editable = true;
const view = () => h(ProjectMemoryList, { hostId: "local", projectId: "desktop", memory, editable, onChanged });
const render = () => act(async () => root.render(view()));
const mount = async (canEdit = true) => {
  editable = canEdit;
  memory = await fx.api.projectMemory("desktop");
  await render();
};
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T & HTMLElement>(sel);
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const type = async (label: string, value: string) => {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const openEntry = (file: string) => click(q(`[data-memory-file="${file}"] > button`));

it("edits an entry with the revision it was read at and keeps the owner's index title", async () => {
  await mount();
  await openEntry("decisions.md");
  await click(q('[data-testid="memory-edit"]'));
  expect(q('[aria-label="projects.memoryFile"]')!.hasAttribute("disabled")).toBe(true);
  await type("projects.memoryDescription", "what we decided");
  await type("projects.memoryBody", "Edited body.");
  await click(q('[data-testid="memory-save"]'));
  const [projectId, file, content, expected, updateIndex] = fx.api.projectMemoryWrite.mock.calls[0];
  expect([projectId, file, updateIndex]).toEqual(["desktop", "decisions.md", false]);
  expect(expected).toMatch(/^sha256:/);
  expect(content).toContain("description: what we decided");
  expect(content).toContain("Edited body.");
  expect(fx.api.projectMemoryWrite.mock.calls[1][1]).toBe("MEMORY.md");
  expect(onChanged).toHaveBeenCalled();
  expect(memory!.index).toContain("- [Decisions](decisions.md) — what we decided");
  expect(q('[data-testid="memory-editor"]')).toBeNull();
  expect(q('[data-memory-file="decisions.md"] [data-md]')!.textContent).toContain("Edited body.");
});

it("shows problems and blocks saving an invalid draft", async () => {
  await mount();
  await click(q('[data-testid="memory-new"]'));
  await type("projects.memoryName", "Bad Name");
  expect(host.textContent).toContain("projects.memoryProblemName");
  expect(host.textContent).toContain("projects.memoryProblemDescription");
  expect(q<HTMLButtonElement>('[data-testid="memory-save"]')!.disabled).toBe(true);
  await type("projects.memoryName", "windows-acl");
  expect(host.textContent).toContain("projects.memoryProblemFileTaken");
});

it("creates a new entry create-only and adds its index line at the top", async () => {
  await mount();
  await click(q('[data-testid="memory-new"]'));
  await type("projects.memoryName", "release-day");
  expect(q<HTMLInputElement>('[aria-label="projects.memoryFile"]')!.value).toBe("release-day.md");
  await type("projects.memoryDescription", "releases go out on Fridays");
  await type("projects.memoryBody", "Fridays.");
  await click(q('[data-testid="memory-save"]'));
  expect(fx.api.projectMemoryWrite.mock.calls[0].slice(0, 2)).toEqual(["desktop", "release-day.md"]);
  expect(fx.api.projectMemoryWrite.mock.calls[0][3]).toBeNull();
  expect(memory!.index!.split("\n")[0]).toBe("- [release-day](release-day.md) — releases go out on Fridays");
  expect(q('[data-memory-file="release-day.md"]')).not.toBeNull();
});

it("deletes only on the second click, with the revision, and the index line goes too", async () => {
  await mount();
  await openEntry("windows-acl.md");
  await click(q('[data-testid="memory-delete"]'));
  expect(fx.api.projectMemoryDelete).not.toHaveBeenCalled();
  expect(q('[data-testid="memory-delete"]')!.getAttribute("data-armed")).toBe("true");
  await click(q('[data-testid="memory-delete"]'));
  expect(fx.api.projectMemoryDelete).toHaveBeenCalledWith("desktop", "windows-acl.md", expect.stringMatching(/^sha256:/));
  expect(q('[data-memory-file="windows-acl.md"]')).toBeNull();
  expect(memory!.index).not.toContain("windows-acl.md");
});

it("a delete that meets a newer version reloads instead of deleting", async () => {
  await mount();
  await openEntry("windows-acl.md");
  const doc = await fx.api.projectMemoryFile("desktop", "windows-acl.md");
  await fx.api.projectMemoryWrite("desktop", "windows-acl.md", `${doc.content}agent line\n`, doc.revision, false);
  await click(q('[data-testid="memory-delete"]'));
  await click(q('[data-testid="memory-delete"]'));
  expect(host.textContent).toContain("projects.memoryDeleteConflict");
  expect(q('[data-memory-file="windows-acl.md"] [data-md]')!.textContent).toContain("agent line");
  expect(memory!.entries.some((e) => e.file === "windows-acl.md")).toBe(true);
});

it("on an edit conflict offers to save mine (with the new revision) or discard", async () => {
  await mount();
  await openEntry("decisions.md");
  await click(q('[data-testid="memory-edit"]'));
  const doc = await fx.api.projectMemoryFile("desktop", "decisions.md");
  await fx.api.projectMemoryWrite("desktop", "decisions.md", `${doc.content}agent line\n`, doc.revision, false);
  await type("projects.memoryBody", "Mine.");
  await click(q('[data-testid="memory-save"]'));
  expect(q('[data-testid="memory-conflict"]')!.textContent).toContain("projects.memoryConflict");
  const current = (await fx.api.projectMemoryFile("desktop", "decisions.md")).revision;
  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "projects.memoryOverwrite")!);
  expect(fx.api.projectMemoryWrite.mock.calls.at(-1)).toBeDefined();
  const entryWrites = fx.api.projectMemoryWrite.mock.calls.filter((c: unknown[]) => c[1] === "decisions.md");
  expect(entryWrites.at(-1)[3]).toBe(current);
  expect((await fx.api.projectMemoryFile("desktop", "decisions.md")).content).toContain("Mine.");
});

it("without project-memory the list is read-only", async () => {
  await mount(false);
  expect(q('[data-testid="memory-new"]')).toBeNull();
  await openEntry("decisions.md");
  expect(q('[data-memory-file="decisions.md"] [data-md]')).not.toBeNull();
  expect(q('[data-testid="memory-edit"]')).toBeNull();
  expect(q('[data-testid="memory-delete"]')).toBeNull();
});
