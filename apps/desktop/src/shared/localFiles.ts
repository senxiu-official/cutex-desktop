/** Syntactic file paths only. Main separately checks native absoluteness and existence. */
export function isAbsoluteFilePath(path: unknown): path is string {
  if (typeof path !== "string" || !path || path.includes("\0")) return false;
  // Never let a menu lookup contact an SMB server or a Windows device namespace.
  if (path.startsWith("\\\\") || path.startsWith("//")) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return false;
  return path.startsWith("/") || /^[a-z]:[\\/]/i.test(path);
}

const EXECUTABLE_SUFFIXES = new Set([
  "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse",
  "wsf", "wsh", "msi", "msp", "scr", "pif", "lnk", "url", "reg", "hta",
  "cpl", "jar", "appref-ms", "app", "command", "sh", "desktop",
]);

/** Name check shared with menus; main also checks the real target and mode. */
export function canOpenFileName(path: string): boolean {
  const name = path.split(/[\\/]/).pop()!.replace(/[ .]+$/, "").toLowerCase();
  const suffix = name.slice(name.lastIndexOf(".") + 1);
  return !EXECUTABLE_SUFFIXES.has(suffix);
}

export function canOpenResolvedFile(original: string, resolved: string, platform: string, mode: number): boolean {
  return canOpenFileName(original) && canOpenFileName(resolved) && (platform === "win32" || (mode & 0o111) === 0);
}
