// File links in messages: icon kinds, image detection, thumbnail src and the thumbnail cache.
import { describe, expect, it, vi } from "vitest";
import { escapeFileHref, unescapeFileHref } from "../src/renderer/src/lib/workspace";
import { canonicalMime, extensionOf, fileKind, imageMimeFor, isGenericMime, isThumbnailPath, sniffImageMime, THUMBNAIL_MAX_BYTES, thumbnailSrc } from "../src/renderer/src/lib/fileKinds";
import { loadThumbnail } from "../src/renderer/src/lib/fileThumbnails";
import type { FsFile } from "../src/shared/ipc";

const file = (over: Partial<FsFile>): FsFile => ({ path: "x.png", size: 10, modifiedAt: "2026-10-08T00:00:00Z", encoding: "base64", content: "iVBORw0KGgo=", truncated: false, mime: "image/png", ...over });

describe("fileKind", () => {
  it("maps extensions to icon kinds", () => {
    expect(fileKind("docs/acceptance/report.md")).toBe("markdown");
    expect(fileKind("C:\\logs\\run.LOG")).toBe("text");
    expect(fileKind("src/queue.rs")).toBe("code");
    expect(fileKind("/tmp/shot.PNG")).toBe("image");
    expect(fileKind("spec.pdf")).toBe("pdf");
    expect(fileKind("package.json")).toBe("data");
    expect(fileKind("config.yaml")).toBe("data");
    expect(fileKind("dist.tar.gz")).toBe("archive");
    expect(fileKind("docs/")).toBe("folder");
    expect(fileKind("C:\\Users\\x\\")).toBe("folder");
    expect(fileKind("Dockerfile")).toBe("code");
    expect(fileKind(".env")).toBe("data");
    expect(fileKind("LICENSE")).toBe("file");
    expect(fileKind("weird.xyz")).toBe("file");
  });

  it("takes the extension of the last segment only", () => {
    expect(extensionOf("a.b/c")).toBe("");
    expect(extensionOf("~/notes/acl.md")).toBe("md");
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("isThumbnailPath", () => {
  it("accepts the rendered image formats", () => {
    for (const p of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.svg", "D:/x/y.png", "~/s.webp"]) expect(isThumbnailPath(p)).toBe(true);
  });
  it("rejects other files, icons-only formats and folders", () => {
    for (const p of ["a.md", "b.ico", "c.avif", "png", "dir.png/", "x.pdf"]) expect(isThumbnailPath(p)).toBe(false);
  });
});

describe("thumbnailSrc", () => {
  it("builds a data: URL for base64 images", () => {
    expect(thumbnailSrc(file({}))).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
  it("encodes SVG text as a data: URL (never inline DOM)", () => {
    const src = thumbnailSrc(file({ encoding: "utf8", mime: "image/svg+xml", content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }));
    expect(src?.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg")).toBe(true);
    expect(src).not.toContain("<");
  });
  it("refuses truncated, oversized, non-image and malformed bodies", () => {
    expect(thumbnailSrc(file({ truncated: true }))).toBeNull();
    expect(thumbnailSrc(file({ size: THUMBNAIL_MAX_BYTES + 1 }))).toBeNull();
    expect(thumbnailSrc(file({ mime: "application/octet-stream", content: "AAAAAAAAAAA=" }))).toBeNull();
    expect(thumbnailSrc(file({ mime: "image/x-icon" }))).toBeNull();
    expect(thumbnailSrc(file({ content: "not base64!" }))).toBeNull();
    expect(thumbnailSrc(file({ content: "" }))).toBeNull();
    expect(thumbnailSrc(file({ encoding: "utf8", mime: "text/plain", content: "hi" }))).toBeNull();
    expect(thumbnailSrc(file({ encoding: "utf8", mime: "image/svg+xml", content: "not an svg" }))).toBeNull();
    // A text body labelled as png is not trusted as an image.
    expect(thumbnailSrc(file({ encoding: "utf8", content: "<svg></svg>" }))).toBeNull();
  });
});

describe("thumbnailSrc: aliases and generic types (artifacts stored by older cutex)", () => {
  const JPEG = "/9j/4AAQSkZJRgABAQ==";
  it("accepts common aliases under their standard type", () => {
    expect(thumbnailSrc(file({ mime: "image/jpg", content: JPEG }))).toBe(`data:image/jpeg;base64,${JPEG}`);
    expect(thumbnailSrc(file({ mime: "IMAGE/PJPEG; q=1", content: JPEG }))).toBe(`data:image/jpeg;base64,${JPEG}`);
    expect(thumbnailSrc(file({ mime: "image/x-png" }))).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(canonicalMime("image/x-ms-bmp")).toBe("image/bmp");
  });
  it("a generic type takes the name's extension (Windows or POSIX path), else the bytes' signature", () => {
    expect(thumbnailSrc(file({ mime: "application/octet-stream", content: JPEG }), "C:\\w\\photo.JPG")).toBe(`data:image/jpeg;base64,${JPEG}`);
    expect(thumbnailSrc(file({ mime: "application/octet-stream", content: JPEG }), "Holiday photo")).toBe(`data:image/jpeg;base64,${JPEG}`);
    expect(thumbnailSrc(file({ mime: "text/plain" }), "/w/fig")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(thumbnailSrc(file({ mime: "", content: "R0lGODlhAQABAA==" }))).toBe("data:image/gif;base64,R0lGODlhAQABAA==");
    expect(thumbnailSrc(file({ encoding: "utf8", mime: "text/plain", content: '<svg xmlns="http://www.w3.org/2000/svg"/>' }), "logo.svg")?.startsWith("data:image/svg+xml;")).toBe(true);
    // A specific non-image type is never overridden by the bytes.
    expect(thumbnailSrc(file({ mime: "application/pdf" }))).toBeNull();
    expect(imageMimeFor("application/octet-stream", "D:\\out\\x.jpeg")).toBe("image/jpeg");
    expect(imageMimeFor("application/pdf", "x.png")).toBe("application/pdf");
    expect(sniffImageMime("UklGRhAAAABXRUJQVlA4IA==")).toBe("image/webp");
    expect(sniffImageMime("JVBERi0xLjQ=")).toBeNull();
    expect(isGenericMime("Application/Octet-Stream")).toBe(true);
    expect(isGenericMime("image/jpeg")).toBe(false);
  });
});

describe("image src escaping", () => {
  it("carries drive-letter and file:// image paths through sanitize", () => {
    const escaped = escapeFileHref("C:/Users/x/shot.png");
    expect(escaped).not.toBeNull();
    expect(unescapeFileHref(escaped!)).toBe("C:/Users/x/shot.png");
    expect(escapeFileHref("https://example.com/a.png")).toBeNull();
  });
});

describe("loadThumbnail", () => {
  it("reads once per key and reuses the result", async () => {
    const read = vi.fn(async () => file({}));
    const key = `test|a|${Math.random()}`;
    const [a, b] = await Promise.all([loadThumbnail(key, read), loadThumbnail(key, read)]);
    expect(a).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(b).toBe(a);
    expect(await loadThumbnail(key, read)).toBe(a);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("turns read errors and unrenderable bodies into null", async () => {
    expect(await loadThumbnail(`test|b|${Math.random()}`, async () => Promise.reject(new Error("path_not_found")))).toBeNull();
    expect(await loadThumbnail(`test|c|${Math.random()}`, async () => file({ truncated: true }))).toBeNull();
  });
});
