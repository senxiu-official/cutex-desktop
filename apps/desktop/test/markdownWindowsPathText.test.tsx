// @vitest-environment jsdom
// Windows paths in plain Markdown prose keep their backslashes (TODO "Plain-text Windows paths lose their
// backslashes"): CommonMark reads `\.` `\_` `\-` `\[` and `\\` as escapes, so `C:\Users\developer\.cutex` rendered
// `C:\Users\developer.cutex` and a UNC `\\server\share` rendered `\server\share`. Links / images: markdownWindowsPaths.test.
// Also the approval line's summary, read from cutex's JSON refusal (`C:\\x` there).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writtenWindowsPath, writtenWindowsText } from "../src/renderer/src/lib/workspace";
import { approvalOfTool } from "../src/renderer/src/lib/approvals";

const raw = String.raw;
/** What CommonMark makes of plain text: a backslash before ASCII punctuation is dropped. */
const parse = (s: string) => s.replace(/\\([!-/:-@[-`{-~])/g, "$1");

describe("writtenWindowsText", () => {
  it.each([
    ["a dot folder", raw`日志在 C:\Users\developer\.cutex\logs\daemon.log 里`],
    ["a UNC path", raw`共享盘 \\remote\data\PersonaProjects\_drafts\a.md 可以打开`],
    ["a path with spaces", raw`installed to C:\Program Files\cutex\[beta]\cutex.exe today`],
    ["two paths", raw`copy D:\Work\scratch\-x\a.txt to E:\backup\.old\a.txt now`],
    ["CJK right after it", raw`路径C:\Users\developer\.cutex\下面`],
    ["a quoted path", raw`run "C:\Users\me\.venv\Scripts\python.exe" -V`],
  ])("keeps %s as written", (_, source) => {
    expect(writtenWindowsText(source, parse(source))).toBe(source);
  });

  it("leaves text alone when nothing was lost or it is not a Windows path", () => {
    expect(writtenWindowsText(raw`C:\Users\me\a.txt`, raw`C:\Users\me\a.txt`)).toBeNull();
    expect(writtenWindowsText(raw`a \*literal\* star and /home/me/\_x`, "a *literal* star and /home/me/_x")).toBeNull();
    expect(writtenWindowsText(raw`docs\_x.md and word\C:\x\.y`, parse(raw`docs\_x.md and word\C:\x\.y`))).toBeNull();
    // Every separator doubled: escaped for Markdown on purpose; CommonMark's reading is the meant path.
    expect(writtenWindowsText(raw`C:\\Users\\me\\.cutex`, raw`C:\Users\me\.cutex`)).toBeNull();
    expect(writtenWindowsText(raw`\\\\server\\share`, raw`\\server\share`)).toBeNull();
    // Not a plain reading of the source (a character reference): stays as parsed.
    expect(writtenWindowsText(raw`C:\a&amp;b\.c`, raw`C:\a&b.c`)).toBeNull();
  });

  it("restores the path that was escaped, not the same text earlier in the line (review 2026-11-12)", () => {
    const source = raw`C:\a.b then C:\a\.b and C:\a.b`;
    expect(writtenWindowsText(source, parse(source))).toBe(source);
    const twice = raw`C:\x\.y, C:\x\.y`;
    expect(writtenWindowsText(twice, parse(twice))).toBe(twice);
  });

  it("a UNC start needs a server name and a backslash after it", () => {
    for (const source of [raw`a \\*literal\\* b`, raw`\\ x\.y`, raw`\\server`]) expect(writtenWindowsText(source, parse(source))).toBeNull();
    expect(writtenWindowsText(raw`\\nas-01.lan\share\.git`, raw`\nas-01.lan\share.git`)).toBe(raw`\\nas-01.lan\share\.git`);
  });

  it("a link destination escaped on purpose is not doubled back", () => {
    expect(writtenWindowsPath(raw`[a](C:\\Users\\me\\.cutex\\a.png)`, raw`C:\Users\me\.cutex\a.png`)).toBeNull();
  });
});

describe("approvalOfTool summary", () => {
  const id = "apr-0123456789abcdef";
  const tool = (result: unknown) => ({ type: "mcpToolCall", server: "cutex", tool: "service_register", status: "completed", result });
  const detail = (summary: string) => `Nothing was done yet: this needs the owner's approval (${summary}). The owner sees the request in the cutex desktop.`;
  const summary = raw`register static service notes: serve \\remote\data\notes (outside the agent's cwd / project workspace)`;

  it("decodes the JSON refusal: single backslashes, quotes", () => {
    const refusal = { ok: false, status: "approval_required", code: "approval_required", approval_id: id, detail: detail(summary) };
    expect(approvalOfTool(tool({ content: [{ type: "text", text: JSON.stringify(refusal) }], isError: true }))?.summary).toBe(summary);
    expect(approvalOfTool(tool(refusal))?.summary).toBe(summary);
    const quoted = raw`register managed service web: cmd /c "C:\Program Files\nodejs\npm.cmd" run dev`;
    expect(approvalOfTool(tool({ content: [{ type: "text", text: JSON.stringify({ ...refusal, detail: detail(quoted) }) }] }))?.summary).toBe(quoted);
  });

  it("keeps a summary that spans lines (a multi-line shell command; review 2026-11-12)", () => {
    const multi = "register managed service web: cmd /c \"npm run build\nnpm run serve\"";
    const refusal = { ok: false, code: "approval_required", approval_id: id, detail: detail(multi) };
    expect(approvalOfTool(tool({ content: [{ type: "text", text: JSON.stringify(refusal) }] }))?.summary).toBe(multi);
    expect(approvalOfTool(tool({ content: [{ type: "text", text: JSON.stringify(refusal).slice(0, -3) }] }))?.summary).toBe(multi);
  });

  it("reads a cut-off JSON text and plain text without inventing escapes", () => {
    const cut = JSON.stringify({ code: "approval_required", approval_id: id, detail: detail(summary) }).slice(0, -3);
    expect(approvalOfTool(tool({ content: [{ type: "text", text: cut }] }))?.summary).toBe(summary);
    const plain = `approval_required (approval_id ${id}): ${detail(raw`serve C:\new\tmp`)}`;
    expect(approvalOfTool(tool({ content: [{ type: "text", text: plain }] }))?.summary).toBe(raw`serve C:\new\tmp`);
  });
});

// The real Markdown pipeline (streamdown → remark → rehype).
const mocks = vi.hoisted(() => ({ state: { sidebar: null, byHost: {}, hosts: null, selectedId: null, features: new Set(["fs-file-read"]) } as Record<string, unknown> }));
vi.mock("../src/renderer/src/store", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, useApp: Object.assign((select: (s: unknown) => unknown) => select(mocks.state), { getState: () => mocks.state, subscribe: () => () => {}, setState: () => {} }) };
});
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: vi.fn() }, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (value: string) => value }));
vi.mock("../src/renderer/src/components/CutexLink", () => ({ CutexLink: ({ children }: { children: unknown }) => h("span", null, children as string), CutexImage: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { Markdown } = await import("../src/renderer/src/components/Markdown");
const { Streamdown } = await import("streamdown");
const { BARE_STREAMDOWN_REHYPE } = await import("../src/renderer/src/lib/markdownPathText");

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const PROSE = [
  raw`日志在 C:\Users\developer\.cutex\logs\daemon.log 里。`,
  raw`共享盘 \\remote\data\_drafts\a.md，`,
  raw`装在 C:\Program Files\cutex\[beta]\cutex.exe。`,
];
const TEXT = [
  ...PROSE,
  raw`- 列表 D:\Work\scratch\-x\a.txt`,
  raw`**粗体 E:\backup\.old**`,
  raw`[链接文字 C:\Users\me\.cutex](https://example.test/)`,
  "`" + raw`code C:\a\.b` + "` and a " + raw`\*star\*`,
].join("\n\n");

function expectWritten(shown: string) {
  for (const line of PROSE) expect(shown).toContain(line);
  expect(shown).toContain(raw`D:\Work\scratch\-x\a.txt`);
  expect(shown).toContain(raw`E:\backup\.old`);
  expect(shown).toContain(raw`链接文字 C:\Users\me\.cutex`);
  expect(shown).toContain(raw`code C:\a\.b`);
  // Ordinary escapes keep their Markdown meaning.
  expect(shown).toContain("a *star*");
  expect(shown).not.toContain("developer.cutex");
}

describe("Markdown: Windows paths in prose", () => {
  it.each([false, true])("keep the written backslashes (streaming: %s)", async (streaming) => {
    await act(async () => root.render(h(Markdown, { text: TEXT, streaming })));
    expectWritten(host.textContent ?? "");
  });

  it.each([false, true])("restores the escaped occurrence, not an earlier identical one (streaming: %s)", async (streaming) => {
    const line = raw`先看 C:\a.b，再看 C:\a\.b。`;
    await act(async () => root.render(h(Markdown, { text: line, streaming })));
    expect(host.textContent).toContain(line);
  });

  it("in a bare Streamdown (notes, side chat) too", async () => {
    await act(async () => root.render(h(Streamdown, { mode: "static", rehypePlugins: BARE_STREAMDOWN_REHYPE }, TEXT)));
    expectWritten(host.textContent ?? "");
  });
});
