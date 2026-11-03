import { describe, expect, it } from "vitest";
import { downloadFilename, downloadFilters } from "../src/shared/downloadFilename";

describe("download payload filenames", () => {
  it.each([
    ["fresh-run-figures-r5.3", "/scp/results/figures.zip", "application/zip", "fresh-run-figures-r5.3.zip"],
    ["v1.2", "/scp/notes.md", "text/plain", "v1.2.md"],
    ["figure", "D:\\results\\image.PNG", "image/png", "figure.PNG"],
    ["bundle.ZIP", "/tmp/bundle.zip", "application/zip", "bundle.ZIP"],
    ["bundle", "/tmp/package.tar.gz", "application/gzip", "bundle.tar.gz"],
    ["report-r5.3", "", "application/pdf", "report-r5.3.pdf"],
    ["report-r5.3", "/scp/report-r5.3", "application/pdf", "report-r5.3.pdf"],
    ["blob", "", "application/octet-stream", "blob"],
  ])("uses real payload type for %s", (name, sourcePath, mime, expected) => {
    expect(downloadFilename(name, { sourcePath, mime })).toBe(expected);
  });
  it("keeps the complete suffix when a cross-platform filename is sanitized/truncated", () => {
    const name = downloadFilename(`${"a".repeat(190)}.tar.gz`, { maxLength: 160 });
    expect(name).toHaveLength(160);
    expect(name).toMatch(/\.tar\.gz$/);
    expect(downloadFilename("con.zip")).toBe("_con.zip");
    expect(downloadFilename("../bad:name", { extension: "zip" })).not.toMatch(/[/:\\]/);
  });
  it("gives macOS an explicit suffixed default and a valid extension filter", () => {
    const name = downloadFilename("fresh-run-figures-r5.3", { mime: "application/zip" });
    expect({ defaultPath: name, filters: downloadFilters(name, "Archive") }).toEqual({
      defaultPath: "fresh-run-figures-r5.3.zip", filters: [{ name: "Archive", extensions: ["zip"] }],
    });
    expect(downloadFilename("NOTES.MD", { extension: "md" })).toBe("NOTES.MD");
    expect(downloadFilters("bundle.tar.gz")).toEqual([{ name: "File", extensions: ["gz"] }]);
    expect(downloadFilters("unknown")).toBeUndefined();
  });
});
