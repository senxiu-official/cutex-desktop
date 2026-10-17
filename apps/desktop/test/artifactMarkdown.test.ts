// Artifact preview of a Markdown document (modules/artifacts/TextPreview): rendered with the chat
// renderer (no raw HTML, no scripts), 源代码 shows the text, relative images / links stay inert.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({
  api: { openExternal: () => Promise.resolve() },
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

const { TextPreview } = await import("../src/renderer/src/modules/artifacts/TextPreview");
const { previewKind } = await import("../src/renderer/src/modules/artifacts/model");

const DOC = [
  "# Regression report",
  "",
  "Some **bold** text and a [link](https://example.com/x).",
  "",
  "- one",
  "- two",
  "",
  "<script>window.pwned = 1</script>",
  '<img src="x" onerror="window.pwned = 2">',
  "",
  "![plot](figures/plot.png)",
  "",
  "[next](notes/next.md)",
].join("\n");

const render = (code: boolean) => renderToStaticMarkup(h(TextPreview, { kind: "markdown", text: DOC, lang: "", code }));

describe("markdown artifact preview", () => {
  it("detects markdown by media type or extension", () => {
    expect(previewKind("text/markdown", "report")).toBe("markdown");
    expect(previewKind("text/plain", "reports/x.md")).toBe("markdown");
    expect(previewKind("text/x-markdown; charset=utf-8", "x")).toBe("markdown");
  });

  it("renders the document as formatted Markdown", () => {
    const html = render(false);
    expect(html).toContain("markdown-document");
    expect(html).toMatch(/<h1[^>]*>.*Regression report.*<\/h1>/);
    expect(html).toMatch(/data-streamdown="strong">bold</);
    expect(html).toMatch(/<li[^>]*>one<\/li>/);
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/x"[^>]*target="_blank"/);
  });

  it("never renders raw HTML or scripts", () => {
    const html = render(false);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/<img[^>]*src="x"/);
  });

  it("shows relative images as a placeholder and relative links as inert text", () => {
    const html = render(false);
    expect(html).not.toMatch(/<img[^>]*figures\/plot\.png/);
    expect(html).toMatch(/<span title="figures\/plot\.png"[^>]*>.*plot<\/span>/);
    expect(html).not.toMatch(/<a [^>]*notes\/next\.md/);
    expect(html).toContain("next");
  });

  it("源代码 shows the Markdown text, not the rendered document", () => {
    const html = render(true);
    expect(html).not.toContain("markdown-document");
    expect(html).not.toMatch(/<h1/);
    expect(html).toContain("# Regression report");
  });
});
