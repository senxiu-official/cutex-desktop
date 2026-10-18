// A font picker you can type into (owner 2026-10-18, option A in /settings-variants.html): one line, no
// separate 「自定义…」. Focus or ▾ opens the list (default first, then the known fonts, not-installed ones
// tagged); typing filters it, and a name that is not listed can be used as typed. While nothing is typed
// the list ends with a muted, non-selectable line saying so (owner: 「加一个不可选的输入以自定义」).
import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../i18n";
import { FIELD_W } from "../../lib/fieldWidths";

type Item = { value: string; label: string; note?: string };

export function FontCombo({ value, fonts, defaultLabel, installed, onChange, label }: { value: string; fonts: readonly string[]; defaultLabel: string; installed?: (font: string) => boolean; onChange(v: string): void; label?: string }) {
  const { t } = useI18n();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = not typing: show the current value
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const shown = value === "" ? defaultLabel : value;
  const items = useMemo<Item[]>(() => {
    const q = (query ?? "").trim().toLowerCase();
    const list: Item[] = [{ value: "", label: defaultLabel }, ...fonts.map((f) => ({ value: f, label: f, note: installed && !installed(f) ? t("appearance.notInstalled") : undefined }))];
    const hits = q ? list.filter((i) => i.label.toLowerCase().includes(q)) : list;
    const typed = (query ?? "").trim();
    if (typed && !list.some((i) => i.label.toLowerCase() === typed.toLowerCase())) hits.push({ value: typed, label: typed, note: t("appearance.fontCombo.useTyped") });
    return hits;
  }, [query, fonts, defaultLabel, installed, t]);
  const pick = (i: Item | undefined) => {
    if (i) onChange(i.value);
    setQuery(null);
    setOpen(false);
    input.current?.blur();
  };
  return (
    <div className={`relative ${FIELD_W.generic}`}>
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        spellCheck={false}
        value={query ?? shown}
        title={shown}
        onFocus={(e) => {
          setOpen(true);
          setActive(0);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => {
          setQuery(null);
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setQuery(null);
            setOpen(false);
          }
        }}
        className="w-full truncate rounded-md border border-border bg-background py-1 pr-7 pl-2 text-sm outline-none focus:border-accent"
      />
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-subtle" />
      {open && (
        <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-raised py-1 text-sm shadow-lg">
          {items.map((i, n) => (
            <li
              key={`${i.value}|${i.note ?? ""}`}
              role="option"
              aria-selected={i.value === value}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus until picked
                pick(i);
              }}
              onMouseEnter={() => setActive(n)}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1 ${n === active ? "bg-hover" : ""} ${i.value === value ? "font-medium" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
              {i.note && <span className="shrink-0 text-[11px] text-subtle">{i.note}</span>}
            </li>
          ))}
          {!(query ?? "").trim() && (
            <li role="presentation" aria-disabled className="sticky bottom-0 -mb-1 mt-1 cursor-default border-t border-border/60 bg-raised px-2 pt-1.5 pb-1.5 text-[11px] text-subtle select-none">
              {t("appearance.fontCombo.typeHint")}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
