// Form primitives shared by the Settings pages (docs/research/settings-audit-20261008.md §4).
//
// Save semantics — exactly three, one per field:
//   • immediate: Toggle / Segmented / Select apply on change;
//   • on commit: TextField / NumberField apply on Enter or blur (never per keystroke);
//   • draft + save bar: multi-field forms that validate together (Profile detail).
// Rows: every setting is a `SettingRow` (label + hint | control column | reset slot), so controls
// line up on one right edge on every page; entity lists use `ListRow` with click-twice removal.
import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Plus, RotateCcw, RotateCw, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { ARMED_BUTTON, useArmed } from "../../lib/armedConfirm";
import { FIELD_W } from "../../lib/fieldWidths";
import { shownSettingsSource } from "../../lib/hosts";
import { parseClamped, radioKeyTarget, RowA11yContext, useRowA11y } from "../../lib/formA11y";
import type { SettingsSource } from "../../lib/settingsNav";
import { useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface";
const FIELD = "rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

/** Where a page's (or section's) settings live: this machine, the target host's cutex (lib/targetHost: Settings' host), or its codex config. */
export function SourceTag({ source }: { source: SettingsSource }) {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const host = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.label) ?? "—";
  const label = source === "local" ? t("settings.source.local") : t(source === "host" ? "settings.source.host" : "settings.source.codex", { host });
  const title = source === "local" ? t("settings.source.localHint") : t(source === "host" ? "settings.source.hostHint" : "settings.source.codexHint", { host });
  const tone = source === "local" ? "bg-surface-2 text-muted" : "bg-accent/12 text-accent";
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] whitespace-nowrap ${tone}`}>
      {label}
    </span>
  );
}

/** The page header's source (SettingsPage): a section tag repeating it is left out. */
const PageSourceContext = createContext<SettingsSource | undefined>(undefined);

/**
 * Page header: the source tag and an optional page-wide note. The page name is in the breadcrumb.
 * `host`: the host picker of a host page (multi-host; replaces the 主机 · name tag, kept for codex config).
 * `link`: a related page at the header's end (the page item's `headerLink`, e.g. 运行时 → 后端更新).
 */
export function SettingsPage({ source, hint, host, link, children }: { source?: SettingsSource; hint?: ReactNode; host?: ReactNode; link?: ReactNode; children: ReactNode }) {
  // No local host (macOS without a local cutex): no 「本机」 tag (lib/hosts shownSettingsSource).
  const shown = useApp((s) => shownSettingsSource(source, s.hosts));
  return (
    <>
      {(shown || hint || host || link) && (
        <div className={`mb-4 flex min-h-5 flex-wrap gap-2 ${host ? "items-center" : "items-start"}`}>
          {host}
          {shown && !(host && shown === "host") && <SourceTag source={shown} />}
          {hint && <p className="min-w-0 pt-0.5 text-xs text-subtle">{hint}</p>}
          {link && <span className="ml-auto shrink-0 pt-0.5">{link}</span>}
        </div>
      )}
      <PageSourceContext value={source}>{children}</PageSourceContext>
    </>
  );
}

/**
 * A card with a title row (title · source tag · actions on the right) and a one-line hint. `source`
 * tags a section whose settings live elsewhere than the page's (a mixed page: every section tags);
 * the same source as the page header is not repeated.
 */
export function Section({ title, hint, source, children, actions, id }: { title?: string; hint?: ReactNode; source?: SettingsSource; children: ReactNode; actions?: ReactNode; id?: string }) {
  const pageSource = useContext(PageSourceContext);
  const shown = useApp((s) => shownSettingsSource(source, s.hosts));
  if (source && source === pageSource) source = undefined;
  else source = shown;
  return (
    <section className="mb-6" id={id}>
      {(title || actions || source) && (
        <div className="mb-2">
          {/* Fixed-height title row whether or not there are actions, so a button appearing never moves the page. */}
          <div className="flex h-7 items-center gap-2">
            {title && <h3 className="min-w-0 truncate text-sm font-semibold">{title}</h3>}
            {source && <SourceTag source={source} />}
            {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
          </div>
          {hint && <p className="text-xs text-subtle">{hint}</p>}
        </div>
      )}
      <div className="@container rounded-xl border border-card-border bg-surface px-4 py-1">{children}</div>
    </section>
  );
}

/**
 * The one settings row: label (+ hint, + optional sample) | control column (right-aligned) | a
 * fixed 24px reset slot (kept empty when there is no reset, so every page shares one right edge).
 * In a narrow card (< 28rem) the controls drop under the label, left-aligned.
 */
export function SettingRow({ label, hint, children, reset, sample }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; reset?: ReactNode; sample?: ReactNode }) {
  const id = useId();
  const labelId = `${id}l`;
  const hintId = hint ? `${id}h` : undefined;
  return (
    <div
      className={`grid grid-cols-[minmax(9rem,1fr)_auto_1.5rem] gap-x-3 gap-y-1.5 border-b border-border/60 py-3 last:border-b-0 @max-[28rem]:grid-cols-[minmax(0,1fr)_1.5rem] ${sample ? "items-start" : "items-center"}`}
    >
      <div className="min-w-0">
        <div id={labelId} className="text-sm">
          {label}
        </div>
        {hint && (
          <div id={hintId} className="text-xs text-subtle">
            {hint}
          </div>
        )}
        {sample}
      </div>
      <RowA11yContext value={{ labelId, hintId }}>
        <div className="flex min-w-0 items-center justify-end gap-2 @max-[28rem]:col-span-1 @max-[28rem]:row-start-2 @max-[28rem]:flex-wrap @max-[28rem]:justify-start">
          {children}
        </div>
      </RowA11yContext>
      <div className="flex h-full w-6 items-center justify-center @max-[28rem]:col-start-2 @max-[28rem]:row-start-1">{reset}</div>
    </div>
  );
}

/** A link-styled text button with a trailing →, e.g. a page header's related page. */
export function TextLink({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 rounded text-xs text-accent hover:underline ${FOCUS}`}>
      {children}
      <ArrowRight size={12} aria-hidden />
    </button>
  );
}

