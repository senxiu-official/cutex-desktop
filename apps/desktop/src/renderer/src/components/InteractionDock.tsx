import { questionDraftAnswer, questionAnswer, questionAnswers, questionDraftKey, questionSchemaIdentity, readQuestionDraft, writeQuestionDraft, type QuestionDraft, type QuestionDraftScope } from "../lib/questionDrafts";
import type { AgentRuntime } from "../lib/agentFeatures";
import { isImeComposing } from "../lib/ime";
// Docked interaction card above the composer (pattern from ZCode's V4InteractionDialogs /
// PermissionDialog / ElicitationDialog): shows the first pending server request, keyboard driven.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { ApprovalSource } from "./ApprovalSource";
import {
  approvalKeyAction,
  elicitationReply,
  formContent,
  formDefaults,
  formFields,
  formLimits,
  formProblems,
  questionsReply,
  questionTrim,
  toInteraction,
  type Choice,
  type FormValue,
  type FormValues,
  type InteractionModel,
  type PendingRequest,
} from "../lib/interactions";
import { btn } from "./Button";

const TONE: Record<Choice["tone"], string> = {
  primary: "bg-accent text-white",
  neutral: "border border-border hover:bg-surface-2",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};

/** Whether a new card takes the keyboard focus (false: a side agent's dock must not steal it from the main composer). */
const TakeFocus = createContext(true);

function Card({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const takeFocus = useContext(TakeFocus);
  useEffect(() => {
    if (takeFocus) ref.current?.focus();
  }, [takeFocus]);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="max-h-[min(60vh,36rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-4 shadow-lg outline-none"
    >
      {children}
    </div>
  );
}

