// main/personKey.ts writePersonKeyFile: the temp file is fsynced before the rename, the directory after
// it (where supported), and a leftover temp file cannot hand its looser permissions to the key file.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => [] as string[]);
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    fsyncSync: (fd: number) => {
      events.push(`fsync:${fs.fstatSync(fd).isDirectory() ? "dir" : "file"}`);
      fs.fsyncSync(fd);
    },
    renameSync: (from: string, to: string) => {
      events.push("rename");
      fs.renameSync(from, to);
    },
  };
});

const { generatePersonKey, parsePersonKey, writePersonKeyFile } = await import("../src/main/personKey");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cutex-keywrite-"));
  events.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("writePersonKeyFile", () => {
  it("fsyncs the file before the rename and the directory after it", () => {
    const key = generatePersonKey();
    const path = join(dir, "person-key.json");
    writePersonKeyFile(path, key);
    expect(events).toEqual(process.platform === "win32" ? ["fsync:file", "rename"] : ["fsync:file", "rename", "fsync:dir"]);
    expect(parsePersonKey(JSON.parse(readFileSync(path, "utf8"))).publicKey).toBe(key.publicKey);
  });

  it.skipIf(process.platform === "win32")("is 0600 even over a leftover world-readable temp file", () => {
    const path = join(dir, "person-key.json");
    writeFileSync(`${path}.tmp`, "stale", { mode: 0o644 });
    writePersonKeyFile(path, generatePersonKey());
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
