// 添加成员 / 指定 or 更换 Director picker of the 项目 page (DESIGN §4.18; the agent tab is the one place
// members and the Director are managed). Search (name, note), filters (runtime, status, membership),
// sort, multi-select (add) or single pick (Director). The candidates come from the project host's
// sidebar model (lib/projectMembers: cutex's add_member / Director rules); the mutations are the
// page's (`onAdd` / `onPickDirector`).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Crown, Search, X } from "lucide-react";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import { useI18n } from "../../i18n";
import { useOverlayState } from "../../lib/contextMenu";
import { useTrackOverlay } from "../../lib/openOverlays";
import { modelOf, profileOf, runtimeOf, type RuntimeFilter } from "../../lib/agentList";
import { rawIdTitle, useModelName } from "../../lib/modelDisplay";
import { cachedProfileList, loadProfileList } from "../../lib/profileSnapshot";
import { lastSeen } from "../../lib/offlineAgents";
import { relativeTime, STATUS_DOT, useSidebarModel } from "../../lib/sidebarView";
import { addCandidates, DEFAULT_PICKER_QUERY, directorChoices, filterCandidates, type MemberCandidate, type MemberPickerQuery } from "../../lib/projectMembers";
import { useTargetHostId, useTargetIsFocus, useTargetSidebar } from "../../lib/targetHost";
import { useApp } from "../../store";
import { Avatar } from "../../components/Avatar";
import type { AgentRow } from "../../lib/sidebar";

export type PickerMode = "add" | "director";

