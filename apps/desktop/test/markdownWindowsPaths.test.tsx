// @vitest-environment jsdom
// Windows paths in markdown links / images keep the backslashes they were written with (owner report 2026-11-10:
// `![x](C:\Users\me\.cutex\…\a.png)` opened `C:\Users\me.cutex\…` — CommonMark reads `\.` as an escaped `.` —
// and the file view said `path_not_found`). A path that is not there reads in plain words in the file view.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writtenWindowsPath } from "../src/renderer/src/lib/workspace";
import { isPathMissingError } from "../src/renderer/src/lib/pathKind";

const BLOB = String.raw`C:\Users\developer\.cutex\claude-accounts\ca-x\projects\D--Programs-app\05da7338\tool-results\mcp-cutex-blob-1-xb.png`;
const PARSED = BLOB.replace(String.raw`\.cutex`, ".cutex");

describe("writtenWindowsPath", () => {
  it("restores a Windows path whose backslash escapes the parser removed", () => {
    expect(writtenWindowsPath(`![管理服务](${BLOB})`, PARSED)).toBe(BLOB);
    expect(writtenWindowsPath(`[a](${BLOB})`, PARSED)).toBe(BLOB);
    expect(writtenWindowsPath(`[a](<${BLOB}>)`, PARSED)).toBe(BLOB);
    expect(writtenWindowsPath(`[a](${BLOB} "title")`, PARSED)).toBe(BLOB);
    // Percent-encoded by the hast step.
    expect(writtenWindowsPath(`[a](${BLOB})`, encodeURI(PARSED))).toBe(BLOB);
    // UNC and other escapable punctuation (`\_`, `\-`, `\[`).
    const unc = String.raw`\\server\share\_drafts\-old\a.txt`;
    expect(writtenWindowsPath(`[a](${unc})`, String.raw`\server\share_drafts-old\a.txt`)).toBe(unc);
  });

  it("leaves everything else alone", () => {
    // Nothing escaped: the parsed path is already right.
    expect(writtenWindowsPath(String.raw`[a](C:\Users\me\a.png)`, String.raw`C:\Users\me\a.png`)).toBeNull();
    // POSIX / relative / URLs: backslash escapes keep their markdown meaning.
    expect(writtenWindowsPath(String.raw`[a](/home/me/\_x.md)`, "/home/me/_x.md")).toBeNull();
    expect(writtenWindowsPath(String.raw`[a](docs\_x.md)`, "docs_x.md")).toBeNull();
    expect(writtenWindowsPath(String.raw`[a](https://x.test/a\_b)`, "https://x.test/a_b")).toBeNull();
    // A destination the parser did not read from this source.
    expect(writtenWindowsPath(`[a](${BLOB})`, String.raw`C:\other.png`)).toBeNull();
    expect(writtenWindowsPath("plain text", PARSED)).toBeNull();
  });
});

describe("isPathMissingError", () => {
  it("matches cutex path_not_found only", () => {
    expect(isPathMissingError(new Error("path_not_found: the path does not exist"))).toBe(true);
    expect(isPathMissingError(new Error("404 path_not_found: image no longer available"))).toBe(true);
    expect(isPathMissingError(new Error("workspace_path_not_foundx"))).toBe(false);
    expect(isPathMissingError(new Error("not_a_file: path is not a regular file"))).toBe(false);
  });
});

// The real Markdown pipeline (streamdown → remark → rehype): the chip carries the path as written.
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

describe("Markdown: a Windows path link / image", () => {
  it.each([false, true])("keeps the written backslashes (streaming: %s)", async (streaming) => {
    const text = `看这张：\n\n![管理服务](${BLOB})\n\n还有 [日志](C:\\Users\\developer\\.cutex\\logs\\a.txt)。`;
    await act(async () => root.render(h(Markdown, { text, streaming })));
    const titles = [...host.querySelectorAll("[title]")].map((e) => e.getAttribute("title"));
    expect(titles).toContain(BLOB);
    expect(titles).toContain(String.raw`C:\Users\developer\.cutex\logs\a.txt`);
    expect(titles.some((x) => x?.includes("developer.cutex"))).toBe(false);
  });
});
