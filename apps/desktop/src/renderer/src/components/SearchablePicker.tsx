import { Fragment, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { isImeComposing } from "../lib/ime";
import { Popover } from "./Menu";
import { SettingsGroup } from "./settings/Form";

export type SearchablePickerOption = { value: string; label: string; group: string; searchText?: string; disabled?: boolean };
const searchable = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
const FIELD = "rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

/** Content only: the enclosing Popover or MenuFlyout owns positioning and dismissal. */
export function SearchablePickerBody({ options, onPick, placeholder, emptyLabel, label }: {
  options: readonly SearchablePickerOption[]; onPick(value: string): void;
  placeholder: string; emptyLabel: string; label?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const composing = useRef(false);
  const id = useId();
  const filtered = useMemo(() => {
    const term = searchable(query.trim());
    return term ? options.filter(option => searchable(`${option.label}\n${option.group}\n${option.searchText ?? ""}`).includes(term)) : options;
  }, [options, query]);
  const enabled = filtered.filter(option => !option.disabled);
  const selected = enabled.find(option => option.value === active);
  const itemId = (value: string) => `${id}-${encodeURIComponent(value)}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") event.stopPropagation();
    if (composing.current || isImeComposing(event) || event.key === "Escape") return;
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
        aria-controls={`${id}-options`} aria-activedescendant={selected ? itemId(selected.value) : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(null); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        className={`w-full ${FIELD}`} /></SettingsGroup>
    </div>
    <div id={`${id}-options`} className="min-h-0 max-h-[min(24rem,calc(100dvh-8rem))] overflow-y-auto overscroll-contain">
      {!filtered.length && <p role="status" className="px-2.5 py-2 text-sm text-subtle">{emptyLabel}</p>}
      {filtered.map((option, index) => <Fragment key={option.value}>
        {(index === 0 || option.group !== filtered[index - 1]!.group) && option.group && <div className="px-2.5 pt-2 pb-1 text-xs text-subtle">{option.group}</div>}
        <button type="button" role="menuitem" id={itemId(option.value)} disabled={option.disabled}
          ref={node => { if (node) rows.current.set(option.value, node); else rows.current.delete(option.value); }}
          onFocus={() => setActive(option.value)}
          onClick={() => { if (!option.disabled) onPick(option.value); }}
          className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-surface-2 focus:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent ${selected?.value === option.value ? "bg-surface-2" : ""}`}>
          <span className="block truncate">{option.label}</span>
        </button>
      </Fragment>)}
    </div>
  </div>;
}

export function SearchableSelect({ value, options, onChange, placeholder, emptyLabel, label, disabled, width = "w-56", triggerText, triggerClassName }: {
  value: string; options: readonly SearchablePickerOption[]; onChange(value: string): void;
  placeholder: string; emptyLabel: string; label: string; disabled?: boolean; width?: string;
  triggerText?: string; triggerClassName?: string;
}) {
  const selected = options.find(option => option.value === value);
  const text = selected?.label ?? triggerText ?? placeholder;
  return <Popover disabled={disabled} triggerLabel={label} triggerTitle={text} width={width}
    triggerClassName={triggerClassName ?? `flex items-center justify-between gap-2 ${width} ${FIELD}`}
    trigger={<><span className="min-w-0 truncate">{text}</span><ChevronDown size={14} className="shrink-0 text-subtle" /></>}>
    {close => <SearchablePickerBody options={options} placeholder={placeholder} emptyLabel={emptyLabel} label={label}
      onPick={next => { onChange(next); close(); }} />}
  </Popover>;
}
