// A select that names projects, agents or Profiles with their icon (owner 2026-11-24/25: the icon shows wherever one is
// named; a native <select> cannot draw it). It keeps a select's behaviour: one value, a trigger showing it, and on the
// closed trigger ↑ / ↓ / Home / End step through the enabled options and typing picks by the first letters, as on a
// native select; Enter / Space / Alt+↓ / F4 open the searchable list (components/SearchablePicker: the current value
// starts active with a check, ↑ / ↓ move, Enter picks, Escape closes). Long lists stagger their icons there.
import { useId, useMemo, useRef, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../i18n";
import { isImeComposing } from "../lib/ime";
import { Popover } from "./Menu";
import { EntityIcon } from "./EntityIcon";
import { SearchablePickerBody, type SearchablePickerOption } from "./SearchablePicker";
import type { EntitySelectOption } from "../lib/entityIcon";

const FIELD = "rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";
/** Typed letters within this window count as one prefix (a native select's type-ahead). */
const TYPE_AHEAD_MS = 800;

export function EntitySelect({ value, options, onChange, label, labelledBy, describedBy, disabled, width = "w-56", className, autoFocus, testId, placeholder, popoverWidth }: {
  value: string; options: readonly EntitySelectOption[]; onChange(value: string, trigger: HTMLButtonElement | null): void;
  /** The accessible name (a select's aria-label); or `labelledBy`, the id of a row label. */
  label?: string; labelledBy?: string; describedBy?: string;
  disabled?: boolean;
  /** Width token of the trigger (FIELD_W in settings/Form). */
  width?: string;
  /** Replaces the trigger's field style (width included). */
  className?: string;
  autoFocus?: boolean; testId?: string;
  /** Trigger text while the value matches no option. */
  placeholder?: string;
  popoverWidth?: string;
}) {
  const { t } = useI18n();
  const wrap = useRef<HTMLSpanElement>(null);
  const triggerNode = () => wrap.current?.querySelector<HTMLButtonElement>("button[data-entity-select]") ?? null;
  const typed = useRef({ text: "", at: 0 });
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const text = selected?.label ?? placeholder ?? "";
  const pickerOptions = useMemo<SearchablePickerOption[]>(() => options.map((option) => ({ value: option.value, label: option.label, group: option.group ?? "", disabled: option.disabled, entity: option.entity ?? null, searchText: option.searchText })), [options]);
  const pick = (next: string) => { if (next !== value) onChange(next, triggerNode()); };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.currentTarget.getAttribute("aria-expanded") === "true" || isImeComposing(event) || event.ctrlKey || event.metaKey) return;
    const enabled = options.filter((option) => !option.disabled);
    if (!enabled.length) return;
    const at = enabled.findIndex((option) => option.value === value);
    let next: EntitySelectOption | undefined;
    if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp") || event.key === "F4") {
      event.preventDefault();
      event.currentTarget.click();
      return;
    }
    if (event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = enabled[Math.min(at + 1, enabled.length - 1)];
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = enabled[Math.max(at - 1, 0)];
    else if (event.key === "Home" || event.key === "PageUp") next = enabled[0];
    else if (event.key === "End" || event.key === "PageDown") next = enabled[enabled.length - 1];
    else if (Array.from(event.key).length === 1 && event.key !== " ") {
      const now = Date.now();
      const prefix = (now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text : "") + event.key.toLocaleLowerCase();
      typed.current = { text: prefix, at: now };
      // A repeated single letter cycles through the options starting with it (native behaviour).
      const cycling = [...prefix].every((ch) => ch === prefix[0]);
      const term = cycling ? prefix[0]! : prefix;
      const from = cycling ? at + 1 : Math.max(at, 0);
      next = [...enabled.slice(from), ...enabled.slice(0, from)].find((option) => option.label.toLocaleLowerCase().startsWith(term));
    } else return;
    event.preventDefault();
    if (next) pick(next.value);
  };

  // display: contents — the wrapper only finds the trigger (Popover owns the button).
  return <span ref={wrap} className="contents"><Popover disabled={disabled} triggerTitle={text} width={popoverWidth ?? "w-64"}
    triggerProps={{
      // A select-only combobox: its name is the field's label, its value the chosen option's text (the content).
      role: "combobox", "aria-label": label, "aria-labelledby": label ? undefined : labelledBy, "aria-describedby": describedBy, "aria-haspopup": "listbox", "aria-controls": listboxId,
      autoFocus, onKeyDown, "data-entity-select": "", "data-testid": testId, "data-value": value,
    }}
    triggerClassName={className ?? `flex items-center justify-between gap-2 ${width} ${FIELD}`}
    trigger={<><span className="inline-flex min-w-0 items-center gap-1.5 align-middle">{selected?.entity && <EntityIcon entity={selected.entity} />}<span className="min-w-0 truncate">{text}</span></span><ChevronDown size={14} className="shrink-0 text-subtle" /></>}>
    {(_close, dismiss) => <SearchablePickerBody options={pickerOptions} current={value} label={label} listboxId={listboxId} placeholder={t("entitySelect.search")} emptyLabel={t("entitySelect.empty")}
      onDismiss={dismiss} onPick={(next) => { dismiss(); pick(next); }} />}
  </Popover></span>;
}