const GRID = "grid grid-cols-[1rem_1.75rem_minmax(0,1fr)_minmax(0,8rem)_minmax(0,7rem)_3rem] items-center gap-x-3";
const SELECT = "rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="flex shrink-0 rounded-lg bg-surface-2 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-0.5 text-xs whitespace-nowrap ${value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PickRow({
  c,
  mode,
  checked,
  last,
  profileModels,
  onToggle,
  onConfirm,
  onMove,
}: {
  c: MemberCandidate;
  mode: PickerMode;
  checked: boolean;
  last: number;
  profileModels: ReadonlyMap<string, string | null>;
  onToggle(): void;
  /** Director mode passes the row it was pressed on (the selection state may not have caught up yet). */
  onConfirm(pick?: string): void;
  onMove(el: HTMLElement, delta: 1 | -1): void;
}) {
  const { t } = useI18n();
  const modelName = useModelName();
  const s = c.row.session;
  const runtime = runtimeOf(s);
  const profile = profileOf(s) ?? (runtime === "claude" ? "Claude" : null);
  const model = modelOf(s, profileModels);
  const modelShown = modelName(model, null, profile);
  const note = s.note?.trim();
  const blocked = !c.pickable;
  const why = blocked ? (mode === "add" ? t("projects.picker.inProjectHint", { project: c.projectName ?? c.projectId ?? "" }) : t("projects.picker.currentDirector")) : undefined;
  return (
    <div
      role="option"
      aria-selected={checked}
      aria-disabled={blocked}
      tabIndex={0}
      data-pick-row
      title={why}
      onClick={() => !blocked && onToggle()}
      onDoubleClick={() => {
        if (blocked) return;
        if (mode === "director") onConfirm(c.row.id);
        else if (!checked) onToggle();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === " ") {
          e.preventDefault();
          if (!blocked) onToggle();
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (mode === "director" && !blocked) {
            if (!checked) onToggle();
            onConfirm(c.row.id);
          } else onConfirm();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          onMove(e.currentTarget, e.key === "ArrowDown" ? 1 : -1);
        }
      }}
      className={`${GRID} border-b border-border/60 px-4 py-2 outline-none last:border-b-0 focus-visible:bg-surface-2 ${blocked ? "cursor-not-allowed opacity-55" : "cursor-default"} ${checked ? "bg-accent/10" : blocked ? "" : "hover:bg-surface-2/60"}`}
    >
      <input
        type={mode === "add" ? "checkbox" : "radio"}
        tabIndex={-1}
        checked={checked}
        disabled={blocked}
        onChange={() => {}}
        aria-label={c.row.name}
        className="h-3.5 w-3.5 accent-[var(--accent)] disabled:opacity-30"
      />
      <Avatar name={c.row.name} initial={c.row.initial} color={c.row.color} avatar={s.avatar} size={26} />
      <div className="min-w-0 leading-snug">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[c.row.status]}`} title={t(`status.${c.row.status}` as const)} />
          <span className="truncate text-[13px] font-medium" title={c.row.name}>
            {c.row.name}
          </span>
          {c.row.isDirector && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1 text-[9px] font-semibold text-muted">
              <Crown size={9} />
              {t("sidebar.director")}
            </span>
          )}
        </div>
        {note && (
          <div className="truncate text-xs text-muted" title={note}>
            {note}
          </div>
        )}
      </div>
      <div className="min-w-0 text-xs leading-snug">
        <div className="truncate text-muted" title={profile ?? undefined}>
          {profile ?? "—"}
        </div>
        {model && (
          <div className="truncate text-[11px] text-subtle" title={rawIdTitle(model, modelShown) ?? model}>
            {modelShown}
          </div>
        )}
      </div>
      <div className="min-w-0 truncate text-xs">
        {mode === "director" ? (
          blocked ? <span className="text-accent">{t("projects.picker.currentDirector")}</span> : null
        ) : c.projectId ? (
          <span className="text-warn" title={why}>
            {t("projects.picker.inProject", { project: c.projectName ?? c.projectId })}
          </span>
        ) : (
          <span className="text-subtle">{t("projects.picker.independent")}</span>
        )}
      </div>
      <div className="text-right text-[11px] text-subtle tabular-nums">{relativeTime(last)}</div>
    </div>
  );
}

export function MemberPicker({
  mode,
  project,
  onClose,
  onAddFirst,
  onRotate,
  onAdd,
  onPickDirector,
}: {
  mode: PickerMode;
  project: ProjectSummary;
  onClose(): void;
  /** Director mode without members: switch to 添加成员. */
  onAddFirst(): void;
  /** Director mode with a Director: open 轮换 (handoff + a new successor) instead; null = not offered. */
  onRotate: (() => void) | null;
  /** Adds the agents one after another; resolves to the ones that failed (id → message). */
  onAdd(ids: string[]): Promise<Record<string, string>>;
  /** Assigns / switches the Director (confirms itself); resolves false when the owner cancelled. */
  onPickDirector(row: AgentRow): Promise<boolean>;
}) {
  const { t } = useI18n();
  const model = useSidebarModel();
  const hostId = useTargetHostId();
  const own = useTargetIsFocus();
  const sidebar = useTargetSidebar();
  const focusActivity = useApp((s) => s.activity);
  const overlay = useOverlayState();
  const overlayOpen = useRef(false);
  overlayOpen.current = !!(overlay.menu || overlay.dialog);
  useTrackOverlay(true);
  const [q, setQ] = useState<MemberPickerQuery>(DEFAULT_PICKER_QUERY);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState(() => cachedProfileList(hostId));
  useEffect(() => void loadProfileList(hostId).then(setProfiles, () => {}), [hostId]);
  const profileModels = useMemo(() => new Map((profiles?.profiles ?? []).flatMap((p) => [[p.id, p.model] as const, [p.name, p.model] as const])), [profiles]);

  const projectId = project.project_id;
  const directorId = project.director_cutex_session_id ?? null;
  const managed = useMemo(() => {
    const list = sidebar?.projects?.available_agents;
    return list ? new Set(list.map((a) => a.cutex_session_id)) : null;
  }, [sidebar]);
  const all = useMemo(() => (mode === "add" ? addCandidates(model.groups, projectId, managed) : directorChoices(model.groups, projectId, directorId)), [mode, model.groups, projectId, managed, directorId]);
  const activity = own ? focusActivity : {};
  const lastOf = (row: AgentRow) => lastSeen(row, activity[row.id]?.at);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => filterCandidates(all, q, lastOf), [all, q, activity]);
  const chosen = [...selected].filter((id) => all.some((c) => c.row.id === id && c.pickable));
  const set = (patch: Partial<MemberPickerQuery>) => setQ((prev) => ({ ...prev, ...patch }));

  // Esc closes — unless a menu / confirmation above the dialog takes it (capture phase).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || overlayOpen.current) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      if (mode === "director") return new Set(prev.has(id) ? [] : [id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = async (pick?: string) => {
    const ids = mode === "director" && pick ? [pick] : chosen;
    if (busy || ids.length === 0) return;
    setBusy(true);
    setErrors({});
    try {
      if (mode === "add") {
        const failed = await onAdd(ids);
        if (Object.keys(failed).length === 0) return onClose();
        setErrors(failed);
        setSelected(new Set(Object.keys(failed)));
      } else {
        const c = all.find((x) => x.row.id === ids[0] && x.pickable);
        if (c && (await onPickDirector(c.row))) onClose();
      }
    } catch (e) {
      setErrors({ "": errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const move = (el: HTMLElement, delta: 1 | -1) => {
    const list = [...(el.parentElement?.querySelectorAll<HTMLElement>("[data-pick-row]") ?? [])];
    const next = list[list.indexOf(el) + delta];
    if (next) next.focus();
    else if (delta === -1) searchRef.current?.focus();
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      listRef.current?.querySelector<HTMLElement>("[data-pick-row]")?.focus();
    } else if (e.key === "Enter" && chosen.length > 0) {
      e.preventDefault();
      void confirm();
    }
  };

  const name = project.presentation.display_name;
  const title = mode === "add" ? t("projects.picker.addTitle", { project: name }) : t(directorId ? "projects.picker.changeTitle" : "projects.picker.directorTitle", { project: name });
  const failedLines = Object.entries(errors).map(([id, error]) => (id ? t("projects.picker.failed", { name: all.find((c) => c.row.id === id)?.row.name ?? id, error }) : error));
  const noMembers = mode === "director" && all.length === 0;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-[7vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label={title} className="flex h-[min(80vh,42rem)] w-[50rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          <button title={t("projects.picker.close")} aria-label={t("projects.picker.close")} onClick={onClose} className="shrink-0 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground">
            <X size={16} />
          </button>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <label className="flex min-w-40 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 focus-within:border-accent">
            <Search size={13} className="shrink-0 text-subtle" />
            <input
              ref={searchRef}
              autoFocus
              value={q.query}
              onChange={(e) => set({ query: e.target.value })}
              onKeyDown={onSearchKey}
              placeholder={t("projects.picker.search")}
              aria-label={t("projects.picker.search")}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
            />
          </label>
          <select value={q.status} onChange={(e) => set({ status: e.target.value as MemberPickerQuery["status"] })} className={SELECT} aria-label={t("projects.picker.status.all")}>
            {(["all", "online", "offline"] as const).map((v) => (
              <option key={v} value={v}>
                {t(`projects.picker.status.${v}`)}
              </option>
            ))}
          </select>
          {mode === "add" && (
            <select value={q.membership} onChange={(e) => set({ membership: e.target.value as MemberPickerQuery["membership"] })} className={SELECT} aria-label={t("projects.picker.membership.all")}>
              {(["all", "independent", "elsewhere"] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`projects.picker.membership.${v}`)}
                </option>
              ))}
            </select>
          )}
          <select value={q.sort} onChange={(e) => set({ sort: e.target.value as MemberPickerQuery["sort"] })} className={SELECT} aria-label={t("projects.picker.sort.recent")}>
            {(["recent", "name"] as const).map((v) => (
              <option key={v} value={v}>
                {t(`projects.picker.sort.${v}`)}
              </option>
            ))}
          </select>
          <Seg<RuntimeFilter> value={q.runtime} onChange={(runtime) => set({ runtime })} options={(["all", "codex", "claude"] as const).map((r) => ({ value: r, label: t(`agents.runtime.${r}`) }))} />
        </div>
        <div ref={listRef} role="listbox" aria-multiselectable={mode === "add"} aria-label={title} className="min-h-0 flex-1 overflow-y-auto">
          {noMembers ? (
            <div className="px-4 py-10 text-center text-sm text-subtle">
              <p>{t("projects.picker.noMembers")}</p>
              <button onClick={onAddFirst} className="mt-2 text-accent hover:underline">
                {t("projects.picker.addFirst")} →
              </button>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-subtle">{t(all.length === 0 ? "projects.picker.empty" : "projects.picker.noMatch")}</p>
          ) : (
            rows.map((c) => <PickRow key={c.row.id} c={c} mode={mode} checked={selected.has(c.row.id)} last={lastOf(c.row)} profileModels={profileModels} onToggle={() => toggle(c.row.id)} onConfirm={(pick) => void confirm(pick)} onMove={move} />)
          )}
        </div>
        {failedLines.length > 0 && (
          <div className="max-h-24 overflow-y-auto border-t border-border bg-danger/10 px-4 py-2 text-xs text-danger">
            {failedLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
        <footer className="flex items-center gap-2 border-t border-border px-4 py-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {chosen.length > 0 && mode === "add" ? t("projects.picker.selected", { count: chosen.length }) : t(mode === "add" ? "projects.picker.addHint" : "projects.picker.directorHint")}
            {mode === "director" && directorId && onRotate && (
              <>
                {" · "}
                <button onClick={onRotate} className="text-accent hover:underline">
                  {t("projects.picker.rotateInstead")}
                </button>
              </>
            )}
          </span>
          <button onClick={onClose} className="rounded-md px-3 py-1 text-xs text-muted hover:bg-surface-2 hover:text-foreground">
            {t("projects.picker.cancel")}
          </button>
          <button disabled={chosen.length === 0 || busy} onClick={() => void confirm()} className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-40">
            {mode === "add" ? t("projects.picker.add", { count: chosen.length }) : t("projects.picker.confirmDirector")}
          </button>
        </footer>
      </div>
    </div>
  );
}
