// The compact table of a 待清理 category: what / who → whom / age / state / action, one line per item.
// A click on a row (or Enter / Space on it) opens its details under it (full text, last error, warnings);
// the action column's buttons act without opening it. In a narrow pane (the Settings shelf beside a
// conversation) the five columns would leave 内容 no room: there 内容 sits over 谁 → 谁 and 状态 over 已等
// (two-line rows, still one row per item).
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DataTable, type Column } from "../../components/DataTable";
import { useI18n } from "../../i18n";
import { useOwnerWindow } from "../../lib/ownerContext";

export interface CleanupCells {
  what: ReactNode;
  /** Tooltip of the 内容 cell (the whole text when the cell truncates it). */
  whatTitle?: string;
  who: ReactNode;
  whoTitle?: string;
  age: ReactNode;
  state: ReactNode;
  action?: ReactNode;
}

/** Below this width (px) the table stacks its columns. */
const WIDE = 560;

export function CleanupTable<T>({ rows, rowKey, cells, details, testId, foldPrefix, actionWidth = "5rem" }: {
  rows: readonly T[];
  rowKey(row: T): string;
  cells(row: T): CleanupCells;
  /** The row's details (null: the row does not open). */
  details(row: T): ReactNode | null;
  testId: string;
  foldPrefix: string;
  actionWidth?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const win = useOwnerWindow();
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof win.ResizeObserver === "undefined") return;
    const measure = () => setWide(el.clientWidth === 0 || el.clientWidth >= WIDE);
    measure();
    const observer = new win.ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [win]);
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const memo = new Map<T, CleanupCells>();
  const cellsOf = (row: T) => {
    let c = memo.get(row);
    if (!c) memo.set(row, (c = cells(row)));
    return c;
  };
  const what = (r: T) => <span className="block truncate leading-5" title={cellsOf(r).whatTitle}>{cellsOf(r).what}</span>;
  const who = (r: T) => <span className="block truncate text-xs leading-4 text-muted" title={cellsOf(r).whoTitle}>{cellsOf(r).who}</span>;
  const age = (r: T) => <span className="block truncate text-xs leading-4 text-subtle">{cellsOf(r).age}</span>;
  const state = (r: T) => <span className="block truncate text-xs leading-4 text-subtle">{cellsOf(r).state}</span>;
  const columns: Column<T>[] = [
    ...(wide
      ? [
          { key: "what", header: t("agent-bus.cleanup.col.what"), cell: what },
          { key: "who", header: t("agent-bus.cleanup.col.who"), width: "28%", cell: who },
          { key: "age", header: t("agent-bus.cleanup.col.age"), width: "4.5rem", cell: age },
          { key: "state", header: t("agent-bus.cleanup.col.state"), width: "6rem", cell: state },
        ]
      : [
          { key: "what", header: `${t("agent-bus.cleanup.col.what")} · ${t("agent-bus.cleanup.col.who")}`, cell: (r: T) => <>{what(r)}{who(r)}</> },
          { key: "state", header: `${t("agent-bus.cleanup.col.state")} · ${t("agent-bus.cleanup.col.age")}`, width: "6.5rem", cell: (r: T) => <>{state(r)}{age(r)}</> },
        ]),
    {
      key: "action",
      header: <span className="sr-only">{t("agent-bus.cleanup.col.action")}</span>,
      width: actionWidth,
      align: "right",
      // Buttons act on their own; a click here never opens the row.
      cell: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {cellsOf(r).action}
        </div>
      ),
    },
  ];
  return (
    <div ref={box} data-testid={testId} data-layout={wide ? "wide" : "stacked"}>
      <DataTable
        columns={columns}
        groups={[{ key: "all", label: null, rows: [...rows] }]}
        rowKey={rowKey}
        foldPrefix={foldPrefix}
        rowProps={(row) => {
          const key = rowKey(row);
          if (details(row) === null) return { "data-row-id": key, "data-testid": `${testId}-row` };
          const expanded = open.has(key);
          return {
            className: "cursor-pointer",
            tabIndex: 0,
            "aria-expanded": expanded,
            "data-row-id": key,
            "data-testid": `${testId}-row`,
            onClick: () => toggle(key),
            onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
              if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
              e.preventDefault();
              toggle(key);
            },
          };
        }}
        after={(row) =>
          open.has(rowKey(row)) ? (
            <tr className="border-b border-border/60" data-testid={`${testId}-details`}>
              <td colSpan={columns.length} className="bg-surface-2/40 px-3 py-2 text-xs">
                {details(row)}
              </td>
            </tr>
          ) : null
        }
      />
    </div>
  );
}