function Approval({ model, runtime, onReply }: { model: Extract<InteractionModel, { kind: "approval" }>; runtime?: AgentRuntime; onReply: (result: unknown) => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(0);
  const pick = (i: number) => {
    const choice = model.choices[i];
    if (choice) onReply(choice.result);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(e)) return;
    // Esc picks only decline / cancel; with neither on offer it is left alone (lib/interactions).
    const action = approvalKeyAction(e.key, e.shiftKey, model, selected);
    if (!action) return;
    e.preventDefault();
    if ("pick" in action) pick(action.pick);
    else setSelected(action.select);
  };
  const escape = model.cancelIndex === null ? null : model.choices[model.cancelIndex];
  return (
    <Card onKeyDown={onKeyDown}>
      <div className="mb-2 flex items-start gap-2">
        <span className="min-w-0 flex-1 text-sm font-semibold">{t(`interaction.title.${model.title}` as MessageKey)}</span>
        <ApprovalSource source="native" runtime={runtime} />
      </div>
      {model.reason && <p className="mb-2 text-sm text-muted">{model.reason}</p>}
      {model.subject && (
        <pre className="selectable mb-2 max-h-48 overflow-auto rounded-lg bg-background p-2 font-mono text-xs whitespace-pre-wrap">{model.subject}</pre>
      )}
      {model.cwd && <p className="mb-3 font-mono text-caption/[inherit] text-subtle">{model.cwd}</p>}
      <div className="flex flex-col gap-1.5">
        {model.choices.map((choice, i) => (
          <button
            key={i}
            onClick={() => pick(i)}
            onMouseEnter={() => setSelected(i)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm ${TONE[choice.tone]} ${selected === i ? "ring-2 ring-accent/50" : ""}`}
          >
            <span className="w-4 text-xs opacity-60">{i + 1}</span>
            <span className="min-w-0">
              {choice.literal ? choice.label : t(`interaction.choice.${choice.label}` as MessageKey)}
              {choice.detail && <span className="block truncate font-mono text-caption/[inherit] opacity-70" title={choice.detail}>{choice.detail}</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-caption/[inherit] text-subtle">
        {t("interaction.keys")}
        {escape && ` · ${t(escape.label === "cancel" ? "interaction.escCancel" : "interaction.escDecline")}`}
      </p>
    </Card>
  );
}

function LegacyQuestions({ model, draftKey, onReply }: { model: Extract<InteractionModel, { kind: "questions" }>; draftKey: string | null; onReply: (result: unknown) => void }) {
  const { t } = useI18n();
  const takeFocus = useContext(TakeFocus);
  const [draft, setDraft] = useState(() => readQuestionDraft(draftKey, model.questions));
  const index = draft.index;
  const question = model.questions[index];
  if (!question) return null;
  const other = questionDraftAnswer(draft, question.id)?.text ?? "";
  const options = question.options ?? [];
  const last = index === model.questions.length - 1;
  const save = (next: QuestionDraft) => {
    writeQuestionDraft(draftKey, next, model.questions);
    setDraft(next);
  };
  const setIndex = (index: number) => save({ ...draft, index });
  const setOther = (text: string) => save({ ...draft, answers: { ...draft.answers, [question.id]: { selected: [], text } } });
  const answer = (values: string[], freeText = false) => {
    const label = values[0]!;
    const next = { ...draft, answers: { ...draft.answers, [question.id]: !freeText && options.some(o => o.label === label) ? { selected: values, text: "" } : { selected: [], text: label } } };
    if (last) {
      save(next);
      // A restored/corrupt draft must never send missing prior answers as [].
      const answers = questionAnswers(model.questions, next);
      if (!answers) return;
      onReply(questionsReply(answers));
    } else save({ ...next, index: index + 1 });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(e)) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const n = Number(e.key);
    if (n >= 1 && n <= options.length) {
      e.preventDefault();
      answer([options[n - 1]!.label]);
    } else if (e.key === "Escape" && index > 0) {
      e.preventDefault();
      setIndex(index - 1);
    }
  };
  return (
    <Card onKeyDown={onKeyDown}>
      <div className="mb-1 flex items-center text-xs text-subtle">
        <span className="font-semibold uppercase tracking-wide">{question.header}</span>
        {model.questions.length > 1 && <span className="ml-auto">{index + 1} / {model.questions.length}</span>}
        <ApprovalSource source="model" className={model.questions.length > 1 ? "ml-2" : "ml-auto"} />
      </div>
      <p className="selectable mb-3 text-sm whitespace-pre-wrap">{question.question}</p>
      <div className="flex flex-col gap-1.5">
        {options.map((option, i) => (
          <button key={option.label} onClick={() => answer([option.label])} className="rounded-lg border border-border px-3 py-1.5 text-left hover:bg-surface-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-4 text-xs opacity-60">{i + 1}</span>
              {option.label}
            </div>
            {option.description && <div className="pl-6 text-xs text-muted">{option.description}</div>}
          </button>
        ))}
        {(question.isOther || options.length === 0) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (questionTrim(other)) answer([questionTrim(other)], true);
            }}
            className="flex gap-2"
          >
            <input
              autoFocus={options.length === 0 && takeFocus}
              type={question.isSecret ? "password" : "text"}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder={t("interaction.other")}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <button type="submit" disabled={!questionTrim(other)} className={btn({ variant: "primary" })}>
              {last ? t("interaction.submit") : t("interaction.next")}
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}


function Questions({ model, draftKey, onReply }: { model: Extract<InteractionModel, { kind: "questions" }>; draftKey: string | null; onReply: (result: unknown) => void }) {
  const { t } = useI18n();
  const takeFocus = useContext(TakeFocus);
  const [draft, setDraft] = useState(() => readQuestionDraft(draftKey, model.questions));
  const question = model.questions[draft.index];
  if (!question) return null;
  const current = questionDraftAnswer(draft, question.id) ?? { selected: [], text: "" };
  const options = question.options ?? [];
  const enhanced = !!question.cutexQuestionOptions;
  const multi = question.cutexQuestionOptions?.multiSelect === true;
  const last = draft.index === model.questions.length - 1;
  const values = questionAnswer(question, current);
  const all = questionAnswers(model.questions, draft);
  const valid = !!values && (!last || !!all);
  const save = (next: QuestionDraft) => {
    // Write synchronously in the input event: a reload/unmount cannot race an effect.
    writeQuestionDraft(draftKey, next, model.questions);
    setDraft(next);
  };
  const edit = (value: typeof current) => save({ ...draft, answers: { ...draft.answers, [question.id]: value } });
  const advance = (next: QuestionDraft) => {
    if (!questionAnswer(question, questionDraftAnswer(next, question.id) ?? current)) return;
    if (last) {
      const answers = questionAnswers(model.questions, next);
      if (!answers) return;
      save(next);
      onReply(questionsReply(answers));
    } else save({ ...next, index: draft.index + 1 });
  };
  const pick = (label: string) => {
    if (!enhanced) {
      advance({ ...draft, answers: { ...draft.answers, [question.id]: { selected: [label], text: "" } } });
    } else edit({ selected: multi ? current.selected.includes(label) ? current.selected.filter(v => v !== label) : [...current.selected, label] : [label], text: multi ? current.text : "" });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(e) || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const target = e.target as HTMLElement;
    if (target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-question-option]")];
      if (buttons.length) {
        const index = buttons.indexOf(target as HTMLButtonElement);
        const next = index < 0 ? (e.key === "ArrowDown" ? 0 : buttons.length - 1) : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        e.preventDefault(); buttons[next]!.focus();
      }
      return;
    }
    const n = Number(e.key);
    if (/^[1-9]$/.test(e.key) && n <= options.length) {
      e.preventDefault(); pick(options[n - 1]!.label);
    } else if (e.key === "Escape" && draft.index > 0) {
      e.preventDefault(); save({ ...draft, index: draft.index - 1 });
    }
  };
  return (
    <Card onKeyDown={onKeyDown}>
      <div className="mb-1 flex items-center text-xs text-subtle">
        <span className="font-semibold uppercase tracking-wide">{question.header}</span>
        {model.questions.length > 1 && <span className="ml-auto">{draft.index + 1} / {model.questions.length}</span>}
        <ApprovalSource source="model" className="ml-auto" />
      </div>
      <p className="selectable mb-3 text-sm whitespace-pre-wrap">{question.question}</p>
      {multi && <p className="mb-2 text-xs text-muted">{t("interaction.multiSelect")}</p>}
      <div className="flex flex-col gap-1.5">
        {options.map((option, i) => (
          <div key={option.label}>
            <button data-question-option type="button" aria-pressed={enhanced ? current.selected.includes(option.label) : undefined} onClick={() => pick(option.label)} className={`w-full rounded-lg border px-3 py-1.5 text-left hover:bg-surface-2 ${enhanced && current.selected.includes(option.label) ? "border-accent bg-accent/10" : "border-border"}`}>
              <div className="flex items-center gap-2 text-sm"><span className="w-4 text-xs opacity-60">{i + 1}</span>{option.label}</div>
              {option.description && <div className="pl-6 text-xs text-muted">{option.description}</div>}
            </button>
            {question.cutexQuestionOptions?.options[i]?.preview && <details className="px-3 py-1 text-xs text-muted">
              <summary className="cursor-pointer">{t("interaction.preview")}</summary>
              <pre className="selectable max-h-64 overflow-auto whitespace-pre-wrap break-words">{question.cutexQuestionOptions.options[i]!.preview}</pre>
            </details>}
          </div>
        ))}
        <form onSubmit={e => { e.preventDefault(); advance(draft); }} onKeyDown={e => { if (isImeComposing(e) && e.key === "Enter") e.preventDefault(); }} className="space-y-2">
          {(question.isOther || options.length === 0) && <input
            aria-label={t("interaction.other")}
            autoFocus={options.length === 0 && takeFocus}
            type={question.isSecret ? "password" : "text"}
            value={current.text}
            onChange={e => edit({ selected: multi ? current.selected : [], text: e.target.value })}
            placeholder={t("interaction.other")}
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
          />}
          <div className="flex items-center gap-2">
            {draft.index > 0 && <button type="button" onClick={() => save({ ...draft, index: draft.index - 1 })} className={btn({})}>{t("interaction.back")}</button>}
            {(enhanced || question.isOther || options.length === 0) && <button type="submit" disabled={!valid} className={btn({ variant: "primary" })}>{last ? t("interaction.submit") : t("interaction.next")}</button>}
            {enhanced && !valid && (current.selected.length > 0 || current.text.length > 0) && <span role="status" className="text-xs text-muted">{t("interaction.invalidAnswer")}</span>}
          </div>
        </form>
      </div>
    </Card>
  );
}

function Elicitation({ model, onReply }: { model: Extract<InteractionModel, { kind: "elicitation" }>; onReply: (result: unknown) => void }) {
  const { t } = useI18n();
  const p = model.params;
  const schema = "requestedSchema" in p ? p.requestedSchema : null;
  const fields = useMemo(() => formFields(schema), [schema]);
  // Schema defaults up front; an untouched checkbox is sent as false.
  const [values, setValues] = useState<FormValues>(() => formDefaults(fields));
  const message = "message" in p ? p.message : "description" in p ? p.description : "";
  const url = "url" in p ? (p as { url: string }).url : null;
  const problems = formProblems(fields, values);
  const blocked = Object.keys(problems).length > 0;
  const setValue = (name: string, value: FormValue) => setValues((v) => ({ ...v, [name]: value }));
  const text = (name: string) => (typeof values[name] === "string" ? (values[name] as string) : "");
  const list = (name: string) => (Array.isArray(values[name]) ? (values[name] as string[]) : []);

  const accept = () => {
    if (!blocked) onReply(elicitationReply("accept", formContent(fields, values)));
  };
  return (
    <Card onKeyDown={(e) => !isImeComposing(e) && (e.key === "Escape" && onReply(elicitationReply("cancel")))}>
      <div className="mb-1 flex items-center gap-2 text-xs text-subtle">
        <span className="min-w-0 flex-1">{t("interaction.title.elicitation", { server: p.serverName })}</span>
        <ApprovalSource source="mcp" />
      </div>
      {message && <p className="selectable mb-3 text-sm whitespace-pre-wrap">{message}</p>}
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="mb-3 block truncate text-sm text-accent underline">
          {url}
        </a>
      )}
      <div className="mb-3 flex flex-col gap-2">
        {fields.map((f) => {
          const invalid = problems[f.name] === "invalid";
          const limits = formLimits(f);
          const border = invalid ? "border-danger" : "border-border";
          // A checkbox group cannot sit inside a <label>.
          const Wrapper = f.type === "multi" ? "div" : "label";
          return (
            <Wrapper key={f.name} className="text-sm">
              <span className="mb-0.5 block text-xs text-muted">
                {f.title}
                {f.required && " *"}
              </span>
              {f.type === "boolean" ? (
                <input type="checkbox" checked={values[f.name] === true} onChange={(e) => setValue(f.name, e.target.checked)} />
              ) : f.type === "multi" ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {f.options.map((o) => (
                    <label key={o.value} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={list(f.name).includes(o.value)}
                        onChange={(e) => setValue(f.name, e.target.checked ? [...list(f.name), o.value] : list(f.name).filter((v) => v !== o.value))}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              ) : f.type === "enum" ? (
                <select value={text(f.name)} onChange={(e) => setValue(f.name, e.target.value)} className={`w-full rounded-lg border ${border} bg-background px-2 py-1`}>
                  <option value="" />
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  value={text(f.name)}
                  onChange={(e) => setValue(f.name, e.target.value)}
                  {...(f.type === "number"
                    ? { step: f.integer ? 1 : "any", min: f.min ?? undefined, max: f.max ?? undefined }
                    : { maxLength: f.max ?? undefined })}
                  className={`w-full rounded-lg border ${border} bg-background px-2 py-1 outline-none focus:border-accent`}
                />
              )}
              {invalid && (
                <span className="block text-caption/[inherit] text-danger">{limits ? t("interaction.form.invalidLimits", { limits }) : t("interaction.form.invalid")}</span>
              )}
              {f.description && <span className="text-caption/[inherit] text-subtle">{f.description}</span>}
            </Wrapper>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={accept} disabled={blocked} className={btn({ variant: "primary" })}>
          {t("interaction.choice.accept")}
        </button>
        <button onClick={() => onReply(elicitationReply("decline"))} className="rounded-lg border border-border px-3 py-1.5 text-sm">
          {t("interaction.choice.decline")}
        </button>
        {Object.values(problems).includes("required") && <span className="text-caption/[inherit] text-subtle">{t("interaction.form.required")}</span>}
      </div>
    </Card>
  );
}

export function InteractionDock({
  pending,
  onReply,
  takeFocus = true,
  runtime,
  optionsV1 = false,
  draftScope,
}: {
  pending: PendingRequest[];
  optionsV1?: boolean;
  draftScope?: QuestionDraftScope;
  /** The agent's runtime: names whose sandbox asks (DSH's own approvals are not Codex's). */
  runtime?: AgentRuntime;
  onReply: (request: PendingRequest, reply: { result: unknown } | { error: { code: number; message: string } }) => void;
  /** A new card takes the keyboard focus (default); the side agent view passes false. */
  takeFocus?: boolean;
}) {
  const { t } = useI18n();
  const first = pending[0];
  if (!first) return null;
  const model = toInteraction(first, optionsV1);
  const draftKey = model.kind === "questions" ? questionDraftKey(draftScope, first, model.questions) : null;
  const questionKey = model.kind === "questions" ? JSON.stringify([draftKey, first.id, questionSchemaIdentity(model.questions)]) : null;
  const reply = (result: unknown) => onReply(first, { result });
  return (
    <TakeFocus.Provider value={takeFocus}>
    <div data-gutter-anchor="dock" className="side-col side-col-composer w-full px-4 pb-2">
      {pending.length > 1 && <p className="mb-1 text-caption/[inherit] text-subtle">{t("pending.title", { count: pending.length })}</p>}
      {model.kind === "approval" && <Approval key={String(first.id)} model={model} runtime={runtime} onReply={reply} />}
      {model.kind === "questions" && (model.questions.some(q => q.cutexQuestionOptions)
        ? <Questions key={questionKey} draftKey={draftKey} model={model} onReply={reply} />
        : <LegacyQuestions key={questionKey} draftKey={draftKey} model={model} onReply={reply} />)}
      {model.kind === "elicitation" && <Elicitation key={String(first.id)} model={model} onReply={reply} />}
      {model.kind === "unknown" && (
        <Card>
          <p className="mb-2 text-sm">{t("interaction.unsupported", { method: first.method })}</p>
          <button
            onClick={() => onReply(first, { error: { code: -32601, message: "unsupported by cutex-desktop" } })}
            className="rounded-lg border border-border px-3 py-1.5 text-sm"
          >
            {t("interaction.choice.decline")}
          </button>
        </Card>
      )}
    </div>
    </TakeFocus.Provider>
  );
}