/** "Change this elsewhere →": a row whose whole right side is one link. */
export function LinkRow({ label, hint, link, onClick }: { label: ReactNode; hint?: ReactNode; link: string; onClick(): void }) {
  return (
    <SettingRow label={label} hint={hint}>
      <button onClick={onClick} className={`rounded text-xs text-accent hover:underline ${FOCUS}`}>
        {link}
      </button>
    </SettingRow>
  );
}

/** A text action inside a SettingRow hint (「恢复官方地址」…): link-styled, so the control column never shifts. */
export function HintAction({ children, onClick, title, disabled }: { children: ReactNode; onClick(): void; title?: string; disabled?: boolean }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`ml-1.5 rounded text-accent hover:underline disabled:opacity-40 ${FOCUS}`}>
      {children}
    </button>
  );
}

/** Reset-to-default for a SettingRow's reset slot (invisible while there is nothing to reset). */
export function ResetButton({ disabled, onClick, title }: { disabled?: boolean; onClick(): void; title?: string }) {
  const { t } = useI18n();
  const label = title ?? t("appearance.reset");
  return (
    <button title={label} aria-label={label} disabled={disabled} onClick={onClick} className={`rounded p-1 text-subtle hover:bg-surface-2 hover:text-foreground disabled:invisible ${FOCUS}`}>
      <RotateCcw size={13} />
    </button>
  );
}

