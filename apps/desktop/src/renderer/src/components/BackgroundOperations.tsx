// 后台操作 (owner 2026-11-05): the tray's button for what this desktop asked cutex to do in bulk (lib/backgroundOperations).
// Shown only while something runs or a failure is unread: a spinner and 「3/12」 over everything running, a red dot for
// a failure. It opens a floating panel (components/AnchoredPanel) with the running and recent operations, newest first:
// title, host, progress; per agent its state and why it failed, with 重试 (one, or all failed of an operation). Closing
// the dialog that started an operation does not lose it. Only operations started here are listed: cutex has no list of
// its own operations yet, so those started elsewhere (another desktop, the CLI, an agent) need a cutex API first.
import { useEffect, useRef, useState, type RefObject } from "react";
import { Activity, AlertCircle, Check, ChevronDown, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { traySide } from "../lib/anchoredPanel";
import {
  acknowledgeOperations,
  clearFinishedOperations,
  itemRunning,
  operationItem,
  operationRunning,
  operationsSummary,
  updateOperationItem,
  useBackgroundOperations,
  type BackgroundOperation,
  type OperationItem,
} from "../lib/backgroundOperations";
import { useApp } from "../store";
import { AnchoredPanel } from "./AnchoredPanel";

const failed = (item: OperationItem) => item.state === "failed" || item.state === "uncertain";

export function BackgroundOperations() {
  const { t } = useI18n();
  const operations = useBackgroundOperations((s) => s.operations);
  const summary = operationsSummary(operations);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!summary.running && !summary.unreadFailure && !open) return null;
  const progress = t("operations.progress", { done: summary.done, total: summary.total });
  const label = summary.running ? `${t("operations.title")} · ${progress}` : summary.unreadFailure ? t("operations.failedTitle") : t("operations.title");
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-tray-item=""
        data-tray-operations=""
        data-failed={summary.unreadFailure ? "" : undefined}
        className="tray-operations"
        data-tip={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {summary.running ? (
          <>
            <Loader2 size={15} strokeWidth={1.75} className="animate-spin motion-reduce:animate-none" aria-hidden />
            <span data-operations-progress="" className="text-caption tabular-nums">
              {summary.done}/{summary.total}
            </span>
          </>
        ) : (
          <Activity size={16} strokeWidth={1.75} aria-hidden />
        )}
        {summary.unreadFailure && <span data-operation-failure="" className="tray-operations-dot" />}
      </button>
      {open && <OperationsList anchor={trigger} onClose={() => setOpen(false)} />}
    </>
  );
}

export function OperationsList({ anchor, onClose }: { anchor: RefObject<HTMLElement | null>; onClose(): void }) {
  const { t } = useI18n();
  const operations = useBackgroundOperations((s) => s.operations);
  // Seen: a failure shown here (also one arriving while the panel is open) no longer marks the button.
  useEffect(() => {
    const unread = operations.filter((op) => op.unreadFailure).map((op) => op.id);
    if (unread.length) acknowledgeOperations(unread);
  }, [operations]);
  const finished = operations.some((op) => !operationRunning(op));
  return (
    <AnchoredPanel anchor={anchor} side={traySide(anchor.current)} label={t("operations.title")} onClose={onClose} className="w-96" data-operations-list="">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className="flex-1 text-ui font-semibold">{t("operations.title")}</span>
        {finished && (
          <button type="button" onClick={clearFinishedOperations} className="h-6 rounded-ctl px-1.5 text-meta text-muted hover:bg-hover hover:text-foreground">
            {t("operations.clear")}
          </button>
        )}
      </div>
      <div className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
        {!operations.length && <p className="px-1.5 py-3 text-meta text-muted">{t("operations.empty")}</p>}
        {operations.map((op) => (
          <Operation key={op.id} op={op} />
        ))}
      </div>
      <p className="shrink-0 border-t border-border px-3 py-2 text-caption/[inherit] text-subtle">{t("operations.scopeNote")}</p>
    </AnchoredPanel>
  );
}

