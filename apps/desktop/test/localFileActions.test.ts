import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ dialog: {} }));
import { localFileAction, localFileOpenInfo, validatedLocalFilePath } from "../src/main/localFiles";
import { canOpenResolvedFile, fileNameType, fileOpenKind, isAbsoluteFilePath } from "../src/shared/localFiles";
import { runFileDialogOptions, runFilePromptText } from "../src/main/localFileRunPrompt";

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
  for (const suffix of ["exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "scr", "pif", "lnk", "url", "reg", "hta", "cpl", "jar", "appref-ms", "app", "command", "sh", "desktop", "py", "pyw", "rb", "pl", "mjs"]) {
    const target = join(root, `payload.${suffix.toUpperCase()}`); await writeFile(target, "synthetic fixture");
    expect(await localFileOpenInfo("local", target)).toEqual({ canOpen: false, runnable: fileNameType(target) });
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
  expect(await localFileOpenInfo("local", file)).toEqual({ canOpen: false, runnable: "program" });
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

it("decides by type on macOS/Linux: a document opens whatever its mode; only a name with no known type follows the +x bit", () => {
  for (const platform of ["linux", "darwin"]) {
    // A PDF or spreadsheet copied from Windows (or a git checkout) is often 0755: still a document.
    for (const mode of [0o644, 0o744, 0o654, 0o645, 0o755]) {
      expect(canOpenResolvedFile("/tmp/report.txt", "/tmp/report.txt", platform, mode)).toBe(true);
      expect(canOpenResolvedFile("/mnt/c/Budget.XLSX", "/mnt/c/Budget.XLSX", platform, mode)).toBe(true);
    }
    expect(fileOpenKind("/tmp/runme", "/tmp/runme", platform, 0o755)).toBe("program");
    expect(fileOpenKind("/tmp/data.weird", "/tmp/data.weird", platform, 0o711)).toBe("program");
    expect(fileOpenKind("/tmp/notes", "/tmp/notes", platform, 0o644)).toBe("document");
    for (const path of ["/tmp/App.app", "/tmp/run.command", "/tmp/run.sh", "/tmp/app.desktop"]) expect(canOpenResolvedFile("/tmp/report.txt", path, platform, 0o644)).toBe(false);
  }
  // Windows decides by suffix only.
  expect(fileOpenKind("C:/x/runme", "C:/x/runme", "win32", 0o755)).toBe("document");
  expect(fileOpenKind("C:/x/a.txt", "C:/x/a.ps1", "win32", 0o644)).toBe("script");
});

it("runs a script or program only after main's dialog says 运行, and checks the file again afterwards", async () => {
  const script = join(root, "build.ps1"); await writeFile(script, "synthetic fixture");
  const confirmRun = vi.fn(async () => false);
  await localFileAction("local", script, "run", shell, confirmRun);
  expect(confirmRun).toHaveBeenCalledExactlyOnceWith({ path: script, kind: "script" });
  expect(shell.openPath).not.toHaveBeenCalled();
  confirmRun.mockResolvedValueOnce(true);
  await localFileAction("local", script, "run", shell, confirmRun);
  expect(shell.openPath).toHaveBeenCalledExactlyOnceWith(script);
  // Changed while the dialog was open: not run.
  shell.openPath.mockClear();
  confirmRun.mockImplementationOnce(async () => { await writeFile(script, "synthetic fixture, changed"); return true; });
  await expect(localFileAction("local", script, "run", shell, confirmRun)).rejects.toThrow("changed");
  expect(shell.openPath).not.toHaveBeenCalled();
  // No dialog available, or a document: never run.
  await expect(localFileAction("local", script, "run", shell)).rejects.toThrow("unavailable");
  await expect(localFileAction("local", file, "run", shell, async () => true)).rejects.toThrow("only a script or program");
  await expect(localFileAction("ssh-host", script, "run", shell, async () => true)).rejects.toThrow("remote");
  expect(shell.openPath).not.toHaveBeenCalled();
});

it("the run dialog names the full path and type, defaults to Cancel and has no remember box", () => {
  const zh = runFilePromptText("zh-CN", { path: String.raw`C:\tools\setup.exe`, kind: "program" });
  expect(zh.detail).toContain(String.raw`C:\tools\setup.exe`); expect(zh.detail).toContain(".exe"); expect(zh.message).toContain("setup.exe");
  const en = runFilePromptText("en", { path: "/home/me/run.sh", kind: "script" });
  expect(en.detail).toContain("/home/me/run.sh"); expect(en.detail).toContain("Script (.sh)");
  expect(runFilePromptText("zh-Hant-TW", { path: "/a/b.sh", kind: "script" }).run).toBe("執行");
  const options = runFileDialogOptions(en);
  expect(options.buttons).toEqual(["Cancel", "Run"]); expect(options.defaultId).toBe(0); expect(options.cancelId).toBe(0);
  expect(options.checkboxLabel).toBeUndefined(); expect(options.type).toBe("warning");
});

it.skipIf(process.platform === "win32")("refuses an actual executable without a known type and its symlink on Unix", async () => {
  const target = join(root, "executable"), link = join(root, "alias");
  await writeFile(target, "synthetic fixture"); await fs.chmod(target, 0o755); await fs.symlink(target, link);
  expect(await localFileOpenInfo("local", link)).toEqual({ canOpen: false, runnable: "program" });
  await expect(localFileAction("local", link, "open", shell)).rejects.toThrow("cannot be opened");
  await localFileAction("local", link, "reveal", shell);
  expect(shell.showItemInFolder).toHaveBeenCalledWith(target); expect(shell.openPath).not.toHaveBeenCalled();
});
