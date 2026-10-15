// Searchable agent picker in the browser card header (replaces a plain <select>): type to filter by
// name / project, ↑ ↓ Enter Esc, the current conversation's agent and recent grants on top, the rest
// grouped by project. Picking only selects (same as the old <select>); the hand button grants.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { BrowserAgentView } from "../../../../shared/browser";
import { useI18n } from "../../i18n";
import { useTrackOverlay } from "../../lib/openOverlays";
import { sidebarOf, useApp } from "../../store";
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { pickerGroups, recentGrants, type PickerAgent } from "./agentPicker";

interface Props {
  hostId: string;
  agents: BrowserAgentView[];
  selected: string;
  onSelect(sessionId: string): void;
  /** Opening the list (re)reads the agents, like focusing the old <select>. */
  onOpen(): void;
  disabled: boolean;
  loading: boolean;
  placeholder: string;
}

const WIDTH = 288;

export function BrowserAgentPicker({ hostId, agents, selected, onSelect, onOpen, disabled, loading, placeholder }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  useTrackOverlay(open);
  const sidebar = useApp(s => sidebarOf(s, hostId));
  const current = useApp(s => ((s.selectedHost ?? s.hosts?.active ?? LOCAL_HOST_ID) === hostId ? s.selectedId : null));
  const recent = useMemo(() => (open ? recentGrants(hostId) : []), [open, hostId]);
  const rows: PickerAgent[] = useMemo(() => agents.map(agent => {
    const row = sidebar?.hostRows?.[agent.sessionId];
    const projectId = row?.projectId ?? null;
    const summary = projectId ? sidebar?.projects?.projects.find(project => project.project_id === projectId) : undefined;
    return { ...agent, projectId, projectName: projectId ? (row?.projectName || summary?.presentation.display_name || projectId) : null };
  }), [agents, sidebar]);
  const groups = useMemo(() => pickerGroups(rows, { query, current, recent }), [rows, query, current, recent]);
  const flat = useMemo(() => groups.flatMap(group => group.agents), [groups]);
  const chosen = agents.find(agent => agent.sessionId === selected);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8));
    const below = window.innerHeight - rect.bottom - 12;
    setPlace({ top: rect.bottom + 4, left, maxHeight: Math.max(160, Math.min(420, below)) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onResize);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("resize", onResize); window.removeEventListener("blur", onResize); };
  }, [open]);
  useEffect(() => {
    list.current?.querySelector(`[data-picker-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  function show(): void {
    if (disabled) return;
    setQuery(""); setCursor(0); setOpen(true); onOpen();
  }
  function pick(agent: PickerAgent | undefined): void {
    if (!agent) return;
    onSelect(agent.sessionId); setOpen(false); trigger.current?.focus();
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return;
    const n = flat.length;
    if (event.key === "ArrowDown") { if (n) setCursor(c => (c + 1) % n); }
    else if (event.key === "ArrowUp") { if (n) setCursor(c => (c - 1 + n) % n); }
    else if (event.key === "Enter") pick(flat[cursor]);
    else if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  const groupLabel = (kind: string, label: string | null) => kind === "top" ? t("browser.owner.pickerSuggested") : kind === "independent" ? t("browser.owner.pickerIndependent") : label;
  let index = 0;
  return <>
    <button ref={trigger} type="button" data-browser-agent-select aria-label={t("browser.owner.select")} title={chosen?.name ?? t("browser.owner.select")}
      aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => (open ? setOpen(false) : show())}
      onKeyDown={event => { if ((event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") && !open) { event.preventDefault(); show(); } }}
      className="flex max-w-36 min-w-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground enabled:hover:bg-hover disabled:opacity-40">
      <span className={`truncate ${chosen ? "" : "text-subtle"}`}>{chosen?.name ?? placeholder}</span>
      <ChevronDown size={11} className="shrink-0 text-subtle" />
    </button>
    {open && place && (
      <div ref={panel} data-browser-agent-picker className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        style={{ top: place.top, left: place.left, width: WIDTH, maxHeight: place.maxHeight }}>
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-1.5">
          <Search size={12} className="shrink-0 text-subtle" />
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKey} spellCheck={false} autoComplete="off"
            role="combobox" aria-expanded aria-controls="browser-agent-picker-list" aria-activedescendant={flat[cursor] ? `browser-agent-option-${cursor}` : undefined}
            placeholder={t("browser.owner.pickerSearch")} aria-label={t("browser.owner.pickerSearch")}
            className="h-6 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-subtle" />
        </div>
        <div ref={list} id="browser-agent-picker-list" role="listbox" aria-label={t("browser.owner.select")} className="min-h-0 flex-1 overflow-y-auto p-1">
          {!flat.length && <p className="px-2.5 py-2 text-xs text-subtle">{t(agents.length ? "browser.owner.pickerNoMatch" : loading ? "browser.owner.loadingAgents" : "browser.owner.noAgents")}</p>}
          {groups.map(group => <div key={group.key} role="group" aria-label={groupLabel(group.kind, group.label) ?? undefined}>
            <div className="truncate px-2.5 pt-1.5 pb-0.5 text-[11px] text-subtle">{groupLabel(group.kind, group.label)}</div>
            {group.agents.map(agent => {
              const i = index++;
              return <div key={agent.sessionId} id={`browser-agent-option-${i}`} data-picker-index={i} role="option" aria-selected={agent.sessionId === selected}
                onMouseEnter={() => setCursor(i)} onMouseDown={event => event.preventDefault()} onClick={() => pick(agent)}
                className={`flex cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ${i === cursor ? "bg-surface-2" : ""}`}>
                <span className="min-w-0 flex-1 truncate text-foreground" title={agent.name}>{agent.name}</span>
                {agent.sessionId === current && <span className="shrink-0 text-[11px] text-subtle">{t("browser.owner.pickerCurrent")}</span>}
                {group.kind === "top" && agent.projectName && <span className="max-w-24 shrink-0 truncate text-[11px] text-subtle">{agent.projectName}</span>}
                <span className="w-3 shrink-0 text-accent">{agent.sessionId === selected && <Check size={12} />}</span>
              </div>;
            })}
          </div>)}
        </div>
      </div>
    )}
  </>;
}
