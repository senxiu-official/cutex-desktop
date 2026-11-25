import { Fragment, memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { Check, ChevronDown } from "lucide-react";
import { isImeComposing } from "../lib/ime";
import { Popover } from "./Menu";
import { SettingsGroup } from "./settings/Form";
import { EntityIcon, EntityMention } from "./EntityIcon";
import { entityIconSlot, type EntityRef } from "../lib/entityIcon";
import { useProjectIcons } from "../lib/projectIconSync";
import { useStaggeredCount } from "../lib/useStagger";

/** `detail`: a quiet second text at the row's end (e.g. an agent's project in the 当前与最近 group).
 * `hiddenUntilSearch`: listed only once something is typed (quick chats in agent pickers).
 * `entity`: the agent / project / Profile the row names, drawn as its icon before the label (and in the trigger).
 * `groupEntity`: what the group names (a project), its icon before the group's header. */
export type SearchablePickerOption = { value: string; label: string; group: string; searchText?: string; disabled?: boolean; detail?: string; hiddenUntilSearch?: boolean; entity?: EntityRef | null; groupEntity?: EntityRef | null };
const searchable = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
const FIELD = "rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

/** Content only: the enclosing Popover or MenuFlyout owns positioning (and, without `onDismiss`, dismissal).
 * WAI-ARIA: the search field is an editable combobox (it keeps focus: aria-activedescendant names the active
 * option) over a listbox of options, grouped under their headers; a select's trigger (EntitySelect,
 * SearchableSelect) is a combobox whose popup is this listbox (`listboxId`). */
export function SearchablePickerBody({ options, onPick, placeholder, emptyLabel, label, hiddenNote, current, onDismiss, listboxId }: {
  options: readonly SearchablePickerOption[]; onPick(value: string): void;
  placeholder: string; emptyLabel: string; label?: string;
  /** The chosen value (a select's): it starts active, scrolled into view, carries a check and aria-selected. */
  current?: string;
  /** Shown under the list while `hiddenUntilSearch` rows are hidden (gets their count). */
  hiddenNote?: (count: number) => string;
  /** Escape closes this popup only (a Popover's `dismiss`): the key stops here, so a surrounding dialog or form
   *  keeps it. Without it (a context-menu flyout) Escape goes on to the menu, which closes its own level. */
  onDismiss?(): void;
  /** The listbox's id, for the trigger's aria-controls. */
  listboxId?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(() => current !== undefined && options.some(option => option.value === current && !option.disabled) ? current : null);
  const input = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const composing = useRef(false);
  const id = useId();
  const listId = listboxId ?? `${id}-options`;
  const filtered = useMemo(() => {
    const term = searchable(query.trim());
    return term ? options.filter(option => searchable(`${option.label}\n${option.group}\n${option.searchText ?? ""}`).includes(term)) : options.filter(option => !option.hiddenUntilSearch);
  }, [options, query]);
  const hidden = query.trim() ? 0 : options.filter(option => option.hiddenUntilSearch).length;
  const enabled = filtered.filter(option => !option.disabled);
  const selected = enabled.find(option => option.value === active);
  const itemId = (value: string) => `${id}-${encodeURIComponent(value)}`;
  useEffect(() => {
    if (current !== undefined) rows.current.get(current)?.scrollIntoView?.({ block: "nearest" });
    // On open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // One icon slot for every row (the widest project text icon), so the labels line up (components/EntityIcon).
  const projectIcons = useProjectIcons();
  const iconSlot = useMemo(() => options.some(option => option.entity) ? entityIconSlot(options.map(option => option.entity), projectIcons) : 0, [options, projectIcons]);
  // Icons past the first rows mount a chunk per frame (lib/useStagger).
  const iconRows = useStaggeredCount(filtered.length, !!iconSlot);
  // Consecutive options sharing a group: one listbox group under its header.
  const runs = useMemo(() => {
    const out: { group: string; groupEntity: EntityRef | null; start: number; options: SearchablePickerOption[] }[] = [];
    filtered.forEach((option, index) => {
      const last = out.at(-1);
      if (last && last.group === option.group) last.options.push(option);
      else out.push({ group: option.group, groupEntity: option.groupEntity ?? null, start: index, options: [option] });
    });
    return out;
  }, [filtered]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (!onDismiss || composing.current || isImeComposing(event)) return;
      // Only the popup closes: not the dialog around it (preventDefault also keeps a native <dialog>'s cancel).
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    event.stopPropagation();
    if (composing.current || isImeComposing(event)) return;
    const inSearch = event.target === input.current;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!enabled.length) return;
      const at = enabled.findIndex(option => option.value === active);
      const next = enabled[event.key === "ArrowDown" ? (at + 1) % enabled.length : (at <= 0 ? enabled.length : at) - 1]!;
      setActive(next.value);
      const row = rows.current.get(next.value);
      if (!inSearch) row?.focus();
      row?.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = selected ?? enabled[0];
      if (option) onPick(option.value);
    } else if (!inSearch && !event.ctrlKey && !event.metaKey && !event.altKey && Array.from(event.key).length === 1) {
      event.preventDefault();
      setQuery(previous => previous + event.key);
      setActive(null);
      input.current?.focus();
    }
  };

  return <div role="group" aria-label={label} className="flex min-h-0 max-h-[calc(100dvh-48px)] flex-col" onKeyDown={onKeyDown}>
    <div className="sticky top-0 z-10 shrink-0 bg-surface p-1">
      <SettingsGroup navigation agents="none" source="local"><input ref={input} autoFocus data-menu-search="" type="search" aria-label={label ?? placeholder} placeholder={placeholder}
        role="combobox" aria-expanded aria-autocomplete="list" aria-controls={listId} aria-activedescendant={selected ? itemId(selected.value) : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(null); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        className={`w-full ${FIELD}`} /></SettingsGroup>
    </div>
    <div className="min-h-0 max-h-[min(24rem,calc(100dvh-8rem))] overflow-y-auto overscroll-contain">
      {!filtered.length && !(hiddenNote && hidden) && <p role="status" className="px-2.5 py-2 text-sm text-subtle">{emptyLabel}</p>}
      <div role="listbox" id={listId} aria-label={label ?? placeholder}>
        {runs.map(run => {
          const items = run.options.map((option, i) => <PickerRow key={option.value} option={option} id={itemId(option.value)} rows={rows} active={selected?.value === option.value}
            iconSlot={iconSlot} showIcon={run.start + i < iconRows} chosen={current !== undefined ? option.value === current : null} onActive={setActive} onPick={onPick} />);
          if (!run.group) return <Fragment key={`run:${run.start}`}>{items}</Fragment>;
          const header = `${id}-group-${run.start}`;
          return <div key={`run:${run.start}`} role="group" aria-labelledby={header}>
            <div id={header} role="presentation" className="px-2.5 pt-2 pb-1 text-xs text-subtle">{run.groupEntity ? <EntityMention entity={run.groupEntity}>{run.group}</EntityMention> : run.group}</div>
            {items}
          </div>;
        })}
      </div>
      {hiddenNote && hidden > 0 && <p role="note" data-picker-hidden="" className="px-2.5 py-2 text-xs text-subtle">{hiddenNote(hidden)}</p>}
    </div>
  </div>;
}

/** One option row. Memoised: its props are stable while other rows change (icons mounting, the active row moving). */
const PickerRow = memo(function PickerRow({ option, id, rows, active, chosen, iconSlot, showIcon, onActive, onPick }: {
  option: SearchablePickerOption; id: string; rows: MutableRefObject<Map<string, HTMLButtonElement>>;
  /** The keyboard-active option (the search field's aria-activedescendant). */
  active: boolean;
  /** A select's list: whether this is its current value (a check, aria-selected); null = no current value
   *  (an add / jump picker), where the active option is the selected one. */
  chosen: boolean | null;
  /** 0 = no option of the list has an icon. */
  iconSlot: number; showIcon: boolean; onActive(value: string): void; onPick(value: string): void;
}) {
  const check = chosen ? <Check size={14} className="shrink-0 text-accent" aria-hidden /> : null;
  return <button type="button" role="option" id={id} data-value={option.value} disabled={option.disabled} aria-disabled={option.disabled || undefined}
    aria-selected={chosen ?? active}
    ref={node => { if (node) rows.current.set(option.value, node); else rows.current.delete(option.value); }}
    onFocus={() => onActive(option.value)}
    onClick={() => { if (!option.disabled) onPick(option.value); }}
    className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-surface-2 focus:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent ${active ? "bg-surface-2" : ""}`}>
    {iconSlot
      ? <span className="flex min-w-0 items-center gap-2">{option.entity && showIcon ? <EntityIcon entity={option.entity} slot={iconSlot} /> : <span className="shrink-0" style={{ width: iconSlot, height: 16 }} aria-hidden />}<span className="min-w-0 flex-1 truncate">{option.label}</span>{option.detail && <span className="max-w-[45%] shrink-0 truncate text-xs text-subtle">{option.detail}</span>}{check}</span>
      : option.detail || check
      ? <span className="flex min-w-0 items-baseline gap-2"><span className="min-w-0 flex-1 truncate">{option.label}</span>{option.detail && <span className="max-w-[45%] shrink-0 truncate text-xs text-subtle">{option.detail}</span>}{check}</span>
      : <span className="block truncate">{option.label}</span>}
  </button>;
});

export function SearchableSelect({ value, options, onChange, placeholder, emptyLabel, label, disabled, width = "w-56", triggerText, triggerClassName, hiddenNote }: {
  value: string; options: readonly SearchablePickerOption[]; onChange(value: string): void;
  placeholder: string; emptyLabel: string; label: string; disabled?: boolean; width?: string;
  triggerText?: string; triggerClassName?: string; hiddenNote?: (count: number) => string;
}) {
  const selected = options.find(option => option.value === value);
  const text = selected?.label ?? triggerText ?? placeholder;
  const listboxId = useId();
  return <Popover disabled={disabled} triggerLabel={label} triggerTitle={text} width={width}
    triggerProps={{ role: "combobox", "aria-haspopup": "listbox", "aria-controls": listboxId }}
    triggerClassName={triggerClassName ?? `flex items-center justify-between gap-2 ${width} ${FIELD}`}
    trigger={<><span className="inline-flex min-w-0 items-center gap-1.5 align-middle">{selected?.entity && <EntityIcon entity={selected.entity} />}<span className="min-w-0 truncate">{text}</span></span><ChevronDown size={14} className="shrink-0 text-subtle" /></>}>
    {(_close, dismiss) => <SearchablePickerBody options={options} placeholder={placeholder} emptyLabel={emptyLabel} label={label} listboxId={listboxId}
      hiddenNote={hiddenNote} onDismiss={dismiss} onPick={next => { onChange(next); dismiss(); }} />}
  </Popover>;
}
