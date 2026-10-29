// Dragging workspace paths (the 文件 explorer's rows, docs/design/019 §8) into the composer: the rows carry
// their workspace-relative paths under WORKSPACE_PATHS_MIME (plain text as the fallback for other drop
// targets); the composer inserts them as the same `path` mentions as 「在输入框里提到」. Pure; tested.
export const WORKSPACE_PATHS_MIME = "application/x-cutex-workspace-path";

/** The dragged paths (a JSON list of strings; anything else = none). */
export function parseDraggedPaths(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 4000).slice(0, 200) : [];
  } catch {
    return [];
  }
}

/** Text the composer appends for dropped paths: each as `path`, space separated. */
export function mentionText(paths: readonly string[]): string {
  return paths.map((p) => `\`${p}\` `).join("");
}
