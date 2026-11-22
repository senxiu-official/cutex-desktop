// A file page's own files (owner 2026-11-20 「这个改了」: a review page with 79 screenshots next to it showed none):
// main reads the images / style sheets / scripts / fonts it names inside its folder — as the host resolves it — from
// the same host and writes them into the document; web addresses, absolute paths, ../ out of the folder, a link that
// resolves outside and anything over the limits stay out (counted). main/filePageAssets.ts and main/frames.ts
// prepareFile. Cross-review 2026-11-20: a workspace route's answer is a label (not trusted), repeated references are
// budgeted as written, defer / async / module and media keep their meaning.
import { describe, expect, it, vi } from "vitest";
import { createFrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import type { FsDir, FsFile, WorkspaceScope } from "../src/shared/ipc";
import { FILE_PAGE_ASSET_MAX_BYTES, FILE_PAGE_ASSETS_MAX, FILE_PAGE_INLINE_MAX_BYTES } from "../src/shared/frames";
import { inlineLocalAssets, insideDir, resolveAssetPath } from "../src/main/filePageAssets";
import { createArtifactPageService, type FileWindow } from "../src/main/frames";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const b64 = PNG.toString("base64");

/** A host with files at resolved paths; `links` maps a path as asked to where it really resolves. */
function host(files: Record<string, { content: string | Buffer; mime?: string }>, links: Record<string, string> = {}) {
  const read = vi.fn(async (path: string, maxBytes: number): Promise<FsFile> => {
    const real = Object.entries(links).reduce((p, [from, to]) => (p.startsWith(from) ? to + p.slice(from.length) : p), path.replace(/\\/g, "/"));
    const f = files[real];
    if (!f) throw new Error("not found");
    const bytes = typeof f.content === "string" ? Buffer.from(f.content) : f.content;
    const binary = typeof f.content !== "string";
    return { path: real, size: bytes.byteLength, modifiedAt: "2026-11-20T00:00:00Z", encoding: binary ? "base64" : "utf8", content: binary ? bytes.subarray(0, maxBytes).toString("base64") : String(f.content), truncated: bytes.byteLength > maxBytes, mime: f.mime ?? "" };
  });
  return read;
}

describe("resolveAssetPath", () => {
  it("relative paths inside the page's folder, in its own separator; query / fragment dropped; %xx decoded", () => {
    expect(resolveAssetPath("D:/site/review/", "ui/web/a.png")).toBe("D:/site/review/ui/web/a.png");
    expect(resolveAssetPath("D:/site/review/", "./ui/a%20b.png?v=2#x")).toBe("D:/site/review/ui/a b.png");
    expect(resolveAssetPath("D:\\site\\review\\", "ui/web/a.png")).toBe("D:\\site\\review\\ui\\web\\a.png");
    expect(resolveAssetPath("D:/site/review/", "ui/../b.png")).toBe("D:/site/review/b.png");
  });

  it("never a web address, a scheme, an absolute or protocol-relative path, or ../ out of the folder", () => {
    for (const ref of ["https://x.test/a.png", "//cdn.test/a.js", "/etc/passwd", "\\\\server\\share\\a.png", "C:/Windows/a.png", "file:///D:/a.png", "data:image/png;base64,AA", "../secret.png", "ui/../../secret.png", "%2e%2e/secret.png", ""])
      expect(resolveAssetPath("D:/site/review/", ref)).toBeNull();
    // A style sheet one folder down may climb back to the page's folder, not past it.
    expect(resolveAssetPath("D:/site/review/css/", "../img/a.png", 1)).toBe("D:/site/review/img/a.png");
    expect(resolveAssetPath("D:/site/review/css/", "../../a.png", 1)).toBeNull();
  });

  it("insideDir: the host's resolved path must stay in the page's (absolute) folder (Windows case-insensitively)", () => {
    expect(insideDir("D:\\Site\\review\\", "d:/site/review/ui/a.png")).toBe(true);
    expect(insideDir("D:/site/review/", "D:/site/outside/a.png")).toBe(false);
    expect(insideDir("D:/site/review/", "D:/site/review-other/a.png")).toBe(false);
    expect(insideDir("/home/u/site/", "/home/u/site/a.png")).toBe(true);
    expect(insideDir("/home/u/site/", "/home/u/SITE/a.png")).toBe(false);
    // A relative answer (a workspace route's label) is never inside anything.
    expect(insideDir("D:/site/", "img/a.png")).toBe(false);
    expect(insideDir("", "img/a.png")).toBe(false);
  });
});

describe("inlineLocalAssets", () => {
  it("images (src, srcset, poster), style sheets with their url()s, scripts, style url()s: written in, each file read once", async () => {
    const read = host({
      "D:/site/r/ui/a.png": { content: PNG, mime: "image/png" },
      "D:/site/r/ui/b.png": { content: PNG },
      "D:/site/r/css/s.css": { content: "body{background:url(../ui/a.png)} .x{background:url('bg.png')}", mime: "text/css" },
      "D:/site/r/css/bg.png": { content: PNG, mime: "image/png" },
      "D:/site/r/app.js": { content: "document.title='ok'</script>x", mime: "text/javascript" },
    });
    const html = `<link rel="stylesheet" href="css/s.css"><img src="ui/a.png"><img src='ui/a.png' srcset="ui/a.png 1x, ui/b.png 2x"><video poster=ui/b.png></video><div style="background:url(ui/b.png)"></div><script src="app.js"></script><img src="https://x.test/r.png"><a href="ui/a.png">link</a>`;
    const r = await inlineLocalAssets(html, "D:/site/r/", read);
    expect(r.loaded).toBe(5);
    expect(read).toHaveBeenCalledTimes(5);
    expect(r.html).not.toContain('src="ui/');
    expect(r.html).toContain(`<img src="data:image/png;base64,${b64}">`);
    expect(r.html).toContain(`srcset="data:image/png;base64,${b64} 1x, data:image/png;base64,${b64} 2x"`);
    expect(r.html).toContain(`poster="data:image/png;base64,${b64}"`);
    expect(r.html).toContain(`<div style="background:url(data:image/png;base64,${b64})">`);
    // The sheet inline, its url()s relative to its own folder.
    expect(r.html).toMatch(/<style data-inlined="css\/s.css">body\{background:url\(data:image\/png;base64,[^)]+\)\} \.x\{background:url\(data:image\/png;base64,[^)]+\)\}<\/style>/);
    // The script inline (a closing tag in it cannot end the element early).
    expect(r.html).toContain("<script>document.title='ok'<\\/script>x</script>");
    // A web address and a plain link stay as written.
    expect(r.html).toContain('<img src="https://x.test/r.png">');
    expect(r.html).toContain('<a href="ui/a.png">');
  });

  it("refuses a file a link / junction resolves outside the page's folder, a truncated (too big) file and a missing one", async () => {
    const read = host({ "D:/site/outside/secret.png": { content: PNG, mime: "image/png" }, "D:/site/r/big.png": { content: Buffer.alloc(FILE_PAGE_ASSET_MAX_BYTES + 1) } }, { "D:/site/r/link/": "D:/site/outside/" });
    const html = `<img src="link/secret.png"><img src="big.png"><img src="gone.png">`;
    const r = await inlineLocalAssets(html, "D:/site/r/", read);
    expect(r.loaded).toBe(0);
    expect(r.html).toBe(html);
  });

  it("at most FILE_PAGE_ASSETS_MAX files, read a few at a time", async () => {
    let running = 0, most = 0;
    const read = vi.fn(async (path: string): Promise<FsFile> => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return { path, size: PNG.byteLength, modifiedAt: "", encoding: "base64", content: b64, truncated: false, mime: "image/png" };
    });
    const html = Array.from({ length: FILE_PAGE_ASSETS_MAX + 5 }, (_, i) => `<img src="i/${i}.png">`).join("");
    const r = await inlineLocalAssets(html, "/s/", read);
    expect(r.loaded).toBe(FILE_PAGE_ASSETS_MAX);
    expect(read).toHaveBeenCalledTimes(FILE_PAGE_ASSETS_MAX);
    expect(most).toBeLessThanOrEqual(4);
  });

  it("one picture named many times: read once, written while FILE_PAGE_INLINE_MAX_BYTES lasts, the rest left as written", async () => {
    const big = Buffer.alloc(4 * 1024 * 1024, 7);
    const read = host({ "/s/big.png": { content: big, mime: "image/png" }, "/s/s.css": { content: ".a{background:url(big.png)}", mime: "text/css" } });
    const times = 40;
    const html = `<link rel="stylesheet" href="s.css">` + `<img src="big.png">`.repeat(times);
    const r = await inlineLocalAssets(html, "/s/", read);
    expect(read).toHaveBeenCalledTimes(2);
    const urlBytes = `data:image/png;base64,${big.toString("base64")}`.length;
    const fit = Math.floor(FILE_PAGE_INLINE_MAX_BYTES / urlBytes);
    expect(fit).toBeLessThan(times);
    // The sheet (with one copy) first, then the pictures in document order until the budget ends.
    const written = r.html.split("data:image/png;base64,").length - 1;
    expect(written).toBe(fit);
    expect(r.html.split('<img src="big.png">').length - 1).toBe(times - (fit - 1));
    expect(r.html.length).toBeLessThanOrEqual(html.length + FILE_PAGE_INLINE_MAX_BYTES);
    expect(r.loaded).toBe(2);
  });

  it("scripts keep when they run: classic defer / async after the document (in order), module in place, others in place", async () => {
    const read = host({ "/s/a.js": { content: "A()" }, "/s/b.js": { content: "B()" }, "/s/c.js": { content: "C()" }, "/s/m.js": { content: "M()" }, "/s/t.txt": { content: "T" } });
    const html = `<head><script defer src="a.js"></script><script src="b.js"></script><script type="module" src="m.js"></script><script async src="c.js" integrity="sha384-x"></script><script type="text/template" src="t.txt"></script></head><body><div id="x"></div></body>`;
    const r = await inlineLocalAssets(html, "/s/", read);
    expect(r.html).toBe(`<head><script>B()</script><script type="module">M()</script><script type="text/template" src="t.txt"></script></head><body><div id="x"></div></body><script>A()</script><script>C()</script>`);
    expect(r.loaded).toBe(4);
  });

  it("style sheets keep their media; alternate and disabled sheets are not applied", async () => {
    const read = host({ "/s/p.css": { content: "body{color:red}" }, "/s/alt.css": { content: "body{color:blue}" } });
    const html = `<link rel="stylesheet" media="print" href="p.css"><link rel="alternate stylesheet" href="alt.css"><link rel="stylesheet" disabled href="alt.css">`;
    const r = await inlineLocalAssets(html, "/s/", read);
    expect(r.html).toContain(`<style data-inlined="p.css" media="print">body{color:red}</style>`);
    expect(r.html).not.toContain("color:blue}</style>");
  });
});

