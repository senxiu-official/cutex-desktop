/** Syntactic file paths only. Main separately checks native absoluteness and existence. */
export function isAbsoluteFilePath(path: unknown): path is string {
  if (typeof path !== "string" || !path || path.includes("\0")) return false;
  // Never let a menu lookup contact an SMB server or a Windows device namespace.
  if (path.startsWith("\\\\") || path.startsWith("//")) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return false;
  return path.startsWith("/") || /^[a-z]:[\\/]/i.test(path);
}

/**
 * Opening a file with its system app is decided by its type (suffix), not by the +x bit: a program or shortcut runs
 * when opened, and so may a script (a file association such as WScript, Python or a shell); a document opens in its
 * app. Only a name with no known suffix falls back to the mode on macOS / Linux (+x: a program). Main checks the
 * real target again (main/localFiles.ts); the renderer's menus use the same lists for their first guess.
 */
const PROGRAM_SUFFIXES = new Set([
  "exe", "com", "msi", "msp", "scr", "pif", "lnk", "url", "cpl", "jar", "appref-ms", "app", "desktop",
  "vbe", "jse", "pyc", "pyo", "pyz", "scpt", "msc", "scf", "wsc", "settingcontent-ms", "appimage",
]);
const SCRIPT_SUFFIXES = new Set([
  "bat", "cmd", "ps1", "psm1", "vbs", "js", "wsf", "wsh", "reg", "hta", "command", "sh",
  "py", "pyw", "rb", "rbw", "pl", "pm", "php", "lua", "r", "rscript", "ahk", "au3", "bash", "zsh", "fish", "ksh", "csh",
  "tcl", "applescript", "vba", "mjs", "cjs",
]);
/** Documents, media and data: they open in their app whatever the mode says (a file copied from Windows is often +x). */
const DOCUMENT_SUFFIXES = new Set([
  "pdf", "txt", "text", "md", "markdown", "rst", "log", "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml", "toml", "xml", "ini", "cfg", "conf",
  "html", "htm", "css", "svg", "rtf", "epub", "tex", "bib", "ipynb",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages", "numbers", "key",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "heic", "heif", "avif", "psd",
  "mp3", "wav", "flac", "ogg", "oga", "m4a", "aac", "opus", "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv",
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar",
]);

/** What a file name says about opening it: a program (or shortcut), a script, a document, or nothing known. */
export type FileNameType = "program" | "script" | "document" | "unknown";
/** How main treats the real file: open it with its app, or never open it (a script or program; 运行… asks first). */
export type FileOpenKind = "document" | "script" | "program";

function suffixOf(path: string): string | null {
  const name = path.split(/[\\/]/).pop()!.replace(/[ .]+$/, "").toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : dot === 0 ? name.slice(1) : null;
}

export function fileNameType(path: string): FileNameType {
  const suffix = suffixOf(path);
  if (suffix === null) return "unknown";
  if (PROGRAM_SUFFIXES.has(suffix)) return "program";
  if (SCRIPT_SUFFIXES.has(suffix)) return "script";
  return DOCUMENT_SUFFIXES.has(suffix) ? "document" : "unknown";
}

/** Name check shared with menus: neither a program nor a script. Main also checks the real target and mode. */
export function canOpenFileName(path: string): boolean {
  const type = fileNameType(path);
  return type !== "program" && type !== "script";
}

/**
 * The real file's kind from both names (a link's and its target's) and, for a name with no known type, the mode:
 * on macOS / Linux an executable bit makes it a program; Windows decides by suffix only.
 */
export function fileOpenKind(original: string, resolved: string, platform: string, mode: number): FileOpenKind {
  const types = [fileNameType(original), fileNameType(resolved)];
  if (types.includes("program")) return "program";
  if (types.includes("script")) return "script";
  if (types.every((type) => type === "document") || platform === "win32") return "document";
  return (mode & 0o111) === 0 ? "document" : "program";
}

export function canOpenResolvedFile(original: string, resolved: string, platform: string, mode: number): boolean {
  return fileOpenKind(original, resolved, platform, mode) === "document";
}
