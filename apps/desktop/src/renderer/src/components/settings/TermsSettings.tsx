// 通用 → 术语 (Terminology; was 称呼 until 2026-10-18): the words the UI uses for agent / sub-agent /
// director / owner (lib/terms), per language. One row per term for the current UI language only (owner
// 2026-10-18: no picker for other languages), then a live preview band (PreviewBand): a few pieces of the
// real UI in the current words. Hovering / focusing a row marks its word in the preview; the band's
// 「标出术语」 switch marks them all. A field commits on Enter / blur ("" = default) and the whole UI
// follows at once.
import { useState, type ReactNode } from "react";
import { loadedCatalog, useEnglishCatalog, useI18n, type MessageKey } from "../../i18n";
import { zhCN } from "../../i18n/zh-CN";
import { PreviewMarkContext } from "../../lib/previewMark";
import { DEFAULT_TERMS, resetTerm, resolveTerms, resolveSidebarRoleLabel, sidebarRoleDefault, setSidebarRoleLabel, setTerm, splitTerms, subagentDefault, SIDEBAR_ROLES, TERM_IDS, TERM_MAX, useTermOverrides, type SidebarRole, type TermId, type TermLocale } from "../../lib/terms";

const isSidebarRole = (id: TermId): id is SidebarRole => (SIDEBAR_ROLES as readonly string[]).includes(id);
import { settingsAnchorId } from "../../lib/settingsNav";
import { Avatar } from "../Avatar";
import { ResetButton, Section, SettingRow, TextField, Toggle, SettingsGroup } from "./Form";
import { PreviewBand, PreviewTerm } from "./PreviewBand";
import { Tag } from "../../components/Tag";

/**
 * A term row label: the built-in word of the UI language plus a second language so the concept is clear
 * whatever it was renamed to (owner 2026-10-18): Chinese → / English, English → / 简体中文, others → / English.
 */
export function termLabel(locale: TermLocale, id: TermId): string {
  const second: TermLocale = locale.startsWith("zh") ? "en" : locale.startsWith("en") ? "zh-CN" : "en";
  // A label, so each word starts upper-case (the stored defaults are mid-sentence lower case).
  const up = (w: string) => w.charAt(0).toLocaleUpperCase() + w.slice(1);
  const a = up(DEFAULT_TERMS[locale][id].one);
  const b = up(DEFAULT_TERMS[second][id].one);
  // The Shelf is "Shelf" in every language: one word says it.
  return a === b ? a : `${a} / ${b}`;
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
              <SettingsGroup agents="none" source="local"><Toggle label={t("terms.markAll")} checked={markAll} onChange={setMarkAll} /></SettingsGroup>
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
// language's catalog lacks it (en itself loads on demand: zh-CN until it has).
const raw = (locale: TermLocale, key: MessageKey, en: Readonly<Record<MessageKey, string>> | undefined) => loadedCatalog(locale)?.[key] ?? en?.[key] ?? zhCN[key];

/** A sample piece with its term placeholders as marked words. */
function Piece({ locale, k }: { locale: TermLocale; k: MessageKey }) {
  const terms = resolveTerms(useTermOverrides(), locale);
  const en = useEnglishCatalog();
  return <>{splitTerms(raw(locale, k, en), terms, locale).map((p, i) => (typeof p === "string" ? p : <PreviewTerm key={i} id={p.id}>{p.text}</PreviewTerm>))}</>;
}

/** Pieces of the real UI (new-agent entry, counts, a director badge, a waiting chip) in one wrapping line. */
function TermsSample({ locale }: { locale: TermLocale }) {
  const overrides = useTermOverrides();
  const terms = resolveTerms(overrides, locale);
  const director = resolveSidebarRoleLabel(overrides, locale, "director"), operator = resolveSidebarRoleLabel(overrides, locale, "operator"), assistant = resolveSidebarRoleLabel(overrides, locale, "assistant");
  const muted = (children: ReactNode) => <span className="text-xs text-muted">{children}</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-ui/[inherit]">
      <span className="inline-flex h-6 items-center rounded-md border border-border bg-surface px-2 text-xs">
        <span>＋ <Piece locale={locale} k="terms.sample.new" /></span>
      </span>
      {muted(<Piece locale={locale} k="terms.sample.online" />)}
      <span className="inline-flex items-center gap-1.5">
        <Avatar name="Eva" seed="Eva" size={20} />
        <span className="font-medium">Eva</span>
        {director && <Tag title={terms.director.one}>
          <PreviewTerm id="director">{director}</PreviewTerm>
        </Tag>}
      </span>
      {muted(<Piece locale={locale} k="terms.sample.working" />)}
      {muted(<Piece locale={locale} k="terms.sample.reportsTo" />)}
      {operator && <Tag title={terms.operator.one}><PreviewTerm id="operator">{operator}</PreviewTerm></Tag>}
      {assistant && (
        <span className="inline-flex items-center gap-1.5">
          <Avatar name="Iris" seed="Iris" size={20} />
          <span className="font-medium">Iris</span>
          <Tag title={terms.assistant.one}><PreviewTerm id="assistant">{assistant}</PreviewTerm></Tag>
        </span>
      )}
      <Tag tone="attention">
        <span><Piece locale={locale} k="terms.sample.waiting" /></span>
      </Tag>
      {muted(<Piece locale={locale} k="terms.sample.shelf" />)}
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
  const sidebar = isSidebarRole(id);
  const width = plural ? "w-32" : "w-36";
  return (
    // Owner 2026-11-24: one column of inputs with one right edge (every field one width: w-36, w-32 beside a plural). Every row's word field(s) on the first line; the
    // Director / Operator 「侧栏显示」 field stacked under them, its label to its left (「留空隐藏」 is its placeholder
    // and tooltip). Counters float on the field's top edge (focus / near the limit) and never add a line. One
    // 「恢复默认」 per row (SettingRow, after the label): the whole term, its sidebar label included. The defaults are
    // the placeholders, so no 「默认：…」 hint line.
    <SettingRow agents="none" source="local"
      label={termLabel(locale, id)}
      reset={<ResetButton disabled={!saved.one && !saved.many && saved.sidebar === undefined} onClick={() => resetTerm(locale, id)} title={t("terms.reset")} />}
    >
      <div className="flex flex-col items-end gap-2" data-term-fields={id}>
        <div className="flex items-center gap-2">
          <TextField value={saved.one ?? ""} placeholder={defaults.one} maxLength={TERM_MAX} width={width} floatingCounter label={plural ? `${termLabel(locale, id)} · ${t("terms.singular")}` : undefined} onCommit={(v) => setTerm(locale, id, "one", v)} />
          {plural && <TextField value={saved.many ?? ""} placeholder={resolved[id].many} maxLength={TERM_MAX} width={width} floatingCounter label={`${termLabel(locale, id)} · ${t("terms.plural")}`} onCommit={(v) => setTerm(locale, id, "many", v)} />}
        </div>
        {sidebar && (
          <div className="flex items-center gap-2" data-term-sidebar={id}>
            <span className="text-caption/[inherit] whitespace-nowrap text-subtle" title={t("terms.sidebarHidden")}>{t("terms.sidebarLabel")}</span>
            <TextField value={saved.sidebar ?? sidebarRoleDefault(resolved, id as SidebarRole)} placeholder={t("terms.sidebarHidden")} maxLength={TERM_MAX} width={width} floatingCounter label={`${termLabel(locale, id)} · ${t("terms.sidebarLabel")}`} onCommit={v => setSidebarRoleLabel(locale, id as SidebarRole, v)} />
          </div>
        )}
      </div>
    </SettingRow>
  );
}
