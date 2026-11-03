import { questionTrim, questionUtf8Size, type InteractionQuestion, type PendingRequest } from "./interactions";

export interface QuestionDraftScope { hostId: string; sessionId: string; runtimeGeneration: number }
export interface QuestionAnswerDraft { selected: string[]; text: string }
export interface QuestionDraft { index: number; answers: Record<string, QuestionAnswerDraft> }
/** Native question IDs may name Object.prototype properties. */
export function questionDraftAnswer(draft: QuestionDraft, id: string): QuestionAnswerDraft | undefined {
  return Object.hasOwn(draft.answers, id) ? draft.answers[id] : undefined;
}
const PREFIX = "cutex.question-draft.v2:";

/** Answer-relevant identity only. Presentation edits do not invalidate a draft. */
export function questionSchemaIdentity(questions: InteractionQuestion[]): string {
  return JSON.stringify(questions.map(q => [q.id, q.question, q.isOther, q.isSecret,
    q.options?.map(o => o.label) ?? null,
    q.cutexQuestionOptions ? [1, q.cutexQuestionOptions.multiSelect] : null,
  ]));
}

/** A bounded synchronous index, never trusted as identity. Reads compare the full schema
 * kept in the value before restoring anything, including under a hash collision.
 */
function schemaDigest(schema: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < schema.length; i++) {
    a = Math.imul(a ^ schema.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ schema.charCodeAt(i), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/** Exact host/session/generation + typed native ID and native thread/turn/item scope.
 * Old scopes stay inert: UI absence or void reply never proves terminal completion.
 */
export function questionDraftKey(scope: QuestionDraftScope | undefined, request: PendingRequest, questions: InteractionQuestion[]): string | null {
  if (!scope?.hostId || !scope.sessionId || !Number.isSafeInteger(scope.runtimeGeneration) || scope.runtimeGeneration < 1) return null;
  const p = request.params && typeof request.params === "object" ? request.params as Record<string, unknown> : {};
  const nativeScope = [p.threadId, p.turnId, p.itemId].map(v => typeof v === "string" ? v : null);
  return PREFIX + JSON.stringify([scope.hostId, scope.sessionId, scope.runtimeGeneration, request.id, ...nativeScope, schemaDigest(questionSchemaIdentity(questions))]);
}
export function readQuestionDraft(key: string | null, questions: InteractionQuestion[]): QuestionDraft {
  const empty: QuestionDraft = { index: 0, answers: {} };
  if (!key) return empty;
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!stored || stored.schema !== questionSchemaIdentity(questions)) return empty;
    const raw = stored.draft;
    if (!raw || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= questions.length || !raw.answers || typeof raw.answers !== "object") return empty;
    const entries: [string, QuestionAnswerDraft][] = [];
    for (const q of questions) {
      const a = Object.hasOwn(raw.answers, q.id) ? raw.answers[q.id] : undefined;
      if (a) {
        if (!Array.isArray(a.selected) || a.selected.some((v: unknown) => typeof v !== "string") || typeof a.text !== "string") return empty;
        entries.push([q.id, a]);
      }
    }
    const answers = Object.fromEntries(entries);
    const firstUnanswered = questions.findIndex((q, i) => i < raw.index && !questionAnswer(q, questionDraftAnswer({ index: raw.index, answers }, q.id) ?? { selected: [], text: "" }));
    return { index: firstUnanswered < 0 ? raw.index : firstUnanswered, answers };
  } catch { return empty; }
}
export function writeQuestionDraft(key: string | null, draft: QuestionDraft, questions: InteractionQuestion[]): void {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({ schema: questionSchemaIdentity(questions), draft })); } catch { /* Keep the live draft when storage is unavailable. */ }
}
export function questionAnswer(q: InteractionQuestion, draft: QuestionAnswerDraft): string[] | null {
  const options = q.options ?? [];
  const selected = draft.selected.map(questionTrim);
  if (selected.some(v => !options.some(o => questionTrim(o.label) === v))) return null;
  const text = questionTrim(draft.text);
  if (text && options.length && !q.isOther) return null;
  const values = [...selected, ...(text ? [text] : [])];
  if (!values.length || values.some(v => !questionTrim(v) || questionUtf8Size(v) > 65536) || new Set(values).size !== values.length) return null;
  if (!q.cutexQuestionOptions?.multiSelect && values.length !== 1) return null;
  return values;
}
export function questionAnswers(questions: InteractionQuestion[], draft: QuestionDraft): Record<string, string[]> | null {
  const entries: [string, string[]][] = [];
  let bytes = 0;
  for (const q of questions) {
    const values = questionAnswer(q, questionDraftAnswer(draft, q.id) ?? { selected: [], text: "" });
    if (!values) return null;
    bytes += values.reduce((n, v) => n + questionUtf8Size(v), 0);
    entries.push([q.id, values]);
  }
  return bytes <= 262144 ? Object.fromEntries(entries) : null;
}
