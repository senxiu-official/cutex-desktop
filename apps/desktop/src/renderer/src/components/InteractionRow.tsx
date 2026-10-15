// One timeline row for a handled server request (lib/interactionLog): collapsed a single compact
// line — 问：… → 答：… / 批准：命令 … / 拒绝：… / 已在别处处理：… — opened by click to the full
// question with every option and the selected one (the approval's subject and decision). Hidden
// with Settings → 对话 → 在时间线中保留已处理的交互 off.
import { useState } from "react";
import { Check, ChevronDown, ChevronRight, MessageCircleQuestion, MonitorSmartphone, X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { useUiPrefs } from "../lib/prefs";
import { choiceOf, glyphOf, questionAnswers, rowParts, type InteractionGlyph, type InteractionRecord } from "../lib/interactionLog";

const GLYPH_ICON: Record<InteractionGlyph, typeof Check> = {
  question: MessageCircleQuestion,
  approve: Check,
  reject: X,
  elsewhere: MonitorSmartphone,
};
const GLYPH_CLASS: Record<InteractionGlyph, string> = {
  question: "text-muted",
  approve: "text-accent",
  reject: "text-danger",
  elsewhere: "text-subtle",
};

/** The collapsed row's word — 问 / 批准 / 拒绝 / 已在别处处理, with its trailing colon (the type
 *  symbols of the task; the approval's exact variant — 本会话内都允许 etc. — shows expanded). */
const GLYPH_WORD: Record<InteractionGlyph, MessageKey> = {
  question: "interactionLog.question",
  approve: "interactionLog.approve",
  reject: "interactionLog.reject",
  elsewhere: "interactionLog.elsewhere",
};

/** The approval decision as the expanded row names it (choice label key or literal). */
function decisionLabel(record: InteractionRecord): { key: MessageKey } | { literal: string } | null {
  const choice = choiceOf(record);
  if (choice) return choice.literal ? { literal: choice.label } : { key: `interaction.choice.${choice.label}` as MessageKey };
  return null;
}

/** Several answers on one line: Chinese enumeration comma (、), or ", " otherwise. */
function joinAnswers(locale: string, values: string[]): string {
  return values.join(locale === "zh-CN" ? "、" : ", ");
}

/** One requestUserInput question with its options and the selected values. */
function QuestionDetail({ header, question, options, selected, isSecret }: { header: string; question: string; options: { label: string; description: string | null }[]; selected: string[]; isSecret: boolean }) {
  const { t, locale } = useI18n();
  const typed = selected.filter((value) => !options.some((o) => o.label === value));  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide">{header}</div>
      <p className="mb-1 text-xs whitespace-pre-wrap">{question}</p>
      {options.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {options.map((option) => {
            const picked = selected.includes(option.label);
            return (
              <li key={option.label} className={`flex items-start gap-1.5 text-xs ${picked ? "text-foreground" : "text-subtle"}`}>
                <span className="mt-0.5 w-3.5 shrink-0">{picked ? <Check size={12} className="text-accent" /> : null}</span>
                <span className="min-w-0">
                  {option.label}
                  {option.description && <span className="ml-1.5 text-subtle">{option.description}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs">
          <span className="mr-1.5">{t("interactionLog.answer")}</span>
          {selected.length ? (isSecret ? t("interactionLog.secret") : joinAnswers(locale, selected)) : t("interactionLog.none")}
        </p>
      )}
      {options.length > 0 && typed.length > 0 && (
        <p className="mt-1 text-xs">
          <span className="mr-1.5">{t("interactionLog.answer")}</span>
          {isSecret ? t("interactionLog.secret") : joinAnswers(locale, typed)}
        </p>
      )}
    </div>
  );
}

/** Everything the expanded row shows below the collapsed line. */
function InteractionDetail({ record }: { record: InteractionRecord }) {
  const { t } = useI18n();
  const asked = record.asked;
  if (!asked) return null;
  if (asked.kind === "questions") {
    const answers = questionAnswers(record);
    return (
      <div>
        {asked.questions.map((q) => (
          <QuestionDetail key={q.id} header={q.header} question={q.question} options={(q.options ?? []).map((o) => ({ label: o.label, description: o.description || null }))} selected={answers[q.id] ?? []} isSecret={q.isSecret} />
        ))}
      </div>
    );
  }
  if (asked.kind === "approval") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-medium">{t(`interactionLog.subject.${asked.title}` as MessageKey)}</div>
        {asked.reason && <p className="text-xs text-muted">{asked.reason}</p>}
        {asked.subject && <pre className="max-h-40 overflow-auto rounded-lg bg-background p-2 font-mono text-[11px] whitespace-pre-wrap">{asked.subject}</pre>}
        {record.settled.kind === "answered" && (
          <div className="text-xs">
            <span className="mr-1.5 text-muted">{t("interactionLog.decision")}</span>
            {(() => {
              const decision = decisionLabel(record);
              return decision ? ("key" in decision ? t(decision.key) : decision.literal) : "";
            })()}
          </div>
        )}
      </div>
    );
  }
  if (asked.kind === "elicitation") {
    const p = asked.params;
    const message = "message" in p ? p.message : "description" in p ? p.description : "";
    const url = "url" in p ? (p as { url: string }).url : null;
    const content = record.settled.kind === "answered" ? (record.settled.result as { content?: Record<string, unknown> | null } | null)?.content : null;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-medium">{t("interaction.title.elicitation", { server: p.serverName })}</div>
        {message && <p className="text-xs whitespace-pre-wrap">{message}</p>}
        {url && <span className="truncate font-mono text-[11px] text-subtle">{url}</span>}
        {content && Object.keys(content).length > 0 && (
          <pre className="max-h-40 overflow-auto rounded-lg bg-background p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(content, null, 2)}</pre>
        )}
      </div>
    );
  }
  return <p className="text-xs text-subtle">{t("interaction.unsupported", { method: asked.request.method })}</p>;
}

export function InteractionRow({ record }: { record: InteractionRecord }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  if (!useUiPrefs().timelineInteractions) return null;
  const glyph = glyphOf(record);
  const Icon = GLYPH_ICON[glyph];
  const parts = rowParts(record);
  // Questions: 问：… → 答：…; approvals carry the decision in their word (批准 / 拒绝).
  const answerValues = record.settled.kind === "answered" && record.asked?.kind === "questions" ? questionAnswers(record)[record.asked.questions[0]?.id ?? ""] ?? [] : [];
  const answer = answerValues.length > 0 ? joinAnswers(locale, answerValues) : null;
  // Permissions subjects are JSON blobs, not a readable line — the kind label stands in.
  const subject = parts.subject ?? (record.asked?.kind === "approval" ? t(`interactionLog.subject.${record.asked.title}` as MessageKey) : null);
  const elsewhere = record.settled.kind === "elsewhere";
  return (
    <div className="my-0.5 text-xs">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex max-w-full items-center gap-1.5 text-muted hover:text-foreground">
        <Icon size={13} className={`shrink-0 ${GLYPH_CLASS[glyph]}`} />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-medium">{t(GLYPH_WORD[glyph])}</span>
          {subject && <span className="min-w-0 truncate text-subtle" title={subject}>{subject}</span>}
          {answer && (
            <>
              <span className="shrink-0 text-subtle">→</span>
              <span className="min-w-0 truncate">
                {t("interactionLog.answer")}
                {answer}
              </span>
            </>
          )}
          {open ? <ChevronDown size={13} className="shrink-0 text-subtle" /> : <ChevronRight size={13} className="shrink-0 text-subtle" />}
        </span>
      </button>
      {open && (
        <div className="mt-1 mb-1.5 ml-1.5 flex flex-col gap-1.5 border-l border-border pl-3 text-muted">
          {elsewhere && <p className="text-xs text-subtle">{t("interactionLog.elsewhereNote")}</p>}
          <InteractionDetail record={record} />
        </div>
      )}
    </div>
  );
}
