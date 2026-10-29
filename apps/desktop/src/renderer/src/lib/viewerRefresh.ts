// Exact-path invalidation from completed native patches. No filesystem access or watches.
import { changeRecords } from "./turnSummary";
import type { RawItem } from "./timeline";

/** Lexical absolute path; Windows drive/UNC paths fold case, POSIX keeps it. No realpath I/O. */
export function viewerPath(path: string, cwd: string | null): string | null {
  let value = path.replace(/^\\\\\?\\UNC\\/i, "//").replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
  if (!/^(?:[a-z]:\/|\/)/i.test(value)) {
    if (!cwd || /^[a-z]:/i.test(value)) return null;
    const base = viewerPath(cwd, null);
    if (!base) return null;
    value = `${base.replace(/\/+$/, "")}/${value}`;
  }
  const prefix = value.startsWith("//") ? "//" : value.startsWith("/") ? "/" : value.slice(0, 3);
  const segments: string[] = [];
  for (const part of value.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const result = prefix + segments.join("/");
  return prefix === "//" || /^[a-z]:/i.test(prefix) ? result.toLowerCase() : result;
}

export function completedViewerPaths(item: unknown, cwd: string | null): string[] {
  const patch = item as RawItem | null;
  if (patch?.type !== "fileChange" || patch.status !== "completed") return [];
  return [...new Set(changeRecords(patch).flatMap((change) => [change.path, change.movePath].flatMap((path) => {
    const absolute = path ? viewerPath(path, cwd) : null;
    return absolute ? [absolute] : [];
  })))];
}

/** One pending bit per mounted viewer. Burst debounce is bounded (no starvation). */
export class ViewerRefresh {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private visible = true;
  private dirty = false;
  constructor(private readonly reload: () => void, private readonly changed: (pending: boolean) => void, private readonly delayMs = 400) {}
  setView(visible: boolean, dirty: boolean): void {
    this.visible = visible;
    this.dirty = dirty;
    if (this.pending) this.schedule();
  }
  invalidate(): void {
    this.pending = true;
    this.schedule();
  }
  private schedule(): void {
    if (!this.visible) return;
    if (this.dirty) { this.changed(true); return; }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.pending || !this.visible) return;
      if (this.dirty) { this.changed(true); return; }
      this.accept();
    }, this.delayMs);
  }
  accept(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    this.changed(false);
    this.reload();
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
  }
}