function Operation({ op }: { op: BackgroundOperation }) {
  const { t } = useI18n();
  const hosts = useApp((s) => s.hosts);
  const busy = operationRunning(op);
  const done = op.items.filter((item) => !itemRunning(item)).length;
  const failures = op.items.filter(failed);
  const retryable = failures.filter((item) => item.retry);
  // Running and failed operations show their agents; one that went fine folds to its title line.
  const [unfolded, setUnfolded] = useState<boolean | null>(null);
  const showItems = unfolded ?? (busy || failures.length > 0);
  const multiHost = (hosts?.hosts.length ?? 0) > 1;
  const host = multiHost ? (hosts?.hosts.find((h) => h.id === op.hostId)?.label ?? op.hostId) : null;
  const title = t(op.titleKey, op.titleVars);
  const time = new Date(op.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const status = busy ? `${done}/${op.items.length}` : failures.length ? t("operations.failedCount", { n: failures.length }) : t("operations.allDone");
  const listed = op.items.filter((item) => item.name);
  return (
    <section data-background-operation={op.id} data-busy={busy ? "" : undefined} className="rounded-ctl px-1.5 py-1.5 [&+&]:mt-0.5">
      <button
        type="button"
        data-panel-row=""
        aria-expanded={listed.length ? showItems : undefined}
        disabled={!listed.length}
        onClick={() => setUnfolded(!showItems)}
        data-tip={listed.length ? t(showItems ? "operations.less" : "operations.more") : undefined}
        className="-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-center gap-2 rounded-ctl px-1.5 py-1 text-left hover:bg-hover disabled:hover:bg-transparent"
      >
        <span className={`flex size-4 shrink-0 items-center justify-center ${busy ? "text-accent" : failures.length ? "text-danger" : "text-ok-text"}`}>
          {busy ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : failures.length ? <AlertCircle size={14} aria-hidden /> : <Check size={14} aria-hidden />}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        <span className={`shrink-0 text-meta tabular-nums ${failures.length && !busy ? "text-danger" : "text-muted"}`}>{status}</span>
        {listed.length > 0 && (showItems ? <ChevronDown size={13} className="shrink-0 text-subtle" /> : <ChevronRight size={13} className="shrink-0 text-subtle" />)}
      </button>
      <div className="flex min-w-0 items-center gap-1.5 pl-6 text-caption/[inherit] text-subtle">
        <span className="tabular-nums">{time}</span>
        {host && <span className="truncate">· {host}</span>}
      </div>
      {busy && op.items.length > 1 && (
        <div className="mt-1.5 ml-6 h-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((done / op.items.length) * 100)}%` }} />
        </div>
      )}
      {!listed.length && failures.map((item) => <p key={item.key} className="mt-1 pl-6 text-meta break-words text-danger">{item.detail}</p>)}
      {showItems && listed.length > 0 && (
        <ul className="mt-1 pl-6">
          {listed.map((item) => (
            <Result key={item.key} item={item} op={op} busy={busy} />
          ))}
        </ul>
      )}
      {showItems && retryable.length > 1 && !busy && (
        <button type="button" onClick={() => retryable.forEach((item) => retry(op, item))} className="mt-1 ml-6 flex h-6 items-center gap-1 rounded-ctl px-1.5 text-meta text-accent hover:bg-accent-soft">
          <RotateCcw size={12} aria-hidden />
          {t("operations.retryFailed")}
        </button>
      )}
    </section>
  );
}

function retry(op: BackgroundOperation, item: OperationItem) {
  const run = operationItem({ operationId: op.id, key: item.key })?.retry;
  if (!run) return;
  updateOperationItem({ operationId: op.id, key: item.key }, { retry: undefined });
  void Promise.resolve()
    .then(run)
    .catch(() => {
      /* the call's receipt records its error */
    });
}

const STATE_TONE: Partial<Record<OperationItem["state"], string>> = { failed: "text-danger", uncertain: "text-danger", done: "text-ok-text" };

function Result({ item, op, busy }: { item: OperationItem; op: BackgroundOperation; busy: boolean }) {
  const { t } = useI18n();
  return (
    <li data-operation-item={item.state} className="flex min-h-7 min-w-0 items-center gap-2 py-0.5 text-meta">
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{item.name}</span>
          <span className={`flex shrink-0 items-center gap-1 ${STATE_TONE[item.state] ?? "text-muted"}`}>
            {itemRunning(item) && item.state === "running" && <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {t(`operations.state.${item.state}` as MessageKey)}
          </span>
        </span>
        {item.detail && (
          <span className="block truncate text-caption/[inherit] text-muted" data-tip={item.detail}>
            {item.detail}
          </span>
        )}
      </span>
      {item.retry && (
        <button type="button" disabled={busy} onClick={() => retry(op, item)} className="h-6 shrink-0 rounded-ctl px-1.5 text-accent hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent">
          {t("operations.retry")}
        </button>
      )}
    </li>
  );
}
