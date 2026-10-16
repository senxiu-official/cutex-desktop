// Where the identity menu's 帮助与文档 (Help & docs) opens docs/QUICKSTART.md from.
//
// A portable install built from source has it in its checkout (<base>/src); a release package carries a
// copy next to its NOTICE (scripts/package-portable.mjs: <release>/docs/QUICKSTART.md); a dev run reads
// the repository's. A packaged app with neither (e.g. an app copied out of its release folder) opens
// the published copy on the release branch instead, so the item is always there on a packaged app.

/** The published QUICKSTART on the `release` branch of the public desktop repository. */
export const QUICKSTART_URL = "https://github.com/senxiu-official/cutex-desktop/blob/release/docs/QUICKSTART.md";

export interface QuickstartInputs {
  /** The updater's source checkout (null: none). */
  sourceDir: string | null;
  /** The running release directory of a portable install (null: not in the releases layout). */
  releaseDir: string | null;
  /** app.getAppPath(): `<package>/resources/app`, on macOS `<package>/<Name>.app/Contents/Resources/app`. */
  appPath: string;
  packaged: boolean;
}

/** Directories that may hold `docs/QUICKSTART.md`, most specific first (no duplicates). */
export function quickstartRoots(inputs: QuickstartInputs): string[] {
  const roots: (string | null)[] = [inputs.sourceDir, inputs.releaseDir];
  if (inputs.packaged) roots.push(packageRootOf(inputs.appPath));
  // A dev run: apps/desktop is the app path, the repository two levels up.
  else roots.push(parentDir(parentDir(inputs.appPath)));
  const seen = new Set<string>();
  return roots.filter((root): root is string => {
    if (!root || seen.has(root)) return false;
    seen.add(root);
    return true;
  });
}

/** The package directory around a packaged app's `resources/app` (null: an unexpected shape). */
export function packageRootOf(appPath: string): string | null {
  const parts = appPath.replace(/[\\/]+$/, "").split(/[\\/]/);
  const sep = appPath.includes("\\") && !appPath.includes("/") ? "\\" : "/";
  const n = parts.length;
  if (n < 3 || parts[n - 1]!.toLowerCase() !== "app" || parts[n - 2]!.toLowerCase() !== "resources") return null;
  // macOS: …/<Name>.app/Contents/Resources/app → the directory holding <Name>.app.
  if (n >= 5 && parts[n - 3] === "Contents" && /\.app$/i.test(parts[n - 4]!)) return parts.slice(0, n - 4).join(sep) || null;
  return parts.slice(0, n - 2).join(sep) || null;
}

function parentDir(path: string | null): string | null {
  if (!path) return null;
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at > 0 ? trimmed.slice(0, at) : null;
}

export type QuickstartTarget = { kind: "file"; path: string } | { kind: "url"; url: string };

/** The first existing local copy, else (packaged apps only) the published URL; null hides the item. */
export function resolveQuickstart(inputs: QuickstartInputs, exists: (path: string) => boolean, join: (...parts: string[]) => string): QuickstartTarget | null {
  for (const root of quickstartRoots(inputs)) {
    const path = join(root, "docs", "QUICKSTART.md");
    if (exists(path)) return { kind: "file", path };
  }
  return inputs.packaged ? { kind: "url", url: QUICKSTART_URL } : null;
}
