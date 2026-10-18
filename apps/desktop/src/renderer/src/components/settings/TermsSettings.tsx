// 通用 → 术语 (Terminology; was 称呼 until 2026-10-18): the words the UI uses for agent / sub-agent /
// director / owner (lib/terms), per language. One row per term for the current UI language only (owner
// 2026-10-18: no picker for other languages), then a live preview band (PreviewBand): a few pieces of the
// real UI in the current words. Hovering / focusing a row marks its word in the preview; the band's
// 「标出术语」 switch marks them all. A field commits on Enter / blur ("" = default) and the whole UI
// follows at once.
import { useState, type ReactNode } from "react";
import { loadedCatalog, useI18n, type MessageKey } from "../../i18n";
import { en } from "../../i18n/en";
import { PreviewMarkContext } from "../../lib/previewMark";
import { DEFAULT_TERMS, resetTerm, resolveTerms, setTerm, splitTerms, subagentDefault, TERM_IDS, TERM_MAX, useTermOverrides, type TermId, type TermLocale } from "../../lib/terms";
import { settingsAnchorId } from "../../lib/settingsNav";
import { Avatar } from "../Avatar";
import { ResetButton, Section, SettingRow, TextField, Toggle } from "./Form";
import { PreviewBand, PreviewTerm } from "./PreviewBand";

/**
 * A term row label: the built-in word of the UI language plus a second language so the concept is clear
 * whatever it was renamed to (owner 2026-10-18): Chinese → / English, English → / 简体中文, others → / English.
 */
export function termLabel(locale: TermLocale, id: TermId): string {
  const second: TermLocale = locale.startsWith("zh") ? "en" : locale.startsWith("en") ? "zh-CN" : "en";
  // A label, so each word starts upper-case (the stored defaults are mid-sentence lower case).
  const up = (w: string) => w.charAt(0).toLocaleUpperCase() + w.slice(1);
  return `${up(DEFAULT_TERMS[locale][id].one)} / ${up(DEFAULT_TERMS[second][id].one)}`;
}

export function TermsSection() {
  const { t, locale } = useI18n();
  const loc: TermLocale = locale;
  const [markAll, setMarkAll] = useState(false);
  const [focus, setFocus] = useState<TermId | null>(null);
  return (
    <Section id={settingsAnchorId("terms")} title={t("terms.title")} hint={t("terms.hint")}>
      <PreviewMarkContext value={{ all: markAll, focus, setFocus }}>
        {/* Rows in their own box: the last one draws no rule, the preview band is the divider. */}
        <div>
          {TERM_IDS.map((id) => (
            <div
              key={`${loc}.${id}`}
              className="border-b border-border/60 last:border-b-0 empty:hidden"
              onMouseEnter={() => setFocus(id)}
              onMouseLeave={() => setFocus(null)}
              onFocusCapture={() => setFocus(id)}
              onBlurCapture={() => setFocus(null)}
            >
              <TermRow locale={loc} id={id} />
            </div>
          ))}
        </div>
        <PreviewBand
          control={
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              {t("terms.markAll")}
              <Toggle label={t("terms.markAll")} checked={markAll} onChange={setMarkAll} />
            </label>
          }
        >
          <TermsSample locale={loc} />
        </PreviewBand>
      </PreviewMarkContext>
    </Section>
  );
}

// Partial, lazily loaded catalogs (see i18n/index.tsx): a sample piece falls back to en when the
// language's catalog lacks it.
const raw = (locale: TermLocale, key: MessageKey) => loadedCatalog(locale)?.[key] ?? en[key];

/** A sample piece with its term placeholders as marked words. */
function Piece({ locale, k }: { locale: TermLocale; k: MessageKey }) {
  const terms = resolveTerms(useTermOverrides(), locale);
  return <>{splitTerms(raw(locale, k), terms, locale).map((p, i) => (typeof p === "string" ? p : <PreviewTerm key={i} id={p.id}>{p.text}</PreviewTerm>))}</>;
}

/** Pieces of the real UI (new-agent entry, counts, a director badge, a waiting chip) in one wrapping line. */
function TermsSample({ locale }: { locale: TermLocale }) {
  const terms = resolveTerms(useTermOverrides(), locale);
  const muted = (children: ReactNode) => <span className="text-xs text-muted">{children}</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-[13px]">
      <span className="inline-flex h-6 items-center rounded-md border border-border bg-surface px-2 text-xs">
        <span>＋ <Piece locale={locale} k="terms.sample.new" /></span>
      </span>
      {muted(<Piece locale={locale} k="terms.sample.online" />)}
      <span className="inline-flex items-center gap-1.5">
        <Avatar name="Eva" seed="Eva" size={20} />
        <span className="font-medium">Eva</span>
        <span className="rounded bg-surface-2 px-1 text-[11px] text-muted">
          <PreviewTerm id="director">{terms.director.one}</PreviewTerm>
        </span>
      </span>
      {muted(<Piece locale={locale} k="terms.sample.working" />)}
      {muted(<Piece locale={locale} k="terms.sample.reportsTo" />)}
      <span className="inline-flex h-6 items-center rounded-md bg-warn/15 px-2 text-xs text-warn-text">
        <span><Piece locale={locale} k="terms.sample.waiting" /></span>
      </span>
    </div>
  );
}

function TermRow({ locale, id }: { locale: TermLocale; id: TermId }) {
  const { t } = useI18n();
  const overrides = useTermOverrides();
  const saved = overrides[locale]?.[id] ?? {};
  const resolved = resolveTerms(overrides, locale);
  // The sub-agent default follows the current agent word (「子」 + agent).
  const defaults = id === "subagent" ? subagentDefault(resolved.agent, locale) : DEFAULT_TERMS[locale][id];
  const plural = !locale.startsWith("zh") && !locale.startsWith("ja") && !locale.startsWith("ko");
  return (
    <SettingRow
      label={termLabel(locale, id)}
      // The default as a hint only where it says more than the placeholder: the plural forms (always shown, so
      // the row never changes height). The derived sub word (子 + a renamed agent word) is the placeholder
      // itself; a hint appearing only then made the rows below jump (owner 2026-10-18).
      hint={plural ? t("terms.default", { value: `${defaults.one} / ${defaults.many}` }) : undefined}
      reset={<ResetButton disabled={!saved.one && !saved.many} onClick={() => resetTerm(locale, id)} title={t("terms.reset")} />}
    >
      <TextField value={saved.one ?? ""} placeholder={defaults.one} maxLength={TERM_MAX} width="w-32" label={plural ? t("terms.singular") : undefined} onCommit={(v) => setTerm(locale, id, "one", v)} />
      {plural && <TextField value={saved.many ?? ""} placeholder={resolved[id].many} maxLength={TERM_MAX} width="w-32" label={t("terms.plural")} onCommit={(v) => setTerm(locale, id, "many", v)} />}
    </SettingRow>
  );
}