/** Icon-only button (refresh / add / remove…): always has an accessible name and a tooltip. */
export function IconButton({ label, onClick, disabled, children, danger }: { label: string; onClick(e: React.MouseEvent<HTMLButtonElement>): void; disabled?: boolean; children: ReactNode; danger?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface-2 disabled:opacity-40 ${danger ? "hover:text-danger" : "hover:text-foreground"} ${FOCUS}`}
    >
      {children}
    </button>
  );
}

export function RefreshButton({ onClick, disabled, label }: { onClick(): void; disabled?: boolean; label?: string }) {
  const { t } = useI18n();
  return (
    <IconButton label={label ?? t("settings.reload")} disabled={disabled} onClick={onClick}>
      <RotateCw size={14} />
    </IconButton>
  );
}

/** Remove with click-twice confirmation: the first click arms (red "click again"), the second removes. */
export function ArmedRemove({ title, disabled, onRemove, armedLabel }: { title: string; disabled?: boolean; onRemove(): void; armedLabel?: string }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed();
  return armed ? (
    <button disabled={disabled} onClick={() => (setArmed(false), onRemove())} className={`${ARMED_BUTTON} flex h-6 shrink-0 items-center whitespace-nowrap ${FOCUS}`}>
      {armedLabel ?? t("settings.removeArmed")}
    </button>
  ) : (
    <IconButton label={title} danger disabled={disabled} onClick={() => setArmed(true)}>
      <X size={14} />
    </IconButton>
  );
}

/** "+ Add …" text button with the lucide Plus (`primary`: the main add action of a card). */
export function AddButton({ children, onClick, disabled, title, primary }: { children: ReactNode; onClick(e: React.MouseEvent<HTMLButtonElement>): void; disabled?: boolean; title?: string; primary?: boolean }) {
  return (
    <Button onClick={onClick} disabled={disabled} title={title} primary={primary}>
      <Plus size={13} className="mr-1 -ml-0.5 inline align-[-2px]" />
      {children}
    </Button>
  );
}

/**
 * One entity in a list (host, MCP server, model, price, domain pair…): optional leading mark, a
 * name and one grey detail line, icon actions on the right; `below` for anything that expands.
 */
export function ListRow({ leading, title, detail, actions, below, frame }: { leading?: ReactNode; title: ReactNode; detail?: ReactNode; actions?: ReactNode; below?: ReactNode; frame?: string }) {
  return (
    <div className={`-mx-4 border-b border-border px-4 py-2 last:border-b-0 ${frame ?? ""}`}>
      <div className="flex min-h-7 items-center gap-2.5">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{title}</div>
          {detail && <div className="truncate text-xs text-subtle">{detail}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {below}
    </div>
  );
}

/** Skeleton rows while a page or section loads (instead of a bare "…"). */
export function Loading({ rows = 2 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t("settings.loading")} className="py-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
          <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
          <div className="ml-auto h-5 w-24 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="py-2 text-xs text-danger">
      {children}
    </p>
  );
}

/** A warning / info line inside a card (restart needed, mode notes…). */
export function Notice({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "info" }) {
  return <p className={`py-2 text-xs ${tone === "warn" ? "text-warn" : "text-subtle"}`}>{children}</p>;
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <p className="min-w-0 flex-1 text-xs text-subtle">{children}</p>
      {action}
    </div>
  );
}

/** A part that waits on a cutex route: what it will hold, and which API it needs. */
export function PlannedCard({ api, children }: { api: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="py-2.5">
      <p className="text-sm text-muted">{children}</p>
      <p className="mt-1 text-xs text-subtle">{t("settings.pendingCutex", { api })}</p>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: { value: NoInfer<T>; label: string }[]; onChange(v: NoInfer<T>): void; disabled?: boolean; label?: string }) {
  const aria = useRowA11y(label);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div role="radiogroup" {...aria} aria-disabled={disabled || undefined} className={`flex shrink-0 rounded-lg bg-surface-2 p-0.5 ${disabled ? "opacity-50" : ""}`}>
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={on}
            tabIndex={i === selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const next = radioKeyTarget(e.key, i, options.length);
              if (next === null) return;
              e.preventDefault();
              refs.current[next]?.focus();
              onChange(options[next]!.value);
            }}
            className={`rounded-md px-2.5 py-1 text-xs whitespace-nowrap ${FOCUS} ${on ? "bg-raised text-foreground shadow-sm ring-1 ring-border" : "text-muted hover:text-foreground"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Raw controlled text input, for draft forms (add host, add MCP server…) that save with a button. */
export function TextInput({ value, onChange, placeholder, mono, width = "w-64", disabled, type = "text", maxLength, label, onBlur, onKeyDown, autoFocus }: { value: string; onChange(v: string): void; placeholder?: string; mono?: boolean; width?: string; disabled?: boolean; type?: "text" | "password"; maxLength?: number; label?: string; onBlur?(): void; onKeyDown?(e: React.KeyboardEvent<HTMLInputElement>): void; autoFocus?: boolean }) {
  const aria = useRowA11y(label);
  return (
    <input
      type={type}
      {...aria}
      autoComplete={type === "password" ? "off" : undefined}
      value={value}
      autoFocus={autoFocus}
      disabled={disabled}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={`${width} ${FIELD} ${mono ? "font-mono text-xs" : ""}`}
    />
  );
}

/** Raw controlled multi-line input for draft forms (one value per line: MCP args…). */
export function TextArea({ value, onChange, placeholder, mono, width = "w-64", rows = 3, disabled, label }: { value: string; onChange(v: string): void; placeholder?: string; mono?: boolean; width?: string; rows?: number; disabled?: boolean; label?: string }) {
  const aria = useRowA11y(label);
  return (
    <textarea
      {...aria}
      value={value}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      spellCheck={false}
      wrap={mono ? "off" : "soft"}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} resize-y ${FIELD} ${mono ? "font-mono text-xs" : ""}`}
    />
  );
}

/**
 * A text setting saved on commit (Enter or blur), never per keystroke; Esc restores the saved
 * value. After a successful commit "已保存" shows briefly next to the field.
 */
export function TextField({ value, onCommit, placeholder, mono, width = "w-64", disabled, maxLength, label }: { value: string; onCommit(v: string): Promise<unknown> | void; placeholder?: string; mono?: boolean; width?: string; disabled?: boolean; maxLength?: number; label?: string }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const commit = async () => {
    if (draft === null) return;
    const next = draft;
    setDraft(null);
    if (next === value) return;
    await onCommit(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <>
      {saved && <span className="text-xs text-subtle">{t("settings.saved")}</span>}
      <TextInput
        label={label}
        mono={mono}
        width={width}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        value={draft ?? value}
        onChange={setDraft}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
    </>
  );
}

/**
 * A number setting: optional slider + a number box + unit suffix. The box keeps what is typed as a
 * draft and applies it (clamped) on Enter / blur, so typing "120" never applies 1 → 12 → 120.
 */
export function NumberField({ value, range, unit, step = 1, slider, onCommit, disabled, label, placeholder }: { value: number | null; range: readonly [number, number]; unit?: string; step?: number; slider?: boolean; onCommit(v: number | null): void; disabled?: boolean; label?: string; placeholder?: string }) {
  const aria = useRowA11y(label);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = parseClamped(draft, range);
    if (n !== value && (n !== null || draft.trim() === "")) onCommit(n);
    setDraft(null);
  };
  return (
    <>
      {slider && (
        <input
          type="range"
          {...aria}
          min={range[0]}
          max={range[1]}
          step={step}
          value={value ?? range[0]}
          disabled={disabled}
          onChange={(e) => onCommit(Number(e.target.value))}
          className={`w-40 accent-[var(--accent)] ${FOCUS}`}
        />
      )}
      <input
        type="text"
        inputMode="numeric"
        {...aria}
        disabled={disabled}
        placeholder={placeholder}
        value={draft ?? (value === null ? "" : String(value))}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        className={`w-16 text-right tabular-nums ${FIELD} py-0.5 text-xs`}
      />
      {unit !== undefined && <span className="w-6 text-xs text-subtle">{unit}</span>}
    </>
  );
}

/** Fixed-width select (`width`: a FIELD_W token, default generic); long labels truncate with a tooltip. */
export function Select<T extends string>({ value, options, onChange, disabled, width = FIELD_W.generic, label }: { value: T; options: { value: NoInfer<T>; label: string; disabled?: boolean }[]; onChange(v: NoInfer<T>): void; disabled?: boolean; width?: string; label?: string }) {
  const aria = useRowA11y(label);
  const current = options.find((o) => o.value === value)?.label;
  return (
    <select {...aria} value={value} disabled={disabled} title={current} onChange={(e) => onChange(e.target.value as T)} className={`${width} truncate ${FIELD}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; label?: string }) {
  const aria = useRowA11y(label);
  return (
    <button
      role="switch"
      {...aria}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${FOCUS} ${checked ? "bg-accent" : "bg-surface-2 ring-1 ring-border ring-inset"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/**
 * A check box (several independent picks in a table or list: delivery channels, grants, "remember
 * this person"); one on/off setting in a row is a `Toggle`. Same look as the notification matrix.
 * Inside a `<label>` the label text toggles it too.
 */
export function Checkbox({ checked, onChange, disabled, label }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-40 ${FOCUS} ${checked ? "border-accent bg-accent text-white" : "border-border bg-background hover:border-accent/70"}`}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

/**
 * A boolean setting that may be left at a default: one switch showing the effective value and a ↺
 * in the reset slot, visible only while a value is stored (`explicit`). Switching always stores a
 * value; ↺ clears it (`onReset`). `resetTitle` names the default (「恢复默认（开）」).
 */
export function DefaultableToggleRow({ label, hint, checked, explicit, onChange, onReset, disabled, resetTitle }: { label: ReactNode; hint?: ReactNode; checked: boolean; explicit: boolean; onChange(v: boolean): void; onReset(): void; disabled?: boolean; resetTitle: string }) {
  return (
    <SettingRow label={label} hint={hint} reset={<ResetButton disabled={disabled || !explicit} onClick={onReset} title={resetTitle} />}>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} />
    </SettingRow>
  );
}

export function Button({ children, onClick, primary, disabled, title }: { children: ReactNode; onClick(e: React.MouseEvent<HTMLButtonElement>): void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`shrink-0 rounded-md px-3 py-1 text-xs whitespace-nowrap disabled:opacity-40 ${FOCUS} ${primary ? "bg-accent font-medium text-white" : "border border-border hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}
