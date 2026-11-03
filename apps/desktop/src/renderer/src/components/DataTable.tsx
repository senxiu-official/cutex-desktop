// The app's light list table (Tasks, Services): a quiet column header, optional foldable group
// rows (projects), hairline rows. No cards. Fold state is remembered in ui prefs. Optional: sortable column
// headers (`sort` + Column.sortable; the caller owns and persists the order) and per-row attributes (`rowProps`,
// e.g. roving focus and keys for a keyboard-navigable list).
import { Fragment, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toggleFolded, useUiPrefs } from "../lib/prefs";
import { VirtualTableBody } from "./VirtualTableBody";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** CSS width; omit for the flexible column. */
  width?: string;
  align?: "right";
  /** The header sorts by this column when the table has `sort`. */
  sortable?: boolean;
  cell(row: T): ReactNode;
}

export interface TableSort {
  key: string;
  desc: boolean;
  onSort(key: string): void;
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
  virtualize = false,
  sort,
  rowProps,
}: {
  columns: Column<T>[];
  groups: RowGroup<T>[];
  rowKey(row: T): string;
  foldPrefix: string;
  hideHeader?: boolean;
  onRowContextMenu?(e: MouseEvent, row: T): void;
  /** Extra full-width content under a row (e.g. service logs). */
  after?(row: T): ReactNode;
  /** Opt in to measured rows in the nearest page scroller. */
  virtualize?: boolean;
  /** Clickable headers of the `sortable` columns (aria-sort on the sorted one). */
  sort?: TableSort;
  /** Extra attributes of a data row (`className` is added to the table's own). */
  rowProps?(row: T): HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string | undefined>;
}) {
  const folded = useUiPrefs().foldedGroups;
  const align = (c: Column<T>) => (c.align === "right" ? "text-right" : "text-left");
  const groupRow = (g: RowGroup<T>, foldKey: string, isFolded: boolean) => (
    <tr className="cursor-pointer select-none" onClick={() => toggleFolded(foldKey)}>
      <td colSpan={columns.length} className="px-2 pt-4 pb-1 text-xs font-medium text-muted hover:text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 text-caption/[inherit] text-subtle">{isFolded ? "▸" : "▾"}</span>
          {g.label}
          <span className="font-normal text-subtle">{g.rows.length}</span>
        </span>
      </td>
    </tr>
  );
  const dataRow = (row: T) => {
    const { className, ...extra } = rowProps?.(row) ?? {};
    return (
    <Fragment>
      <tr {...extra} className={`group border-b border-border/60 hover:bg-surface-2/40 ${className ?? ""}`} onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, row) : undefined}>
        {columns.map((c) => (
          <td key={c.key} className={`h-9 overflow-hidden px-2 ${align(c)}`}>
            {c.cell(row)}
          </td>
        ))}
      </tr>
      {after?.(row)}
    </Fragment>
    );
  };
  const header = (c: Column<T>) => {
    if (!sort || !c.sortable) return c.header;
    const on = sort.key === c.key;
    const Arrow = sort.desc ? ArrowDown : ArrowUp;
    return (
      <button type="button" onClick={() => sort.onSort(c.key)} className={`inline-flex max-w-full items-center gap-0.5 rounded hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${c.align === "right" ? "flex-row-reverse" : ""} ${on ? "text-foreground" : ""}`}>
        <span className="truncate">{c.header}</span>
        {on && <Arrow size={11} className="shrink-0" aria-hidden />}
      </button>
    );
  };
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      {!hideHeader && (
        <thead>
          <tr className="border-b border-border text-caption/[inherit] text-subtle">
            {columns.map((c) => (
              <th key={c.key} aria-sort={sort && c.sortable ? (sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none") : undefined} className={`px-2 pb-1.5 font-normal ${align(c)} ${sort && c.sortable ? "overflow-hidden" : ""}`}>
                {header(c)}
              </th>
            ))}
          </tr>
        </thead>
      )}
      {virtualize ? <VirtualTableBody columnCount={columns.length} items={groups.flatMap((g) => {
        const foldKey = `${foldPrefix}:${g.key}`;
        const isFolded = g.label !== null && folded.includes(foldKey);
        return [
          ...(g.label !== null ? [{ key: `group:${g.key}`, kind: "group" as const, render: () => groupRow(g, foldKey, isFolded) }] : []),
          ...(!isFolded ? g.rows.map((row) => ({ key: `row:${g.key}:${rowKey(row)}`, kind: "row" as const, render: () => dataRow(row) })) : []),
        ];
      })} /> : <tbody>
        {groups.map((g) => {
          const foldKey = `${foldPrefix}:${g.key}`;
          const isFolded = g.label !== null && folded.includes(foldKey);
          return (
            <Fragment key={g.key}>
              {g.label !== null && (
                groupRow(g, foldKey, isFolded)
              )}
              {!isFolded &&
                g.rows.map((row) => (
                  <Fragment key={rowKey(row)}>
                    {dataRow(row)}
                  </Fragment>
                ))}
            </Fragment>
          );
        })}
      </tbody>}
    </table>
  );
}
