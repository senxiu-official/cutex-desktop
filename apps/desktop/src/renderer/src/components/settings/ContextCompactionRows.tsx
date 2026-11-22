// 上下文窗口 + 自动压缩 (owner 2026-11-18): the same two rows on every runtime, at Profile level and in a model's
// dialog. The caller maps the value onto its backend (lib/contextCompaction) and says why a choice cannot be stored
// on this host yet; such choices are greyed with that reason, never silently changed.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { formatWindow, parseWindow, WINDOW_PRESETS } from "../../lib/contextPresets";
import { claudeWindowLocked, COMPACT_PERCENT_CHOICES, compactChoice, customCompactText, parseCustomCompact, type ContextWriteError, type UnifiedContext } from "../../lib/contextCompaction";
import { FIELD_W } from "../../lib/fieldWidths";
import { Select, SettingRow, TextInput } from "./Form";

type Row = "window" | "compact";

export function ContextCompactionRows({ runtime, value, onChange, check, disabled, inherit, windowHint, compactHint, compactInfo, percentBlock, onValidityChange, defaultLabels }: {
  runtime: "codex" | "claude";
  value: UnifiedContext;
  /** Called only with a value `check` accepts. */
  onChange(v: UnifiedContext): void;
  /** Why `v` cannot be stored here (null: it can). */
  check(v: UnifiedContext): ContextWriteError | null;
  disabled?: boolean;
  /** A model's dialog: the unset choices read 跟随 Profile. */
  inherit?: boolean;
  windowHint?: ReactNode;
  compactHint?: ReactNode;
  compactInfo?: ReactNode;
  /** Why a percentage needs a fixed window here (shown under 自动压缩 while none is chosen); null: it does not. */
  percentBlock: string | null;
  /** false while a typed 自定义 value is invalid or refused: the owning form must not save (its draft holds the last
   *  value that was valid, not what is shown). */
  onValidityChange?(valid: boolean): void;
  /** P13 B: the unset / default choices' labels from the backend's resolved defaults (「默认（272K）」, 「默认」). */
  defaultLabels?: { window?: string; compact?: string };
}) {
  const { t } = useI18n();
  const m = (k: string) => t(`settings.modelContext.${k}` as MessageKey);
  const [windowText, setWindowText] = useState<string | null>(null);
  const [compactText, setCompactText] = useState<string | null>(null);
  /** Per row: a valid edit in one row never clears the other row's error. */
  const [errors, setErrors] = useState<Record<Row, string | null>>({ window: null, compact: null });
  const setRowError = (row: Row, text: string | null) => setErrors((e) => ({ ...e, [row]: text }));
  const locked = runtime === "claude" && claudeWindowLocked(value);
  const reason = (e: ContextWriteError) => m(`error.${e}`);
  // What this component last sent up: a value arriving that is not it (撤销, another save, a refresh) drops the
  // typed text and its error, so the inputs show the value again.
  const emitted = useRef<string | null>(null);
  const valueKey = JSON.stringify(value);
  useEffect(() => {
    if (emitted.current !== valueKey) {
      setWindowText(null);
      setCompactText(null);
      setErrors({ window: null, compact: null });
    }
    emitted.current = null;
  }, [valueKey]);

  /** Stores `next` (a change of `row`) together with what the other row's typed text says when that parses, so a
   *  draft never mixes a new value with a stale one shown differently; an unparsable other row keeps its error. */
  const apply = (row: Row, next: UnifiedContext): boolean => {
    let merged = next;
    let otherOk = true;
    if (row === "window" && compactText !== null) {
      const c = parseCustomCompact(compactText);
      if (c) merged = { ...merged, compact: c };
      else otherOk = false;
    } else if (row === "compact" && windowText !== null) {
      const w = parseWindow(windowText);
      if (w !== null) merged = { ...merged, window: w };
      else otherOk = false;
    }
    const bad = check(merged);
    if (bad) {
      setRowError(row, reason(bad));
      return false;
    }
    setErrors((e) => ({ ...e, [row]: null, ...(otherOk ? { [row === "window" ? "compact" : "window"]: null } : {}) }));
    emitted.current = JSON.stringify(merged);
    onChange(merged);
    return true;
  };

  // Invalid = an error under a row whose typed text is shown (a refused select choice snaps back, so it does not block).
  const invalid = (errors.window !== null && windowText !== null) || (errors.compact !== null && compactText !== null);
  const report = useRef(onValidityChange);
  report.current = onValidityChange;
  useEffect(() => report.current?.(!invalid), [invalid]);
  useEffect(() => () => report.current?.(true), []);

  const windowSel = windowText !== null ? "custom" : value.window === null ? "unset" : (WINDOW_PRESETS as readonly number[]).includes(value.window) ? String(value.window) : "custom";
  const compactSel: string = compactText !== null ? "custom" : compactChoice(value.compact);
  const percentOff = percentBlock !== null && value.window === null;

  return (
    <>
      <SettingRow source="host" agents="next" label={m("window")} hint={<>
        {windowHint}
        {locked && <span className="block">{m("windowLocked")}</span>}
        {errors.window && <span className="block text-danger">{errors.window}</span>}
      </>}>
        <span className="flex items-center gap-2">
          <Select
            width={FIELD_W.model}
            label={m("window")}
            disabled={disabled || locked}
            value={locked ? "locked" : windowSel}
            options={[
              ...(locked ? [{ value: "locked", label: m("windowByCompaction") }] : []),
              // 按模型 cannot be combined with a percentage on this host yet: greyed (the row hint says why).
              { value: "unset", label: defaultLabels?.window ?? (inherit ? m("followProfile") : m("byModel")), disabled: !inherit && value.compact !== null && "percent" in value.compact && percentBlock !== null },
              ...WINDOW_PRESETS.map((w) => ({ value: String(w), label: formatWindow(w) })),
              { value: "custom", label: m("custom") },
            ]}
            onChange={(v) => {
              if (v === "custom") return setWindowText(value.window ? String(value.window / 1000) + "k" : "");
              setWindowText(null);
              apply("window", { ...value, window: v === "unset" ? null : Number(v) });
            }}
          />
          {windowSel === "custom" && !locked && (
            <TextInput width="w-24" label={m("window")} placeholder="300k" disabled={disabled} value={windowText ?? (value.window ? `${value.window / 1000}k` : "")}
              onChange={(text) => {
                setWindowText(text);
                const w = parseWindow(text);
                if (w === null) return setRowError("window", t("agent-config.profile.invalidTokens"));
                apply("window", { ...value, window: w });
              }} />
          )}
        </span>
      </SettingRow>
      <SettingRow source="host" agents="next" label={m("compact")} info={compactInfo} hint={<>
        {compactHint}
        {percentOff && <span className="block">{t("settings.modelContext.percentNeedsWindowHint" as MessageKey, { reason: percentBlock })}</span>}
        {errors.compact && <span className="block text-danger">{errors.compact}</span>}
      </>}>
        <span className="flex items-center gap-2">
          <Select
            width={FIELD_W.model}
            label={m("compact")}
            disabled={disabled}
            value={compactSel}
            options={[
              { value: "default", label: defaultLabels?.compact ?? (inherit ? m("followProfile") : runtime === "claude" ? m("defaultClaude") : m("defaultCodex")) },
              ...COMPACT_PERCENT_CHOICES.map((p) => ({ value: `p${p}`, label: t("settings.modelContext.percentOfWindow" as MessageKey, { p }), disabled: percentOff })),
              { value: "custom", label: m("custom") },
            ]}
            onChange={(v) => {
              if (v === "custom") return setCompactText(customCompactText(value.compact));
              setCompactText(null);
              apply("compact", { ...value, compact: v === "default" ? null : { percent: Number(v.slice(1)) } });
            }}
          />
          {compactSel === "custom" && (
            <TextInput width="w-24" label={m("compact")} placeholder={runtime === "claude" ? "500k" : "450k"} disabled={disabled} value={compactText ?? customCompactText(value.compact)}
              onChange={(text) => {
                setCompactText(text);
                const c = parseCustomCompact(text);
                if (!c) return setRowError("compact", m("error.customText"));
                apply("compact", { ...value, compact: c });
              }} />
          )}
        </span>
      </SettingRow>
    </>
  );
}

/** A runtime (or host) without these settings: the same two rows, greyed, with one line saying why. */
export function UnsupportedContextRows({ reason }: { reason: string }) {
  const { t } = useI18n();
  const m = (k: string) => t(`settings.modelContext.${k}` as MessageKey);
  return (
    <>
      {(["window", "compact"] as const).map((k) => (
        <SettingRow key={k} source="host" agents="next" readOnly label={m(k)} hint={reason}>
          <Select width={FIELD_W.model} label={m(k)} disabled value="" options={[{ value: "", label: "—" }]} onChange={() => {}} />
        </SettingRow>
      ))}
    </>
  );
}
