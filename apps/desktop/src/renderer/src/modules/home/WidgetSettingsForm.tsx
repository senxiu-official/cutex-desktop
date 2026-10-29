// The shell-rendered settings form of a desktop widget instance (design 032 §4.3): one row per schema field —
// text, number, toggle, select, time zone (a searchable list of the runtime's IANA zones), and lists of records.
// Every change is saved at once (the widget re-renders from the stored settings); invalid input is not saved.
import { useId, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "../../i18n";
import { Toggle } from "../../components/settings/Form";
import type { Json } from "../types";
import type { WidgetSettingField, WidgetSettings } from "../widgetTypes";
import { isTimeZone } from "./desk";

type Flat = Exclude<WidgetSettingField, { type: "list" }>;

function zones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

function FlatField({ field, value, onChange, compact = false }: { field: Flat; value: Json | undefined; onChange(v: Json): void; compact?: boolean }) {
  const { t } = useI18n();
  const list = useId();
  const all = useMemo(() => (field.type === "timezone" ? zones() : []), [field.type]);
  const [draft, setDraft] = useState<string | null>(null);
  const label = <span className={compact ? "sr-only" : "text-ui/[inherit]"}>{t(field.labelKey)}</span>;
  const input = "min-w-0 rounded-md border border-border bg-background px-2 py-1 text-ui/[inherit] outline-none focus:border-accent";
  switch (field.type) {
    case "toggle":
      return (
        <label className="flex items-center justify-between gap-2 py-1">
          {label}
          <Toggle checked={value === true} onChange={(v) => onChange(v)} label={t(field.labelKey)} />
        </label>
      );
    case "select":
      return (
        <label className="flex items-center justify-between gap-2 py-1">
          {label}
          <select className={input} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} aria-label={t(field.labelKey)}>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </label>
      );
    case "number":
      return (
        <label className="flex items-center justify-between gap-2 py-1">
          {label}
          <input type="number" className={`${input} w-24`} min={field.min} max={field.max} step={field.step ?? 1} value={Number(value ?? field.min)} aria-label={t(field.labelKey)} onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= field.min && v <= field.max) onChange(v);
          }} />
        </label>
      );
    case "timezone": {
      const text = draft ?? String(value ?? "");
      return (
        <label className={`flex min-w-0 items-center gap-2 ${compact ? "flex-1" : "justify-between py-1"}`}>
          {label}
          <input
            className={`${input} ${compact ? "flex-1" : "w-48"} ${draft !== null && !isTimeZone(draft) ? "border-danger" : ""}`}
            list={list}
            value={text}
            placeholder={t("home.desk.zoneSearch")}
            aria-label={t(field.labelKey)}
            data-widget-tz=""
            onChange={(e) => {
              setDraft(e.target.value);
              if (isTimeZone(e.target.value) && e.target.value.includes("/")) {
                onChange(e.target.value);
                setDraft(null);
              }
            }}
            onBlur={() => setDraft(null)}
          />
          <datalist id={list}>
            {all.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>
      );
    }
    case "text":
      return (
        <label className={`flex min-w-0 items-center gap-2 ${compact ? "w-28 shrink-0" : "justify-between py-1"}`}>
          {label}
          <input className={`${input} ${compact ? "w-full" : "w-48"}`} maxLength={field.maxLength ?? 200} value={String(value ?? "")} aria-label={t(field.labelKey)} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
  }
}

export function WidgetSettingsForm({ fields, settings, onChange }: { fields: readonly WidgetSettingField[]; settings: WidgetSettings; onChange(next: WidgetSettings): void }) {
  const { t } = useI18n();
  const set = (key: string, v: Json) => onChange({ ...settings, [key]: v });
  return (
    <div className="flex flex-col gap-2 text-ui/[inherit]" data-widget-settings="">
      {fields.map((field) => {
        if (field.type !== "list") return <FlatField key={field.key} field={field} value={settings[field.key]} onChange={(v) => set(field.key, v)} />;
        const rows = Array.isArray(settings[field.key]) ? (settings[field.key] as WidgetSettings[]) : [];
        return (
          <div key={field.key} className="py-1" data-widget-list={field.key}>
            <div className="text-ui/[inherit] font-medium">{t(field.labelKey)}</div>
            {field.hintKey && <div className="mb-1 text-meta/[inherit] text-subtle">{t(field.hintKey)}</div>}
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-1.5 py-0.5" data-widget-row={i}>
                {field.fields.map((f) => (
                  <FlatField key={f.key} field={f} compact value={row[f.key]} onChange={(v) => set(field.key, rows.map((r, k) => (k === i ? { ...r, [f.key]: v } : r)))} />
                ))}
                <button type="button" disabled={rows.length <= (field.min ?? 0)} title={t("home.desk.listRemove")} aria-label={t("home.desk.listRemove")} onClick={() => set(field.key, rows.filter((_, k) => k !== i))} className="rounded p-1 text-subtle hover:bg-hover disabled:opacity-30">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button type="button" disabled={rows.length >= field.max} onClick={() => set(field.key, [...rows, field.itemDefaults])} className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-hover disabled:opacity-40" data-widget-list-add="">
              <Plus size={12} />
              {t(field.addLabelKey)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
