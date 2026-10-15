// Title-bar breadcrumb of the open `main.page` (docs/desktop-modules.md §3.2): the page item's
// useTitle(params) gives the crumbs; earlier crumbs with a target are links, the last one is the page
// name in bold. Pages never repeat it as an in-page heading. Right-click: the modules' `ref.action`
// items for the page when it is referable (refParams, §19.8). Shell file: no feature names here
// (test/modules.test.ts scans it).
import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { services } from "../modules/app";
import { ItemBoundary } from "../modules/Outlet";
import { isExternalModuleId } from "../modules/external";
import { ExternalBadge } from "../modules/ExternalBadge";
import { useOpenPage } from "../modules/react";
import type { AppSlotEntry, PageParams } from "../modules/slots";
import { contextMenu } from "../lib/contextMenu";
import { refActionEntries, useHasRefActions } from "../lib/refActions";
import { mainPageRef } from "../lib/refs";
import { useApp } from "../store";

const NO_DRAG = "[app-region:no-drag]";

function Crumb({ children, onClick, last }: { children: ReactNode; onClick?: () => void; last: boolean }) {
  if (onClick && !last) {
    return (
      <button onClick={onClick} className={`${NO_DRAG} flex min-w-0 items-center gap-1.5 rounded px-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground`}>
        {children}
      </button>
    );
  }
  return <span className={`flex min-w-0 items-center gap-1.5 px-1 text-sm ${last ? "font-semibold" : "text-muted"}`}>{children}</span>;
}

function Crumbs({ entry, params }: { entry: AppSlotEntry<"main.page">; params: PageParams }) {
  const crumbs = entry.item.useTitle(params);
  const sep = <ChevronRight size={13} className="shrink-0 text-subtle" />;
  const referable = useHasRefActions("main.page") && !!entry.item.refParams;
  const menu = () => {
    let safe: PageParams | null = null;
    try {
      safe = entry.item.refParams?.(params) ?? null;
    } catch {
      safe = null;
    }
    const title = crumbs.map((c) => c.text).join(" › ") || entry.item.id;
    return safe ? refActionEntries(mainPageRef(useApp.getState().hosts?.active ?? "local", entry.item.id, safe as Record<string, string>, title)) : [];
  };
  return (
    <div className="flex min-w-0 items-center gap-0.5" onContextMenu={referable ? contextMenu(menu) : undefined}>
      {isExternalModuleId(entry.moduleId) && <ExternalBadge />}
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        const to = c.to;
        return (
          <Fragment key={i}>
            {i > 0 && sep}
            <Crumb last={last} onClick={to ? () => services.ui.openPage(to.page, to.params) : undefined}>
              {c.lead}
              <span className="truncate">{c.text}</span>
              {c.trail}
            </Crumb>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Breadcrumb of the open page (nothing while its module is off / loading). */
export function PageTitle() {
  const open = useOpenPage();
  if (!open?.entry) return null;
  return (
    <ItemBoundary moduleId={open.entry.moduleId} resetKey={open.page}>
      {/* Keyed by page: each page's useTitle hook gets its own component instance. */}
      <Crumbs key={open.page} entry={open.entry} params={open.params} />
    </ItemBoundary>
  );
}
