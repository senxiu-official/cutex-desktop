// Storage audit 2026-10-23: the updater's small files are replaced atomically and update.log rotates.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rotateUpdateLog, UPDATE_LOG_MAX_BYTES, writeFileAtomic } from "../src/main/fileWrites";
import { nodeReleaseOps } from "../src/shared/releases";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cutex-file-writes-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("writeFileAtomic", () => {
  it("replaces the file whole and leaves no temp file behind", () => {
    const file = join(dir, "update-pending.json");
    writeFileAtomic(file, '{"a":1}');
    writeFileAtomic(file, '{"a":2}');
    expect(readFileSync(file, "utf8")).toBe('{"a":2}');
    expect(readdirSync(dir)).toEqual(["update-pending.json"]);
  });

  it("a failed rename leaves the old file and removes its temp file", () => {
    const file = join(dir, "channel");
    writeFileSync(file, "release");
    // A directory where the file should go: the rename fails.
    const blocked = join(dir, "blocked");
    fs.mkdirSync(blocked);
    fs.writeFileSync(join(blocked, "x"), "");
    expect(() => writeFileAtomic(blocked, "next")).toThrow();
    expect(readFileSync(file, "utf8")).toBe("release");
    expect(readdirSync(dir).sort()).toEqual(["blocked", "channel"]);
  });
});

describe("rotateUpdateLog", () => {
  it("keeps appending below the limit and rotates to update.1.log at it (one older file kept)", () => {
    const file = join(dir, "update.log");
    rotateUpdateLog(file); // no log yet: nothing to do
    writeFileSync(file, "x".repeat(100));
    rotateUpdateLog(file, 1000);
    expect(readdirSync(dir)).toEqual(["update.log"]);
    writeFileSync(file, "first".repeat(300));
    rotateUpdateLog(file, 1000);
    expect(readdirSync(dir)).toEqual(["update.1.log"]);
    writeFileSync(file, "second".repeat(300));
    rotateUpdateLog(file, 1000);
    expect(readdirSync(dir)).toEqual(["update.1.log"]);
    expect(readFileSync(join(dir, "update.1.log"), "utf8").startsWith("second")).toBe(true);
    expect(UPDATE_LOG_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("release maintenance writes", () => {
  it("MOVED_AT / sidecar writes go through a temp file and a rename", () => {
    const renames: [string, string][] = [];
    const ops = nodeReleaseOps({ ...fs, renameSync: (a: string, b: string) => (renames.push([a, b]), fs.renameSync(a, b)) } as never, { sep: "/", win: false } as never);
    const file = join(dir, "MOVED_AT");
    ops.writeFile(file, "2026-10-23");
    expect(readFileSync(file, "utf8")).toBe("2026-10-23");
    expect(renames).toHaveLength(1);
    expect(renames[0]![1]).toBe(file);
    expect(readdirSync(dir)).toEqual(["MOVED_AT"]);
  });
});
