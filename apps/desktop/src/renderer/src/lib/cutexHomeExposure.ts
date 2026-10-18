// Owner Q11: an extra writable directory that is an ancestor of the host's cutex home (e.g. the user's
// home `~`) makes `~/.cutex` (Profiles, tokens) writable for that agent. cutex refuses the cutex home
// itself and paths inside it (`writable_root_in_cutex_home`) but allows ancestors; the desktop keeps
// allowing them and only warns. cutex does not expose its home path, so this compares against the
// default home `<host user's home>/.cutex` (the home from `GET /v2/fs/dirs`, lib/hostHome); an
// independent instance (`CUTEX_HOME` elsewhere) is not detected. Pure string work on the host's paths:
// Windows paths (drive letter or UNC) compare case-insensitively with `\` and `/` alike.

/** Comparable form of a host path: `/` separators, no `\\?\` prefix, `.` / `..` resolved, no trailing `/`. */
export function normalizeHostPath(path: string): { key: string; windows: boolean } | null {
  let p = path.trim().replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
  if (!p) return null;
  p = p.replace(/\\/g, "/");
  const drive = /^([A-Za-z]):(\/|$)/.exec(p);
  const unc = !drive && /^\/\/[^/]/.test(p);
  const windows = !!drive || unc;
  let prefix: string;
  let rest: string;
  if (drive) {
    prefix = `${drive[1]!.toLowerCase()}:`;
    rest = p.slice(2);
  } else if (unc) {
    prefix = "/";
    rest = p.slice(1);
  } else if (p.startsWith("/")) {
    prefix = "";
    rest = p;
  } else {
    return null; // relative: not a host path
  }
  const parts: string[] = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(windows ? part.toLowerCase() : part);
  }
  return { key: `${prefix}/${parts.join("/")}`, windows };
}

/** The host's default cutex home (`<home>/.cutex`), in the home's own separator style. */
export function defaultCutexHome(home: string): string {
  const sep = /^[A-Za-z]:|^\\\\/.test(home) && !home.includes("/") ? "\\" : "/";
  return `${home.replace(/[\\/]+$/, "")}${sep}.cutex`;
}

/** `root` is `cutexHome` or one of its ancestors (writing there can reach the cutex home). */
export function exposesCutexHome(root: string, cutexHome: string): boolean {
  const r = normalizeHostPath(root);
  const c = normalizeHostPath(cutexHome);
  if (!r || !c || r.windows !== c.windows) return false;
  if (r.key === c.key) return true;
  const base = r.key.endsWith("/") ? r.key : `${r.key}/`;
  return c.key.startsWith(base);
}
