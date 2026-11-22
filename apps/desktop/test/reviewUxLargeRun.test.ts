// Re-review of 87a69d186 (gate-notice-review, P2): no size ban on 运行… — a large installer is hashed, not refused.
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { localFileAction } from "../src/main/localFiles";

const OLD_LIMIT = 256 * 1024 * 1024;

it("lets the owner confirm an unchanged installer larger than 256 MB", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "review-large-run-"));
  const file = join(root, "installer.exe");
  const handle = await fs.open(file, "w");
  try { await handle.truncate(OLD_LIMIT + 1); } finally { await handle.close(); }
  const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(async () => "") };
  const confirm = vi.fn(async () => true);
  try {
    await localFileAction("local", file, "run", shell, confirm);
    expect(confirm).toHaveBeenCalledOnce();
    expect(shell.openPath).toHaveBeenCalledWith(await fs.realpath(file));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 60_000);

it("the dialog opens while a large file is still being hashed; a change during the dialog still refuses", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "review-large-change-"));
  const file = join(root, "installer.exe");
  const handle = await fs.open(file, "w");
  try { await handle.truncate(OLD_LIMIT + 1); } finally { await handle.close(); }
  const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(async () => "") };
  let openedAt = 0;
  const started = Date.now();
  try {
    const run = localFileAction("local", file, "run", shell, async () => {
      openedAt = Date.now() - started;
      const before = await fs.stat(file);
      const h = await fs.open(file, "r+");
      try { await h.write(Buffer.from("MZ"), 0, 2, 1024); } finally { await h.close(); }
      await fs.utimes(file, before.atime, before.mtime);
      return true;
    });
    await expect(run).rejects.toThrow("changed");
    expect(shell.openPath).not.toHaveBeenCalled();
    expect(openedAt).toBeLessThan(2_000);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 60_000);
