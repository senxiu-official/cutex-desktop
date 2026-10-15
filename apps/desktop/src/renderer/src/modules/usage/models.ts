// Usage-page view of model names: the 模型 split shows the names of Settings → 通用 → 模型显示名
// (lib/modelDisplay), and ids shown alike (glm-5.3 and GLM-5.3 → "GLM 5.3") add up in one series /
// row. Display only: the ledger, the price table and the requests keep the raw ids.
import type { UsageReport } from "../../../../shared/ipc";

export interface ShownModels {
  report: UsageReport;
  /** Shown name → the raw ids behind it (provider logo, tooltip). */
  ids: ReadonlyMap<string, readonly string[]>;
}

export function withShownModels(report: UsageReport, label: (id: string) => string): ShownModels {
  const ids = new Map<string, string[]>();
  let changed = false;
  const rows = report.rows.map((r) => {
    const id = r.key.model;
    if (!id) return r;
    const shown = label(id) || id;
    const list = ids.get(shown) ?? [];
    if (!list.includes(id)) list.push(id);
    ids.set(shown, list);
    if (shown === id) return r;
    changed = true;
    return { ...r, key: { ...r.key, model: shown } };
  });
  return { report: changed ? { ...report, rows } : report, ids };
}

/** Tooltip of a shown model name: its raw id(s) when they differ from it. */
export function rawIdsTitle(ids: ReadonlyMap<string, readonly string[]> | null, name: string): string | undefined {
  const list = ids?.get(name);
  return list && (list.length > 1 || list[0] !== name) ? list.join(", ") : undefined;
}