describe("prepareFile with the page's own files", () => {
  /**
   * A host: `host` = fs-file-read (absolute path → resolved path, links followed); `ws` = the workspace route
   * (answers with the path as asked, as cutex does); `root` = the workspace listing's resolved root.
   */
  function service(opts: { host: Record<string, FileWindow>; links?: Record<string, string>; ws?: Record<string, FileWindow>; root?: string; noFsDir?: boolean }) {
    const documents = createFrameDocumentStore({ scheme: "cutex-plugin" });
    const fileWindow = vi.fn(async (scope: WorkspaceScope | undefined, path: string) => {
      if (scope) {
        const f = opts.ws?.[path];
        if (!f) throw new Error("missing");
        return { ...f, path };
      }
      const asked = path.replace(/\\/g, "/");
      const real = Object.entries(opts.links ?? {}).reduce((p, [from, to]) => (p.startsWith(from) ? to + p.slice(from.length) : p), asked);
      const f = opts.host[real];
      if (!f) throw new Error("missing");
      return { ...f, path: real.replace(/\//g, "\\") };
    });
    const fsDir = vi.fn(async (): Promise<FsDir> => ({ root: opts.root ?? "D:\\ws", path: "", entries: [] }));
    const reader = opts.noFsDir ? { fileWindow } : { fileWindow, fsDir };
    const s = createArtifactPageService({ documents, contentReader: () => null, ensureContained: async () => {}, fileReader: () => reader });
    return { documents, fileWindow, fsDir, s };
  }
  const page = (content: string, path = "D:\\site\\review\\ui-audit.html"): FileWindow => ({ path, size: content.length, modifiedAt: "", encoding: "utf8", content, truncated: false, mime: "text/html", offset: 0, revision: "1" });
  const png = (path = ""): FileWindow => ({ path, size: PNG.byteLength, modifiedAt: "", encoding: "base64", content: b64, truncated: false, mime: "image/png", offset: 0, revision: "1" });
  const scope = { kind: "project", id: "proj_1" } as const;

  it("the owner's case: screenshots next to the page load (fs-file-read), a web address is still counted", async () => {
    const html = `<h1>审计</h1><img src="ui-audit/web/W-01.png"><img src="ui-audit/web/W-01.png"><img src="ui-audit/bot/B-01.png"><img src="https://cdn.test/x.png">`;
    const { s, documents, fileWindow } = service({ host: { "D:/site/review/ui-audit.html": page(html), "D:/site/review/ui-audit/web/W-01.png": png(), "D:/site/review/ui-audit/bot/B-01.png": png() } });
    const r = await s.prepareFile(3, { hostId: "eva", path: "D:/site/review/ui-audit.html" });
    expect(r).toMatchObject({ ok: true, localFiles: 2, externalRefs: 1 });
    if (!r.ok) return;
    expect(fileWindow).toHaveBeenCalledWith(undefined, "D:\\site\\review\\ui-audit\\web\\W-01.png", 0, FILE_PAGE_ASSET_MAX_BYTES);
    const out = await documents.respond(new Request(r.frame.url)).text();
    expect(out.match(/data:image\/png;base64,/g)).toHaveLength(3);
    expect(out).toContain('src="https://cdn.test/x.png"');
  });

  it("a workspace page: found again under the listing's resolved root through fs-file-read; its files read there", async () => {
    const { s, fileWindow } = service({ ws: { "docs/p.html": page(`<img src="img/a.png">`) }, host: { "D:/ws/docs/p.html": page(""), "D:/ws/docs/img/a.png": png() } });
    const r = await s.prepareFile(3, { hostId: "h", path: "docs/p.html", scope });
    expect(r).toMatchObject({ ok: true, localFiles: 1, externalRefs: 0 });
    expect(fileWindow).toHaveBeenCalledWith(undefined, "D:\\ws\\docs\\p.html", 0, 1);
    expect(fileWindow).toHaveBeenLastCalledWith(undefined, "D:\\ws\\docs\\img\\a.png", 0, FILE_PAGE_ASSET_MAX_BYTES);
    // Never through the workspace route (its answer is the path as asked, not where a link leads).
    expect(fileWindow.mock.calls.filter(([sc]) => sc)).toHaveLength(1);
  });

  it("a workspace junction to a sibling folder (inside the workspace, outside the page's folder) is refused", async () => {
    // The review's case: docs/p.html names docs/link/secret.png; docs/link → D:\ws\private.
    const { s } = service({
      ws: { "docs/p.html": page(`<img src="link/secret.png">`) },
      host: { "D:/ws/docs/p.html": page(""), "D:/ws/private/secret.png": png() },
      links: { "D:/ws/docs/link/": "D:/ws/private/" },
    });
    expect(await s.prepareFile(3, { hostId: "h", path: "docs/p.html", scope })).toMatchObject({ ok: true, localFiles: 0, externalRefs: 1 });
  });

  it("a workspace page that is itself a link out of the workspace: nothing inlined", async () => {
    const { s, fileWindow } = service({
      ws: { "docs/p.html": page(`<img src="a.png">`) },
      host: { "D:/elsewhere/p.html": page(""), "D:/elsewhere/a.png": png() },
      links: { "D:/ws/docs/p.html": "D:/elsewhere/p.html" },
    });
    expect(await s.prepareFile(3, { hostId: "h", path: "docs/p.html", scope })).toMatchObject({ ok: true, localFiles: 0, externalRefs: 1 });
    expect(fileWindow.mock.calls.some(([, p]) => /a\.png/.test(p))).toBe(false);
  });

  it("an older host (no listing root, or no fs-file-read): a workspace page shows without its files", async () => {
    const noDir = service({ ws: { "docs/p.html": page(`<img src="img/a.png">`) }, host: { "D:/ws/docs/img/a.png": png() }, noFsDir: true });
    expect(await noDir.s.prepareFile(3, { hostId: "h", path: "docs/p.html", scope })).toMatchObject({ ok: true, localFiles: 0, externalRefs: 1 });
    expect(noDir.fileWindow).toHaveBeenCalledTimes(1);
    const noHostRoute = service({ ws: { "docs/p.html": page(`<img src="img/a.png">`) }, host: {} });
    expect(await noHostRoute.s.prepareFile(3, { hostId: "h", path: "docs/p.html", scope })).toMatchObject({ ok: true, localFiles: 0, externalRefs: 1 });
    // A root that is not an absolute path is not trusted either.
    const relRoot = service({ ws: { "docs/p.html": page(`<img src="img/a.png">`) }, host: { "D:/ws/docs/p.html": page(""), "D:/ws/docs/img/a.png": png() }, root: "ws" });
    expect(await relRoot.s.prepareFile(3, { hostId: "h", path: "docs/p.html", scope })).toMatchObject({ ok: true, localFiles: 0 });
  });

  it("nothing referenced: no extra read, localFiles 0", async () => {
    const { s, fileWindow, fsDir } = service({ host: { "D:/a.html": page("<p>x</p>", "D:\\a.html") } });
    expect(await s.prepareFile(3, { hostId: "h", path: "D:/a.html" })).toMatchObject({ ok: true, localFiles: 0, externalRefs: 0 });
    expect(fileWindow).toHaveBeenCalledTimes(1);
    expect(fsDir).not.toHaveBeenCalled();
  });
});
