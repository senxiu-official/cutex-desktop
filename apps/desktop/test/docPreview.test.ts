// Document previews (lib/docPreview.ts, lib/docxHtml.ts): which renderer a file gets, the state chosen
// for the daemon's bytes (cap, truncation, magic), windowed artifact reads, the PDF toolbar helpers,
// and the DOCX HTML sanitiser (with the generated sample docx of the workspace preview mock).
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { FsFile } from "../src/shared/ipc";
import {
  clampZoom,
  decodeBase64,
  DOC_PREVIEW_MAX_BYTES,
  docKindOf,
  docState,
  docStateBySize,
  docTypeLabel,
  hasMagic,
  loadFsDoc,
  loadWindowedDoc,
  officeReason,
  pageAt,
  parsePage,
  stepZoom,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../src/renderer/src/lib/docPreview";
import { docxToSafeHtml, sanitizeDocxHtml } from "../src/renderer/src/lib/docxHtml";
import { mock as workspaceMock } from "../src/renderer/src/modules/workspace/mock";

const win = new JSDOM("<!doctype html><html><body></body></html>").window as unknown as Parameters<typeof sanitizeDocxHtml>[1];
const b64 = (bytes: number[] | string) => Buffer.from(typeof bytes === "string" ? bytes : Uint8Array.from(bytes)).toString("base64");
const PDF_HEAD = b64("%PDF-1.4\n%\u00e2\u00e3\n1 0 obj\n");
const ZIP_HEAD = b64([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const body = (content: string, size: number, extra: Partial<FsFile> = {}) => ({ encoding: "base64" as const, content, size, truncated: false, ...extra });

describe("docKindOf / labels", () => {
  it("routes PDF and the DOCX family to renderers, other office formats to the card", () => {
    expect(docKindOf("a/b/report.PDF")).toBe("pdf");
    expect(docKindOf("C:\\x\\notes.docx")).toBe("docx");
    expect(docKindOf("macro.docm")).toBe("docx");
    expect(docKindOf("template.dotx")).toBe("docx");
    for (const p of ["old.doc", "sheet.xlsx", "sheet.xls", "deck.pptx", "deck.ppt", "doc.odt", "calc.ods", "text.rtf", "book.epub", "x.pages"]) expect(docKindOf(p), p).toBe("office");
    for (const p of ["main.ts", "README.md", "image.png", "data.csv", "folder.pdf/", "noext"]) expect(docKindOf(p), p).toBeNull();
  });

  it("falls back to the media type when the name has no known extension", () => {
    expect(docKindOf("download", "application/pdf")).toBe("pdf");
    expect(docKindOf("blob", "application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=binary")).toBe("docx");
    expect(docKindOf("blob", "application/msword")).toBe("office");
    expect(docKindOf("blob", "text/plain")).toBeNull();
  });

  it("labels and office reasons", () => {
    expect(docTypeLabel("x/report.pdf")).toBe("PDF");
    expect(docTypeLabel("blob", "application/pdf")).toBe("application/pdf");
    expect(officeReason("old.doc")).toBe("legacy");
    expect(officeReason("deck.PPT")).toBe("legacy");
    expect(officeReason("sheet.xlsx")).toBe("unsupported");
  });
});

describe("docState", () => {
  it("ready for a complete file with the right magic", () => {
    const s = docState("pdf", "a.pdf", body(PDF_HEAD, 20));
    expect(s.state).toBe("ready");
    expect(s.state === "ready" && s.kind).toBe("pdf");
    expect(docState("docx", "a.docx", body(ZIP_HEAD, 8)).state).toBe("ready");
  });

  it("too-large over the cap or when the read was cut short", () => {
    expect(docState("pdf", "a.pdf", body(PDF_HEAD, DOC_PREVIEW_MAX_BYTES + 1))).toEqual({ state: "too-large", size: DOC_PREVIEW_MAX_BYTES + 1, max: DOC_PREVIEW_MAX_BYTES });
    expect(docState("pdf", "a.pdf", body(PDF_HEAD, 900, { truncated: true }), 1000).state).toBe("too-large");
    expect(docState("docx", "a.docx", body(ZIP_HEAD, 2000), 1000).state).toBe("too-large");
  });

  it("invalid for text, bad base64 or the wrong magic", () => {
    expect(docState("pdf", "a.pdf", { encoding: "utf8", content: "%PDF-1.4 but text", size: 17, truncated: false }).state).toBe("invalid");
    expect(docState("pdf", "a.pdf", body("not*base64!", 9)).state).toBe("invalid");
    expect(docState("pdf", "a.pdf", body(ZIP_HEAD, 8)).state).toBe("invalid");
    expect(docState("docx", "a.docx", body(PDF_HEAD, 20)).state).toBe("invalid");
    expect(docState("docx", "a.docx", body("", 0)).state).toBe("invalid");
  });

  it("office formats never need their bytes", () => {
    expect(docState("office", "a.xlsx", body("", 5000))).toEqual({ state: "office", reason: "unsupported", size: 5000 });
    expect(docStateBySize("office", "a.doc", 10)).toEqual({ state: "office", reason: "legacy", size: 10 });
    expect(docStateBySize("pdf", "a.pdf", 10)).toBeNull();
    expect(docStateBySize("pdf", "a.pdf", 11, 10)?.state).toBe("too-large");
  });

  it("magic: %PDF- may follow leading junk within the first KiB", () => {
    expect(hasMagic("pdf", new Uint8Array([...Buffer.from("\r\njunk%PDF-1.7")]))).toBe(true);
    expect(hasMagic("pdf", new Uint8Array([...new Array(1100).fill(32), ...Buffer.from("%PDF-")]))).toBe(false);
    expect(decodeBase64("QUJD")).toEqual(new Uint8Array([65, 66, 67]));
    expect(decodeBase64("QUJ")).not.toBeNull();
    expect(decodeBase64("Q")).toBeNull();
  });
});

describe("loading through the daemon", () => {
  it("fs/file: a 1-byte stat read, then the whole file — or nothing more when it is over the cap / an office file", async () => {
    const pdf = Buffer.from("%PDF-1.4\nhello\n");
    const read = vi.fn(async (maxBytes: number) => ({ encoding: "base64" as const, content: pdf.subarray(0, maxBytes).toString("base64"), size: pdf.length, truncated: maxBytes < pdf.length }));
    const s = await loadFsDoc("pdf", "a.pdf", read);
    expect(s.state).toBe("ready");
    expect(read.mock.calls.map((c) => c[0])).toEqual([1, DOC_PREVIEW_MAX_BYTES]);

    const big = vi.fn(async () => ({ encoding: "base64" as const, content: "JQ==", size: 50 * 1024 * 1024, truncated: true }));
    expect((await loadFsDoc("pdf", "big.pdf", big)).state).toBe("too-large");
    expect(big).toHaveBeenCalledTimes(1);

    const office = vi.fn(async () => ({ encoding: "base64" as const, content: "0A==", size: 4096, truncated: true }));
    expect(await loadFsDoc("office", "x.doc", office)).toEqual({ state: "office", reason: "legacy", size: 4096 });
    expect(office).toHaveBeenCalledTimes(1);
  });

  it("artifact windows are joined in order", async () => {
    const bytes = Buffer.from("%PDF-1.4\n" + "x".repeat(40));
    const read = vi.fn(async (offset: number, maxBytes: number) => {
      const part = bytes.subarray(offset, offset + maxBytes);
      return { encoding: "base64" as const, content: part.toString("base64"), truncated: offset + part.length < bytes.length, totalBytes: bytes.length };
    });
    const s = await loadWindowedDoc("pdf", "r.pdf", bytes.length, read, 1000, 16);
    expect(s.state).toBe("ready");
    expect(s.state === "ready" && Buffer.from(s.bytes).equals(bytes)).toBe(true);
    expect(read.mock.calls.map((c) => c[0])).toEqual([0, 16, 32, 48]);
  });

  it("artifact: over the cap by registered size (no read), text content, a missing version", async () => {
    const never = vi.fn();
    expect((await loadWindowedDoc("pdf", "r.pdf", 2000, never, 1000)).state).toBe("too-large");
    expect(never).not.toHaveBeenCalled();
    expect((await loadWindowedDoc("pdf", "r.pdf", 5, async () => ({ encoding: "utf8", content: "hello", truncated: false, totalBytes: 5 }))).state).toBe("invalid");
    await expect(loadWindowedDoc("docx", "r.docx", 5, async () => null)).rejects.toThrow();
  });
});

describe("PDF toolbar helpers", () => {
  it("zoom steps and clamps", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.03, 1)).toBe(1.1);
    expect(stepZoom(1.03, -1)).toBe(1);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("page input and the page at a scroll offset", () => {
    expect(parsePage("3", 10)).toBe(3);
    expect(parsePage(" 42 ", 10)).toBe(10);
    expect(parsePage("0", 10)).toBe(1);
    expect(parsePage("abc", 10)).toBeNull();
    expect(pageAt([0, 800, 1600], 0)).toBe(1);
    expect(pageAt([0, 800, 1600], 799)).toBe(1);
    expect(pageAt([0, 800, 1600], 800)).toBe(2);
    expect(pageAt([0, 800, 1600], 99999)).toBe(3);
  });
});

describe("DOCX HTML sanitiser", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  it("keeps the semantic vocabulary and raster data: images", () => {
    const out = sanitizeDocxHtml(`<h1>T</h1><p><strong>b</strong> <em>i</em></p><table><tr><td colspan="2"><p>c</p></td></tr></table><ul><li>x</li></ul><img alt="fig" src="${png}">`, win);
    expect(out).toContain("<h1>T</h1>");
    expect(out).toContain('<td colspan="2">');
    expect(out).toContain("<li>x</li>");
    expect(out).toContain(`src="${png}"`);
    expect(out).toContain('alt="fig"');
  });

  it("drops scripts, handlers, styles, frames, forms, ids and active URLs", () => {
    const out = sanitizeDocxHtml(
      [
        `<script>alert(1)</script><style>body{display:none}</style>`,
        `<p id="root" name="x" class="c" style="position:fixed" onclick="alert(2)">p</p>`,
        `<img src="x" onerror="alert(3)"><img src="https://evil.example/t.png"><img src="data:image/svg+xml;base64,PHN2Zz4=">`,
        `<img src="data:text/html;base64,PHNjcmlwdD4=">`,
        `<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="q"></form>`,
        `<a href="javascript:alert(4)">js</a><a href="https://example.com/x">ext</a><a href="#footnote-1">fn</a>`,
        `<svg><a xlink:href="javascript:alert(5)">s</a></svg><math><mi>m</mi></math><object data="x"></object><embed src="x"><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/s.css">`,
      ].join(""),
      win,
    );
    for (const bad of ["<script", "alert(", "<style", "onclick", "onerror", "style=", "class=", 'id="', "name=", "<iframe", "<form", "<input", "javascript:", "evil.example", "<svg", "<math", "<object", "<embed", "<base", "<meta", "<link", "href=", "image/svg", "text/html"]) {
      expect(out, bad).not.toContain(bad);
    }
    // Links keep their text; an external target becomes the tooltip.
    expect(out).toContain('title="https://example.com/x"');
    expect(out).toContain(">ext</a>");
    expect(out).toContain(">fn</a>");
    expect(out).toContain("<p>p</p>");
  });

  it("converts the preview mock's sample docx end to end", async () => {
    const file = workspaceMock.files!.read("samples/sample.docx", DOC_PREVIEW_MAX_BYTES)!;
    const state = docState("docx", file.path, file);
    expect(state.state).toBe("ready");
    if (state.state !== "ready") return;
    const { html } = await docxToSafeHtml(state.bytes, win);
    expect(html).toContain("<h1>Cutex sample document</h1>");
    expect(html).toContain("<h2>Results</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("中文段落");
    expect(html).toMatch(/<img [^>]*src="data:image\/png;base64,/);
    expect(html).toContain('title="https://example.com/"');
    expect(html).not.toContain("href=");
  });

  it("the preview mock's sample PDF passes the state check", async () => {
    const file = workspaceMock.files!.read("samples/sample.pdf")!;
    expect(docState("pdf", file.path, file).state).toBe("ready");
    expect(docState("pdf", "x", workspaceMock.files!.read("samples/renamed-text.pdf")!).state).toBe("invalid");
    await expect(loadFsDoc("pdf", "samples/scan-archive.pdf", async (n) => workspaceMock.files!.read("samples/scan-archive.pdf", n)!)).resolves.toMatchObject({ state: "too-large" });
  });
});
