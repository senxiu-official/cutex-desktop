// Channel A of agent pages (main/pageStorage.ts, docs/design/004-artifact-page-bridge.md): each artifact's
// own storage, shared by its versions; 5 MiB per page, 200 MB soft total; a full store refuses, never evicts.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPageStorage, PAGE_STORAGE_PAGE_LIMIT, PAGE_STORAGE_TOTAL_LIMIT } from "../src/main/pageStorage";

const A = { hostId: "local", artifactId: "af-0123456789abcdef0123456789abcdef" };
const B = { hostId: "local", artifactId: "af-fedcba9876543210fedcba9876543210" };
const A_OTHER_HOST = { hostId: "host02", artifactId: A.artifactId };
const root = () => mkdtempSync(join(tmpdir(), "page-storage-"));

describe("page storage", () => {
  it("keeps the limits as main constants: 5 MiB per page, 200 MB total", () => {
    expect(PAGE_STORAGE_PAGE_LIMIT).toBe(5 * 1024 * 1024);
    expect(PAGE_STORAGE_TOTAL_LIMIT).toBe(200 * 1024 * 1024);
  });
  it("gives each artifact (per host) its own space; one page cannot read another's", async () => {
    const s = createPageStorage({ root: root() });
    expect(await s.set(A, "form", '{"x":1}', "decide.html")).toEqual({ ok: true });
    expect(await s.get(A, "form")).toBe('{"x":1}');
    expect(await s.get(B, "form")).toBeNull();
    expect(await s.get(A_OTHER_HOST, "form")).toBeNull();
    expect(await s.keys(B)).toEqual([]);
    await s.clear(B);
    expect(await s.get(A, "form")).toBe('{"x":1}');
  });
  it("persists across restarts (and so across versions: the key has no version)", async () => {
    const dir = root();
    const first = createPageStorage({ root: dir });
    await first.set(A, "k", "v", "decide.html");
    await first.flush(); // quit flushes (main/index.ts will-quit)
    const again = createPageStorage({ root: dir });
    expect(await again.get(A, "k")).toBe("v");
    expect((await again.usage()).items).toEqual([expect.objectContaining({ ...A, name: "decide.html", bytes: 2 })]);
  });
  it("refuses a write over 5 MiB with quota_exceeded and keeps the earlier data", async () => {
    const s = createPageStorage({ root: root() });
    const half = "x".repeat(PAGE_STORAGE_PAGE_LIMIT / 2);
    expect(await s.set(A, "a", half)).toEqual({ ok: true });
    expect(await s.set(A, "b", half)).toEqual({ ok: false, error: "quota_exceeded", scope: "page", limit: PAGE_STORAGE_PAGE_LIMIT });
    expect(await s.get(A, "a")).toBe(half);
    expect(await s.get(A, "b")).toBeNull();
    // Replacing a value counts the new size only; multi-byte text counts in UTF-8 bytes.
    expect(await s.set(A, "a", "é".repeat(PAGE_STORAGE_PAGE_LIMIT / 2))).toEqual(expect.objectContaining({ ok: false, scope: "page" }));
    expect(await s.set(A, "a", "short")).toEqual({ ok: true });
  });
  it("refuses growth over the total without evicting any page; shrinking still works; Settings is told", async () => {
    const s = createPageStorage({ root: root(), totalLimit: 100 });
    expect(await s.set(A, "k", "x".repeat(60))).toEqual({ ok: true });
    expect(await s.set(B, "k", "x".repeat(60))).toEqual({ ok: false, error: "quota_exceeded", scope: "total", limit: 100 });
    expect(await s.get(A, "k")).toBe("x".repeat(60)); // nothing deleted
    expect((await s.usage()).totalRefused).toBe(true);
    expect(await s.set(A, "k", "x")).toEqual({ ok: true }); // shrinking is allowed
    expect((await s.usage()).totalRefused).toBe(false);
    expect(await s.set(B, "k", "x".repeat(60))).toEqual({ ok: true });
  });
  it("lets the owner clear one page (the file is gone) and lists usage largest first", async () => {
    const dir = root();
    const s = createPageStorage({ root: dir });
    await s.set(A, "k", "x".repeat(10));
    await s.set(B, "k", "x".repeat(100));
    await s.flush();
    expect((await s.usage()).items.map((i) => i.artifactId)).toEqual([B.artifactId, A.artifactId]);
    await s.clear(B);
    expect(await s.get(B, "k")).toBeNull();
    expect(readdirSync(dir)).toHaveLength(1);
    expect((await s.usage()).totalBytes).toBe(11);
  });
  it("coalesces a burst of sets into one write; reads see every change at once (storage audit 2026-10-23)", async () => {
    const dir = root();
    const s = createPageStorage({ root: dir, flushMs: 60_000, cacheSize: 1 });
    for (let i = 0; i < 50; i++) expect(await s.set(A, "k", `v${i}`)).toEqual({ ok: true });
    await s.set(B, "k", "other"); // the 1-entry LRU drops A: a pending page still reads from memory
    expect(await s.get(A, "k")).toBe("v49");
    expect(readdirSync(dir)).toEqual([]);
    expect(s.pending()).toBe(true);
    await s.flush();
    expect(s.pending()).toBe(false);
    expect(readdirSync(dir)).toHaveLength(2);
    expect(await createPageStorage({ root: dir }).get(A, "k")).toBe("v49");
  });
  it("writes on its own after flushMs; a cleared page is never written back", async () => {
    const dir = root();
    const s = createPageStorage({ root: dir, flushMs: 20 });
    await s.set(A, "k", "v");
    await s.set(B, "k", "v");
    await s.clear(B);
    await new Promise((r) => setTimeout(r, 80));
    expect(s.pending()).toBe(false);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(await createPageStorage({ root: dir }).get(B, "k")).toBeNull();
  });
  it("rejects a malformed page key (no path tricks through the artifact id)", async () => {
    const s = createPageStorage({ root: root() });
    expect(() => s.get({ hostId: "local", artifactId: "../../accounts" }, "k")).toThrow("Invalid page");
    expect(() => s.get({ hostId: "", artifactId: A.artifactId }, "k")).toThrow("Invalid page");
  });
});
