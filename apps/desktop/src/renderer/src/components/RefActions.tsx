// 「⋯ 更多」 in a hover bar (docs/desktop-modules.md §19.8): the `ref.action` items for what the bar is
// about (a turn), as a menu. Only shown when some action applies to the ref kind; the ref is built when
// the menu opens (current title / ordinal).
import { MoreHorizontal } from "lucide-react";
import { useI18n } from "../i18n";
import type { CutexRef } from "../modules/slots";
import { openMenuFrom } from "../lib/contextMenu";
import { refActionEntries, useHasRefActions } from "../lib/refActions";
import { refActionApplies } from "../lib/refActionApplies";
import { useSlot } from "../modules/react";
import type { AppSlotEntry } from "../modules/slots";
import { useApp } from "../store";
import { useHostEntryGate } from "../lib/hostGatingView";

/** The `ref.action` items as icon buttons in the message action rows (components/MessageActions; owner
 * 2026-10-11, again 2026-10-15). Same ref.action contract as menus; `useState().active` = filled icon. */
export function RefActionButtons({ kind, build }: { kind: string; build(): CutexRef | null }) {
  const entries = useSlot("ref.action");
  const ref = build();
  const onHost = useHostEntryGate(ref?.hostId);
  if (!ref) return null;
  return <>{entries.filter(e => refActionApplies(e, kind) && onHost(e)).map(entry => <RefActionButton key={entry.item.id} entry={entry} cref={ref} build={build} />)}</>;
}

function RefActionButton({ entry, cref, build }: { entry: AppSlotEntry<"ref.action">; cref: CutexRef; build(): CutexRef | null }) {
  const { t } = useI18n();
  const state = entry.item.useState?.(cref);
  const Icon = entry.item.icon;
  const label = state?.disabledReason ?? t(state?.titleKey ?? entry.item.titleKey);
  return <button title={label} aria-label={label} aria-pressed={state?.active} disabled={!!state?.disabledReason}
    className={`flex h-6 w-6 items-center justify-center rounded-md hover:bg-surface-2 disabled:opacity-40 ${state?.active ? "text-accent" : "text-subtle hover:text-foreground"}`}
    onClick={() => {
      const current = build(); if (!current || state?.disabledReason) return;
      void Promise.resolve().then(() => entry.item.run(current)).catch(error => useApp.getState().notify(error instanceof Error ? error.message : String(error), "error"));
    }}><Icon size={14} className={state?.active ? "fill-current" : undefined} /></button>;
}

export function RefMoreButton({ kind, build }: { kind: string; build(): CutexRef | null }) {
  const { t } = useI18n();
  const shown = useHasRefActions(kind);
  if (!shown) return null;
  return (
    <button
      title={t("gutter.more")}
      aria-label={t("gutter.more")}
      aria-haspopup="menu"
      onClick={(e) => openMenuFrom(e.currentTarget, refActionEntries(build()))}
      className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground"
    >
      <MoreHorizontal size={14} />
    </button>
  );
}
