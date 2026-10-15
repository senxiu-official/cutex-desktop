// 「上次异常关机前有 N 个智能体在线」: after a power loss / crash cutex lists the agents whose runtime
// was online (cutex runtime-restore-candidates). Non-blocking notice for the shown host: 全部恢复 /
// 选择 (tick which) / 忽略 (dismiss on cutex). Restoring = the ordinary 上线 per agent, one after
// another, with failures listed per agent. Nothing starts without the owner's click.
// One place only (UI review #11): a small card at the top of the sidebar (`RestoreBanner`, mounted by
// the Sidebar); while the sidebar is collapsed, a title-bar chip (`RestoreChip`) opens the same card
// as a popover. Full-window pages (设置) show neither.
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { RUNTIME_RESTORE_FEATURE, type RestoreCandidates } from "../../../shared/runtimeRestore";
import { api } from "../bridge";
import { useI18n } from "../i18n";
import { chosenCandidates, restoreSequentially, type RestoreOutcome } from "../lib/runtimeRestore";
import { useTrackOverlay } from "../lib/openOverlays";
import { useApp } from "../store";

const COMPACT_BUTTON = "shrink-0 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-foreground disabled:opacity-50";

type RestoreState = NonNullable<ReturnType<typeof useRestoreState>>;

/** The shown host's restore candidates and the actions on them; null when there is nothing to show. */
function useRestoreState() {
  const { t } = useI18n();
  const supported = useApp((s) => s.features.has(RUNTIME_RESTORE_FEATURE));
  const host = useApp((s) => s.hosts?.active);
  const sessionAction = useApp((s) => s.sessionAction);
  const [data, setData] = useState<RestoreCandidates | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<RestoreOutcome[]>([]);

  const load = () =>
    api
      .restoreCandidates()
      .then((d) => setData(d))
      .catch(() => setData(null));
  useEffect(() => {
    setData(null);
    setChoosing(false);
    setFailed([]);
    if (supported) void load();
  }, [supported, host]); // eslint-disable-line react-hooks/exhaustive-deps -- reload per host

  const items = data?.items ?? [];
  if (!supported || (items.length === 0 && failed.length === 0)) return null;

  const restore = async (ids: Set<string>) => {
    const list = chosenCandidates(items, ids);
    if (list.length === 0) return;
    setChoosing(false);
    setFailed([]);
    setProgress({ done: 0, total: list.length });
    const outcomes = await restoreSequentially(
      list,
      (id) => sessionAction(id, "cutex/runtime/online", { openVisibleTerminal: false }),
      (done, total) => setProgress({ done, total }),
    );
    setProgress(null);
    setFailed(outcomes.filter((o) => o.error !== null));
    await load();
  };
  const dismiss = async () => {
    setFailed([]);
    setChoosing(false);
    const r = await api.dismissRestoreCandidates().catch(() => null);
    if (r?.ok) setData(null);
    else void load();
  };
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startChoosing = () => {
    setChosen(new Set(items.map((i) => i.cutexSessionId)));
    setChoosing((v) => !v);
  };
  const busy = progress !== null;
  const message = busy
    ? t("restore.running", { done: progress.done, total: progress.total })
    : items.length > 0
      ? t(data?.reason === "host_rebooted" ? "restore.promptReboot" : "restore.prompt", { count: items.length })
      : t("restore.failedSummary", { count: failed.length });
  return { items, failed, choosing, chosen, busy, message, restore, dismiss, toggle, startChoosing, clearFailed: () => setFailed([]) };
}

/** The notice's body: message, the agent ticks while choosing, failures, then the actions. */
function RestoreCard({ state: s, className }: { state: RestoreState; className: string }) {
  const { t } = useI18n();
  return (
    <div className={`text-xs ${className}`} role="status" data-testid="restore-banner">
      <div className="flex items-start gap-1.5">
        <RotateCcw size={13} className="mt-px shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 leading-[1.45] text-foreground">{s.message}</span>
      </div>
      {s.choosing && !s.busy && (
        <div className="mt-1.5 flex flex-col gap-0.5 pl-5">
          {s.items.map((item) => (
            <label key={item.cutexSessionId} className="flex min-w-0 cursor-pointer items-center gap-1.5" title={t("restore.lastOnline", { at: new Date(item.lastOnlineAt).toLocaleString() })}>
              <input type="checkbox" checked={s.chosen.has(item.cutexSessionId)} onChange={() => s.toggle(item.cutexSessionId)} />
              <span className="truncate">{item.displayName}</span>
            </label>
          ))}
        </div>
      )}
      {s.failed.length > 0 && !s.busy && (
        <ul className="mt-1.5 space-y-0.5 pl-5 text-danger">
          {s.failed.map((f) => (
            <li key={f.cutexSessionId} className="truncate" title={f.error ?? undefined}>
              {t("restore.failedOne", { name: f.displayName, error: f.error ?? "" })}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-0.5 pl-3.5">
        {s.items.length > 0 &&
          (s.choosing && !s.busy ? (
            <button className={`${COMPACT_BUTTON} text-accent`} disabled={s.chosen.size === 0} onClick={() => void s.restore(s.chosen)}>
              {t("restore.chosen", { count: chosenCandidates(s.items, s.chosen).length })}
            </button>
          ) : (
            <button className={`${COMPACT_BUTTON} text-accent`} disabled={s.busy} onClick={() => void s.restore(new Set(s.items.map((i) => i.cutexSessionId)))}>
              {t("restore.all")}
            </button>
          ))}
        {s.items.length > 0 && (
          <button className={COMPACT_BUTTON} disabled={s.busy} aria-pressed={s.choosing} onClick={s.startChoosing}>
            {t("restore.choose")}
          </button>
        )}
        <button className={COMPACT_BUTTON} disabled={s.busy} onClick={() => void (s.items.length > 0 ? s.dismiss() : s.clearFailed())}>
          {t("restore.dismiss")}
        </button>
      </div>
    </div>
  );
}

/** The sidebar's notice (top of the sidebar). The card is the only form now; `compact` stays for the mount. */
export function RestoreBanner(_props: { compact?: boolean }) {
  const state = useRestoreState();
  if (!state) return null;
  return <RestoreCard state={state} className="mx-2 mt-2 rounded-lg bg-surface-2/70 px-2.5 py-2" />;
}

/** Title-bar chip while the sidebar is collapsed: 「↺ 恢复 4」, opening the same card below it. */
export function RestoreChip() {
  const { t } = useI18n();
  const state = useRestoreState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const shown = open && !!state;
  useTrackOverlay(shown);
  useEffect(() => {
    if (!shown) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown]);
  if (!state) return null;
  const count = state.items.length || state.failed.length;
  const onlyFailures = state.failed.length > 0 && state.items.length === 0;
  return (
    <div ref={ref} className="relative shrink-0 [app-region:no-drag]">
      <button
        onClick={() => setOpen(!open)}
        title={state.message}
        aria-label={state.message}
        aria-expanded={shown}
        aria-haspopup="dialog"
        className={`flex h-6 items-center gap-1 rounded-md px-1.5 text-xs hover:bg-surface-2 hover:text-foreground ${shown ? "bg-surface-2 text-foreground" : onlyFailures ? "text-danger" : "text-muted"}`}
      >
        <RotateCcw size={13} className="shrink-0" />
        {t("restore.chip", { count })}
      </button>
      {shown && (
        <div role="dialog" aria-label={state.message} className="absolute top-full left-0 z-40 mt-1 w-72 rounded-xl border border-border bg-surface p-2.5 shadow-xl">
          <RestoreCard state={state} className="" />
        </div>
      )}
    </div>
  );
}
