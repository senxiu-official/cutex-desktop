// The ⌘K palette (prototype: .claude/preview-shelves.html scenario D): a centered panel over everything —
// search field, scope chips (Tab cycles), sections of results with host chips, the selected row's open
// hints, a key legend. Keys are caught on the window in the capture phase while it is open, so no pane
// hears ↑ ↓ Enter Tab Esc meanwhile; typing goes to the field.
import type { SessionAvatar } from "@cutex-desktop/protocol";
import { Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { preloadOnIntent } from "../../lib/lazyPage";
import { Avatar } from "../../components/Avatar";
import { HostDot } from "../../components/HostMark";
import { startWorkspaceDrag } from "../../lib/workspaces";
import { useI18n, type MessageKey } from "../../i18n";
import { displayKey } from "../../lib/shortcuts";
import { useBindingLabel } from "../../lib/useKeybindings";
import { foretellAfterDelay, setForetell, type Foretell } from "../../lib/foretell";
import { besideAction, flatRows, workspaceRefOf, moveSelection, nextScope, paletteKey, rankItems, SCOPES, type BesideAction, type QsItem, type QsLead, type QsRow, type QsScope, type QsScreen, type RecentEntry } from "./model";
import { usePaletteItems } from "./useItems";

const LEAD_TONE: Record<string, string> = {
  service: "bg-accent/15 text-accent",
  artifact: "bg-ok/15 text-ok-text",
  page: "bg-surface-2 text-muted",
  shelf: "bg-surface-2 text-muted",
};
const BADGE_TONE = {
  attention: "rounded-full bg-warn/15 px-1.5 text-warn-text font-medium",
  accent: "text-accent",
  danger: "text-danger",
  muted: "text-subtle",
} as const;

function Kbd({ children }: { children: ReactNode }) {
  return <span className="mr-1 inline-block rounded border border-border px-1 font-mono text-caption/[inherit] leading-[15px] text-subtle">{children}</span>;
}

function Lead({ lead }: { lead?: QsLead }) {
  if (!lead) return <span className="size-[26px] shrink-0" />;
  if (lead.kind === "avatar") return <Avatar name={lead.name} color={lead.color} avatar={(lead.avatar as SessionAvatar | null | undefined) ?? null} seed={lead.seed} initial={lead.initial ?? null} size={28} />;
  if (lead.kind === "named") return <Avatar name={lead.name} size={28} />;
  const Icon = lead.icon;
  return (
    <span className={`flex size-[26px] shrink-0 items-center justify-center rounded-lg ${LEAD_TONE[lead.tone ?? "page"] ?? LEAD_TONE.page}`}>
      <Icon size={14} />
    </span>
  );
}

function Highlight({ text, ranges }: { text: string; ranges: readonly [number, number][] }) {
  if (!ranges.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push(text.slice(at, a));
    out.push(
      <mark key={a} className="bg-transparent font-semibold text-accent">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

const SECTION_KEY: Record<string, MessageKey> = {
  recent: "quick-switch.section.recent",
  agent: "quick-switch.scope.agent",
  service: "quick-switch.scope.service",
  artifact: "quick-switch.scope.artifact",
  page: "quick-switch.scope.page",
  shelfPage: "quick-switch.scope.shelfPage",
};

/** What ↵ does (model.ts planOpen): a service of a host the Shelf does not show opens in the system browser. */
function hereKey(item: QsItem, showsHost: (hostId: string) => boolean): MessageKey {
  switch (item.target.kind) {
    case "agent":
      return "quick-switch.row.replace";
    case "page":
      return "quick-switch.row.here";
    case "run":
      return "quick-switch.row.run";
    case "shelfPage":
      return "quick-switch.row.jump";
    case "service":
      return showsHost(item.target.hostId) ? "quick-switch.row.inShelf" : "quick-switch.row.inBrowser";
    default:
      return "quick-switch.row.inShelf";
  }
}

/** What Ctrl/⌘+↵ does (model.ts besideAction): the row's hint and the key legend's. */
const BESIDE_ROW: Record<BesideAction, MessageKey> = {
  sideBySide: "quick-switch.row.sideBySide",
  otherShelf: "quick-switch.row.otherShelf",
  newPage: "quick-switch.row.newPage",
  otherWorkspace: "quick-switch.row.otherWorkspace",
};
const BESIDE_LEGEND: Record<BesideAction, MessageKey> = {
  sideBySide: "quick-switch.hint.sideBySide",
  otherShelf: "quick-switch.hint.otherShelf",
  newPage: "quick-switch.hint.newPage",
  otherWorkspace: "quick-switch.hint.otherWorkspace",
};

export function Palette({
  recent,
  mac,
  screen = { workspaces: 1, otherHostId: null },
  showsHost = () => true,
  onClose,
  onOpen,
  onDragOut,
  foretellOf,
  view = window,
}: {
  recent: readonly RecentEntry[];
  mac: boolean;
  /** The workspaces on screen when it opened (Ctrl/⌘+↵ depends on them). */
  screen?: QsScreen;
  /** lib/sideServices sideShowsHost: the Shelf shows this host's panes. */
  showsHost?(hostId: string): boolean;
  onClose(): void;
  onOpen(item: QsItem, beside: boolean): void;
  onDragOut?(): void;
  /**
   * The selected row's preview (docs/design/008-foretell.md; `beside`: Ctrl/⌘ held and the row has a beside) —
   * computed by live.ts from the same effect its open runs. Absent / null: no preview.
   */
  foretellOf?(item: QsItem, beside: boolean): Foretell | null;
  /** The window it shows in (a desk window, multi-window): its keys are that window's. */
  view?: Window;
}) {
  const { t } = useI18n();
  const data = usePaletteItems();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<QsScope>("all");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scopes = useMemo(() => SCOPES.filter((s) => s !== "shelfPage" || data.shelves), [data.shelves]);

  const sections = useMemo(() => rankItems(data.items, { query, scope, recent }), [data.items, query, scope, recent]);
  const rows = useMemo(() => flatRows(sections), [sections]);
  const index = rows.length ? Math.min(sel, rows.length - 1) : 0;
  const selected: QsRow | undefined = rows[index];

  const besideOf = (item: QsItem) => (item.disabled ? null : besideAction(item.target, screen, showsHost));
  const selectedBeside = selected ? besideOf(selected.item) : null;

  // The latest values for the window key handler (registered once).
  const live = useRef({ rows, index, scope, scopes, selected, selectedBeside });
  live.current = { rows, index, scope, scopes, selected, selectedBeside };

  // The selected row's foretell, after the delay (keyboard or mouse selection); Ctrl/⌘ held = its beside one.
  // Pages and panes ⌘K can open load in idle time while it is up (lib/lazyPage).
  useEffect(() => void preloadOnIntent(), []);
  const owner = useRef<object>({}).current;
  const [modHeld, setModHeld] = useState(false);
  useEffect(() => {
    const onMod = (e: KeyboardEvent) => setModHeld(mac ? e.metaKey : e.ctrlKey);
    view.addEventListener("keydown", onMod, true);
    view.addEventListener("keyup", onMod, true);
    return () => {
      view.removeEventListener("keydown", onMod, true);
      view.removeEventListener("keyup", onMod, true);
    };
  }, [mac, view]);
  const foretellItem = selected && !selected.item.disabled ? selected.item : null;
  const foretellBeside = modHeld && selectedBeside !== null;
  useEffect(() => {
    if (!foretellOf || !foretellItem) return void setForetell(owner, null);
    return foretellAfterDelay(owner, foretellOf(foretellItem, foretellBeside), view === window ? null : view.document);
  }, [foretellOf, foretellItem, foretellBeside, owner, view]);
  // Gone with the palette.
  useEffect(() => () => setForetell(owner, null), [owner]);

  useLayoutEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.querySelector("[data-qs-selected]")?.scrollIntoView({ block: "nearest" });
  }, [index, sections]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = paletteKey(e, mac);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      const { rows, index, scope, scopes, selected, selectedBeside } = live.current;
      switch (action.type) {
        case "close":
          return onClose();
        case "move":
          return setSel(Math.abs(action.delta) > 1 ? Math.max(0, Math.min(rows.length - 1, index + action.delta)) : moveSelection(index, action.delta, rows.length));
        case "scope": {
          let next = nextScope(scope, action.back);
          while (!scopes.includes(next)) next = nextScope(next, action.back);
          setScope(next);
          setSel(0);
          inputRef.current?.focus();
          return;
        }
        case "open":
          if (selected) onOpen(selected.item, action.beside && selectedBeside !== null);
          return;
      }
    };
    view.addEventListener("keydown", onKey, true);
    return () => view.removeEventListener("keydown", onKey, true);
  }, [mac, onClose, onOpen, view]);

  const mod = displayKey("Ctrl+", mac).replace(/\+$/, "");
  const switchKey = useBindingLabel("quickSwitch");
  const empty = query.trim() ? (
    <div className="px-4 py-9 text-center text-ui/[inherit] text-subtle">
      {t("quick-switch.empty", { q: query.trim() })}
      <div className="mt-1 text-xs">{t("quick-switch.emptyHint")}</div>
    </div>
  ) : (
    <div className="px-4 py-9 text-center text-ui/[inherit] text-subtle">{scope === "artifact" && data.loadingArtifacts ? t("quick-switch.loading") : t("quick-switch.nothing")}</div>
  );

  let at = -1;
  return (
    <div className="fixed inset-0 z-[153] flex items-start justify-center bg-black/20 pt-[92px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-quick-switch-backdrop="">
      <div role="dialog" aria-modal aria-label={t("quick-switch.label")} className="float flex max-h-[calc(100vh-130px)] w-[640px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden">
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border pr-3.5 pl-4">
          <Search size={18} className="shrink-0 text-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            placeholder={t("quick-switch.placeholder")}
            aria-label={t("quick-switch.placeholder")}
            aria-activedescendant={selected ? `qs-row-${index}` : undefined}
            aria-controls="qs-results"
            role="combobox"
            aria-expanded
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-title/[inherit] text-foreground outline-none placeholder:text-subtle"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1 px-3.5 pt-2 pb-0.5" role="tablist">
          {scopes.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={s === scope}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setScope(s);
                setSel(0);
              }}
              className={`rounded-full border px-[9px] py-0.5 text-meta/[inherit] ${s === scope ? "border-foreground bg-foreground text-background" : "border-border text-muted hover:bg-hover"}`}
            >
              {t(s === "all" ? "quick-switch.scope.all" : SECTION_KEY[s]!)}
            </button>
          ))}
        </div>
        <div ref={listRef} id="qs-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
          {rows.length === 0
            ? empty
            : sections.map((section) => (
                <div key={section.id} role="group" aria-label={t(SECTION_KEY[section.id]!)}>
                  <div className="flex items-center gap-1.5 px-2 pt-2.5 pb-1 text-meta/[inherit] text-subtle">
                    {t(SECTION_KEY[section.id]!)}
                    {section.id === "artifact" && data.loadingArtifacts && <span>· {t("quick-switch.loading")}</span>}
                    {(query.trim() || scope !== "all") && section.id !== "recent" && <span className="ml-auto">{section.total}</span>}
                  </div>
                  {section.rows.map((row) => {
                    at++;
                    const i = at;
                    const on = i === index;
                    const item = row.item;
                    const look = data.hostLook(item.hostId);
                    const beside = on ? besideOf(item) : null;
                    return (
                      <div
                        key={item.id}
                        id={`qs-row-${i}`}
                        role="option"
                        aria-selected={on}
                        aria-disabled={item.disabled || undefined}
                        data-qs-selected={on ? "" : undefined}
                        onMouseMove={() => i !== index && setSel(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onPointerDown={(e) => {
                          // A row dragged out (§24.13): into a Shelf = project, an edge = side by side, a conversation = replace.
                          const ref = item.disabled ? null : workspaceRefOf(item);
                          if (ref) startWorkspaceDrag(ref, e, { onStart: onDragOut });
                        }}
                        onClick={(e) => onOpen(item, (mac ? e.metaKey : e.ctrlKey) && besideOf(item) !== null)}
                        className={`flex h-10 cursor-default items-center gap-2.5 rounded-ctl pr-2.5 pl-2 ${on ? "bg-surface-2" : ""} ${item.disabled ? "opacity-50" : ""}`}
                      >
                        <Lead lead={item.lead} />
                        <span className="max-w-[260px] min-w-0 shrink-0 truncate text-ui/[inherit] text-foreground">
                          <Highlight text={item.title} ranges={row.ranges} />
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-subtle">
                          <span className="min-w-0 truncate">{item.subtitle}</span>
                          {look && (
                            <span className="inline-flex shrink-0 items-center gap-1" title={look.label}>
                              · <HostDot color={look.color} status={look.indicator.status} size={7} />
                              {look.label}
                            </span>
                          )}
                        </span>
                        {on && !item.disabled ? (
                          <span className="flex shrink-0 items-center gap-2 text-meta/[inherit] text-subtle">
                            <span>
                              {t(hereKey(item, showsHost))} <Kbd>↵</Kbd>
                            </span>
                            {beside && (
                              <span>
                                {t(BESIDE_ROW[beside])} <Kbd>{mod} ↵</Kbd>
                              </span>
                            )}
                          </span>
                        ) : (
                          item.badge && <span className={`shrink-0 text-caption/[inherit] ${BADGE_TONE[item.badge.tone]}`}>{item.badge.text}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
        </div>
        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border bg-surface px-4 text-meta/[inherit] text-subtle">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t("quick-switch.hint.select")}
          </span>
          <span>
            <Kbd>↵</Kbd>
            {t("quick-switch.hint.replace")}
          </span>
          {selectedBeside && (
            <span>
              <Kbd>{mod} ↵</Kbd>
              {t(BESIDE_LEGEND[selectedBeside])}
            </span>
          )}
          <span>
            <Kbd>Tab</Kbd>
            {t("quick-switch.hint.scope")}
          </span>
          <span className="flex-1" />
          {switchKey && <span>{switchKey}</span>}
        </div>
      </div>
    </div>
  );
}
