import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localFileAction, localFileOpenInfo, validatedLocalFilePath } from "../src/main/localFiles";
import { canOpenResolvedFile, isAbsoluteFilePath } from "../src/shared/localFiles";

let root: string;
let file: string;
const shell = { showItemInFolder: vi.fn(), openPath: vi.fn<() => Promise<string>>() };
beforeEach(async () => { root = await fs.realpath(await mkdtemp(join(tmpdir(), "desktop-reveal-"))); file = join(root, "file with spaces.md"); await writeFile(file, "synthetic fixture"); shell.showItemInFolder.mockReset(); shell.openPath.mockReset().mockResolvedValue(""); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

it("reveals existing files and folders through the shell, without opening them", async () => {
  const folder = join(root, "folder"); await mkdir(folder);
  await localFileAction("local", file, "reveal", shell);
  await localFileAction("local", folder, "reveal", shell);
  expect(shell.showItemInFolder.mock.calls).toEqual([[file], [folder]]);
  expect(shell.openPath).not.toHaveBeenCalled();
});

it("opens the validated local file and reports the operating system's failure", async () => {
  await localFileAction("local", file, "open", shell);
  expect(shell.openPath).toHaveBeenCalledWith(file);
  shell.openPath.mockResolvedValueOnce("No application available");
  await expect(localFileAction("local", file, "open", shell)).rejects.toThrow("No application available");
});

it("refuses a remote host even when its path happens to exist on this machine", async () => {
  await expect(localFileAction("ssh-host", file, "reveal", shell)).rejects.toThrow("remote");
  await expect(localFileAction("local", file, "execute", shell)).rejects.toThrow("unknown");
  expect(shell.showItemInFolder).not.toHaveBeenCalled(); expect(shell.openPath).not.toHaveBeenCalled();
});

it.each(["relative/file.md", "https://example.com/file", "file:///tmp/file", "mailto:a@example.com", "javascript:alert(1)", "C:relative.md", "", "\0", null, 42])("refuses non-file or non-absolute input %j", async (path) => {
  await expect(validatedLocalFilePath(path)).rejects.toThrow();
});

it("requires existence and recognises native absolute file syntax without treating schemes as paths", async () => {
  await expect(validatedLocalFilePath(join(root, "missing"))).rejects.toThrow();
  for (const path of ["/tmp/file", "C:\\Work\\file", "D:/Work/file"]) expect(isAbsoluteFilePath(path)).toBe(true);
  expect(isAbsoluteFilePath("file:///tmp/file")).toBe(false);
});

it.each(["\\\\attacker\\share\\file.txt", "//attacker/share/file.txt", "\\\\?\\C:\\file.txt", "\\\\.\\C:\\file.txt", "\\\\?\\UNC\\attacker\\share\\file.txt"])("rejects %s before any filesystem access", async (path) => {
  const calls = [vi.spyOn(fs, "stat"), vi.spyOn(fs, "realpath"), vi.spyOn(fs, "lstat"), vi.spyOn(fs, "readlink")];
  expect(isAbsoluteFilePath(path)).toBe(false);
  await expect(localFileAction("local", path, "reveal", shell)).rejects.toThrow();
  expect(await localFileOpenInfo("local", path)).toEqual({ canOpen: false });
  for (const call of calls) expect(call).not.toHaveBeenCalled();
  expect(shell.showItemInFolder).not.toHaveBeenCalled();
});

it("refuses executable suffixes and shortcuts but still reveals those files and similarly named folders", async () => {
  for (const suffix of ["exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "scr", "pif", "lnk", "url", "reg", "hta", "cpl", "jar", "appref-ms", "app", "command", "sh", "desktop"]) {
    const target = join(root, `payload.${suffix.toUpperCase()}`); await writeFile(target, "synthetic fixture");
    expect(await localFileOpenInfo("local", target)).toEqual({ canOpen: false });
    await expect(localFileAction("local", target, "open", shell)).rejects.toThrow("cannot be opened");
    await localFileAction("local", target, "reveal", shell);
    expect(shell.showItemInFolder).toHaveBeenLastCalledWith(target);
  }
  const folder = join(root, "folder.exe"); await mkdir(folder);
  await localFileAction("local", folder, "reveal", shell);
  expect(await localFileOpenInfo("local", folder)).toEqual({ canOpen: false });
  expect(shell.openPath).not.toHaveBeenCalled();
});

it("checks the real target, so a text-looking link cannot open an executable", async () => {
  const executable = join(root, "payload.exe"); await writeFile(executable, "synthetic executable fixture");
  // A deterministic realpath result also covers Windows without symlink privileges.
  vi.spyOn(fs, "realpath").mockResolvedValue(executable);
  expect(await localFileOpenInfo("local", file)).toEqual({ canOpen: false });
  await expect(localFileAction("local", file, "open", shell)).rejects.toThrow("cannot be opened");
  await localFileAction("local", file, "reveal", shell);
  expect(shell.showItemInFolder).toHaveBeenCalledWith(executable);
  expect(shell.openPath).not.toHaveBeenCalled();
});

it.skipIf(process.platform !== "win32")("rejects a hidden network junction target before following it", async () => {
  vi.spyOn(fs, "lstat").mockResolvedValue({ isSymbolicLink: () => true } as never);
  const link = vi.spyOn(fs, "readlink").mockResolvedValue("\\\\attacker\\share");
  const real = vi.spyOn(fs, "realpath"), stat = vi.spyOn(fs, "stat");
  await expect(localFileAction("local", file, "reveal", shell)).rejects.toThrow("network");
  expect(link).toHaveBeenCalledOnce(); expect(real).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled();
});

it("honours Unix executable bits and target names on macOS/Linux", () => {
  for (const platform of ["linux", "darwin"]) {
    expect(canOpenResolvedFile("/tmp/report.txt", "/tmp/report.txt", platform, 0o644)).toBe(true);
    for (const mode of [0o744, 0o654, 0o645, 0o755]) expect(canOpenResolvedFile("/tmp/report.txt", "/tmp/report.txt", platform, mode)).toBe(false);
    for (const path of ["/tmp/App.app", "/tmp/run.command", "/tmp/run.sh", "/tmp/app.desktop"]) expect(canOpenResolvedFile("/tmp/report.txt", path, platform, 0o644)).toBe(false);
  }
});

it.skipIf(process.platform === "win32")("refuses an actual executable text target and its symlink on Unix", async () => {
  const target = join(root, "executable.txt"), link = join(root, "alias.txt");
  await writeFile(target, "synthetic fixture"); await fs.chmod(target, 0o755); await fs.symlink(target, link);
  expect(await localFileOpenInfo("local", link)).toEqual({ canOpen: false });
  await expect(localFileAction("local", link, "open", shell)).rejects.toThrow("cannot be opened");
  await localFileAction("local", link, "reveal", shell);
  expect(shell.showItemInFolder).toHaveBeenCalledWith(target); expect(shell.openPath).not.toHaveBeenCalled();
});
