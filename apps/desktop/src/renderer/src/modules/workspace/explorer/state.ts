// The 文件 card's instance state (pure; tested): v1 = { q } (the old search box), the explorer adds `root`.
import type { Json } from "../../types";
import type { FilesState } from "./Explorer";

export function restoreFiles(raw: Json): FilesState {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return { q: typeof v.q === "string" ? v.q.slice(0, 200) : "", ...(v.root === "cwd" ? { root: "cwd" as const } : {}) };
}
