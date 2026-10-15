// The app's light list table (Tasks, Services): a quiet column header, optional foldable group
// rows (projects), hairline rows. No cards. Fold state is remembered in ui prefs.
import { Fragment, type MouseEvent, type ReactNode } from "react";
import { toggleFolded, useUiPrefs } from "../lib/prefs";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** CSS width; omit for the flexible column. */
  width?: string;
  align?: "right";
  cell(row: T): ReactNode;
}

export interface RowGroup<T> {
  key: string;
  /** null = no group row (flat list). */
  label: ReactNode | null;
  rows: T[];
}

export function DataTable<T>({
  columns,
  groups,
  rowKey,
  foldPrefix,
  hideHeader,
  onRowContextMenu,
  after,
}: {
  columns: Column<T>[];
  groups: RowGroup<T>[];
  rowKey(row: T): string;
  foldPrefix: string;
  hideHeader?: boolean;
  onRowContextMenu?(e: MouseEvent, row: T): void;
  /** Extra full-width content under a row (e.g. service logs). */
  after?(row: T): ReactNode;
}) {
  const folded = useUiPrefs().foldedGroups;
  const align = (c: Column<T>) => (c.align === "right" ? "text-right" : "text-left");
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      {!hideHeader && (
        <thead>
          <tr className="border-b border-border text-[11px] text-subtle">
            {columns.map((c) => (
              <th key={c.key} className={`px-2 pb-1.5 font-normal ${align(c)}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {groups.map((g) => {
          const foldKey = `${foldPrefix}:${g.key}`;
          const isFolded = g.label !== null && folded.includes(foldKey);
          return (
            <Fragment key={g.key}>
              {g.label !== null && (
                <tr className="cursor-pointer select-none" onClick={() => toggleFolded(foldKey)}>
                  <td colSpan={columns.length} className="px-2 pt-4 pb-1 text-xs font-medium text-muted hover:text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 text-[10px] text-subtle">{isFolded ? "▸" : "▾"}</span>
                      {g.label}
                      <span className="font-normal text-subtle">{g.rows.length}</span>
                    </span>
                  </td>
                </tr>
              )}
              {!isFolded &&
                g.rows.map((row) => (
                  <Fragment key={rowKey(row)}>
                    <tr className="group border-b border-border/60 hover:bg-surface-2/40" onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, row) : undefined}>
                      {columns.map((c) => (
                        <td key={c.key} className={`h-9 overflow-hidden px-2 ${align(c)}`}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                    {after?.(row)}
                  </Fragment>
                ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
