// 输入优化 in one input box: start (selection or whole draft) with a template, the request in flight, its versions
// (第 N 版: each answer, each 直接加上, each 重新整理 adds one; ‹ › switches), cancel (Esc: main aborts the Management
// request, which cancels the provider call in cutex) and adoption of the shown version (./rewrite.ts).
// v1 hosts (text-rewrite-v1): the prompt-enhance call with this desktop's route; its missingDetails become checkable
// suggestions that need the owner's words. v2 hosts (text-rewrite-v2): the template's own route on the host, the
// structured answer (suggestions, corrections) and 重新整理 (a stateless follow-up round).
// A request that is cancelled, replaced, or outlived by its input box (agent switched, unmounted) is dropped quietly.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonApi } from "../../../../shared/ipc";
import type { TextRewriteAttempt, TextRewriteErrorCode, TextRewriteRoute, TextRewriteUsed } from "../../../../shared/textRewrite";
import { TEXT_REWRITE_MAX_BYTES, utf8Bytes } from "../../../../shared/textRewrite";
import type { RewriteCorrection, RewriteProtection, RewriteSuggestion, RewriteTemplateKind, StructuredRewriteResult } from "../../../../shared/textRewriteV2";
import { adoptRewrite, appendSuggestions, applyCorrections, chooseCorrection, enhanceTarget, type EnhanceTarget } from "./rewrite";

/** The template a run uses. `v2` false: the v1 prompt-enhance call (route from this desktop). */
export interface TemplateRef { id: string; kind: RewriteTemplateKind; v2: boolean }

export interface RewriteVersion {
  /** The model's text (for a correction template: the suggested replacements applied). */
  text: string;
  suggestions: RewriteSuggestion[];
  corrections: RewriteCorrection[];
  /** null: 直接加上 (no model call). */
  used: TextRewriteUsed | null;
  /** 取决于你的意思: the owner's pick per change index (alternative index; rewrite.ts correctionEdits). */
  choices: Record<number, number>;
  /** cutex left out this many of the model's changes (they did not fit the text). */
  dropped: number;
  /**
   * cutex r297: what the next 重新整理 of this version sends back (opaque; never shown or logged). A 直接加上 version
   * keeps its source's. Dropped with the panel, and once the draft changed outside the panel.
   */
  protection?: RewriteProtection;
  /**
   * 直接加上 versions: the model version they were made from and the items appended so far (with the owner's words).
   * Their 重新整理 refines that version with these as answers, so the host masks and registers what the owner wrote.
   */
  base?: { text: string; suggestions: RewriteSuggestion[]; answers: { id: string; text?: string }[] };
}

/** selectionMoved: the selected part is no longer in the draft as it was; never widened to the whole draft. */
export type FailCode = TextRewriteErrorCode | "empty" | "tooLong" | "noRoute" | "selectionMoved" | "blankSelection";

interface Shown {
  target: EnhanceTarget; template: TemplateRef; versions: RewriteVersion[]; shown: number;
  /**
   * A fresh first round instead of a 重新整理: restarted — the draft changed on a host that issues protection;
   * protectionExpired — the host no longer accepted the protection (e.g. it restarted).
   */
  notice?: "restarted" | "protectionExpired";
}
export type EnhanceState =
  | { phase: "idle" }
  | ({ phase: "running"; requestId: string } & Shown)
  | ({ phase: "done"; draftChanged: boolean } & Shown)
  | ({ phase: "failed"; code: FailCode; attempts: TextRewriteAttempt[] } & Omit<Shown, "target"> & { target: EnhanceTarget | null });

const IDLE: EnhanceState = { phase: "idle" };

/** The text a version puts into the draft (a correction version: with the owner's picks). */
export function versionText(state: { target: EnhanceTarget | null }, v: RewriteVersion): string {
  return v.corrections.length && state.target ? applyCorrections(state.target.text, v.corrections, v.choices) : v.text;
}

/** The version shown, if any. */
export function shownVersion(state: EnhanceState): RewriteVersion | null {
  return state.phase === "idle" ? null : state.versions[state.shown] ?? null;
}

function newRequestId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `pe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface RewriteCall {
  api: () => DaemonApi;
  /** v1 only: the route this desktop chose for the host (null = none chosen). */
  route: () => TextRewriteRoute | null;
  sessionId: string | null;
  uiLanguage: string;
  /** The input box's text now (a fresh round after an expired protection starts from it). */
  draft?: () => string;
}

export interface PromptEnhance {
  state: EnhanceState;
  /** Something is shown (running, answer or failure): Enter / Esc belong to it. */
  active: boolean;
  start(draft: string, selStart: number | null | undefined, selEnd: number | null | undefined, template: TemplateRef): void;
  /** The shown template again on `draft`: the whole draft, or the same selected part only while it is still there. */
  restart(draft: string): void;
  /**
   * 重新整理 (v2): ask again from the shown version with the checked suggestions (and what the owner typed), sending
   * that version's protection back. `draft`: the input box now. Changed outside the panel: every protection is
   * dropped, and on a host that issues protection this becomes a fresh first round of the current draft (notice
   * "restarted") — never a follow-up without it. Hosts that never sent one keep the follow-up without the field.
   */
  regroup(answers: readonly { id: string; text?: string }[], draft: string): void;
  /** 直接加上: a new version with the checked suggestions appended under `label`, no model call. */
  append(picks: readonly { id: string; text?: string }[], label: string): void;
  /** ‹ ›: show another version. */
  show(index: number): void;
  /** 取决于你的意思: pick a replacement for change `index` of the shown version (null: back to the suggestion). */
  choose(index: number, alt: number | null): void;
  /** Esc / 取消: drop the request in flight (versions stay), else close. */
  cancel(): void;
  /** Close everything (the request in flight is cancelled). */
  close(): void;
  /** The shown version's text and where it goes, or null (nothing to adopt). The caller replaces; see `adopted`. */
  adoption(): { start: number; end: number; text: string; expected: string; whole: boolean } | null;
  /** After the caller's replace: true closes, false says the draft changed there. */
  adopted(ok: boolean): void;
}

/** `call` is read when a request starts; `scope` (host + agent) changing drops everything. */
export function usePromptEnhance(call: RewriteCall, scope: string): PromptEnhance {
  const [state, setState] = useState<EnhanceState>(IDLE);
  const live = useRef<{ requestId: string; api: DaemonApi } | null>(null);
  const callRef = useRef(call);
  callRef.current = call;
  const stateRef = useRef(state);
  stateRef.current = state;
  /** A reply in this panel carried protection (cutex r297): this host protects across rounds. */
  const issued = useRef(false);

  const drop = useCallback(() => {
    const cur = live.current;
    live.current = null;
    if (cur) try { void Promise.resolve(cur.api.cancelTextRewrite(cur.requestId)).catch(() => {}); } catch { /* best effort */ }
  }, []);

  // Another agent / host, or the input box goes away: the request is not this draft's any more.
  useEffect(() => {
    setState(IDLE);
    return drop;
  }, [scope, drop]);

  /** One request; its answer becomes a new version after `prior` (failure keeps `prior`). */
  const run = useCallback((target: EnhanceTarget, template: TemplateRef, prior: RewriteVersion[], shownBefore: number, followUp?: { previous: RewriteVersion; answers: readonly { id: string; text?: string }[] }, notice?: Shown["notice"], onProtectionInvalid?: () => void) => {
    drop();
    const c = callRef.current;
    const keep = { target, template, versions: prior, shown: shownBefore, ...(notice ? { notice } : {}) };
    let route: TextRewriteRoute | null = null;
    if (!template.v2) {
      route = c.route();
      if (!route) return setState({ phase: "failed", code: "noRoute", attempts: [], ...keep });
    }
    const daemon = c.api();
    const requestId = newRequestId();
    live.current = { requestId, api: daemon };
    setState({ phase: "running", requestId, ...keep });
    const settle = (result: StructuredRewriteResult) => {
      if (live.current?.requestId !== requestId) return;
      live.current = null;
      if (!result.ok && result.code === "rewrite_protection_invalid" && onProtectionInvalid) return onProtectionInvalid();
      if (!result.ok) return setState({ phase: "failed", code: result.code, attempts: result.attempts, ...keep });
      const version: RewriteVersion = { text: result.text, suggestions: result.suggestions, corrections: result.corrections, used: result.used, choices: {}, dropped: result.droppedCorrections ?? 0, ...(result.protection ? { protection: result.protection } : {}) };
      if (result.protection) issued.current = true;
      setState({ phase: "done", draftChanged: false, ...keep, versions: [...prior, version], shown: prior.length });
    };
    Promise.resolve()
      .then(async (): Promise<StructuredRewriteResult> => {
        // Cancelled (or replaced) before the call went out: never issue it. Main also refuses an id it saw cancelled.
        if (live.current?.requestId !== requestId) return { ok: false, code: "cancelled", attempts: [] };
        if (template.v2) {
          return daemon.structuredTextRewrite({
            requestId, templateId: template.id, uiLanguage: c.uiLanguage, text: target.text,
            ...(c.sessionId ? { sessionId: c.sessionId } : {}),
            ...(followUp ? { followUp: { previous: { text: followUp.previous.text, suggestions: followUp.previous.suggestions }, answers: [...followUp.answers] } } : {}),
            ...(followUp?.previous.protection ? { protection: followUp.previous.protection } : {}),
          });
        }
        const r = await daemon.textRewrite({ requestId, text: target.text, route: route! });
        return r.ok
          ? { ok: true, text: r.rewrittenText, suggestions: r.missingDetails.map((text, i) => ({ id: `m${i + 1}`, text, needsInput: true })), corrections: [], used: r.used }
          : r;
      })
      .then(settle, () => settle({ ok: false, code: "failed", attempts: [] }));
  }, [drop]);

  const start = useCallback((draft: string, selStart: number | null | undefined, selEnd: number | null | undefined, template: TemplateRef, notice?: Shown["notice"]) => {
    drop();
    issued.current = false;
    const target = enhanceTarget(draft, selStart, selEnd);
    if (!target || target === "blankSelection") return setState({ phase: "failed", target: null, template, versions: [], shown: 0, code: target ?? "empty", attempts: [] });
    if (utf8Bytes(target.text) > TEXT_REWRITE_MAX_BYTES) return setState({ phase: "failed", target, template, versions: [], shown: 0, code: "tooLong", attempts: [] });
    run(target, template, [], 0, undefined, notice);
  }, [drop, run]);

  /** The draft changed outside the panel: no version's protection goes out any more (see regroup). */
  const dropProtections = useCallback(() => {
    setState((s) => (s.phase === "idle" || !s.versions.some((v) => v.protection) ? s : { ...s, versions: s.versions.map(({ protection: _, ...v }) => v) }));
  }, []);

  /**
   * A fresh first round from `draft` (instead of a 重新整理): the whole draft when the target was the whole draft; the
   * same selected part only while it is still there exactly — never widened: otherwise ask for a new selection.
   */
  const restart = useCallback((draft: string, notice?: Shown["notice"]) => {
    const s = stateRef.current;
    if (s.phase === "idle" || !s.target) return;
    const t = s.target;
    if (t.whole) return start(draft, null, null, s.template, notice);
    if (draft.slice(t.start, t.end) === t.text) return start(draft, t.start, t.end, s.template, notice);
    drop();
    setState({ phase: "failed", code: "selectionMoved", attempts: [], target: t, template: s.template, versions: s.versions, shown: s.shown });
  }, [drop, start]);

  const regroup = useCallback((answers: readonly { id: string; text?: string }[], draft: string) => {
    const s = stateRef.current;
    const v = shownVersion(s);
    if (s.phase === "idle" || s.phase === "running" || !s.target || !v || !s.template.v2 || !answers.length) return;
    const t = s.target;
    const moved = draft.slice(t.start, t.end) !== t.text || (t.whole && draft.length !== t.end);
    if (moved) dropProtections();
    const protection = moved ? undefined : v.protection;
    // This host protects links / code across rounds: a follow-up without it would hand earlier rounds' protected
    // text to the model as plain text. Start over instead.
    if (!protection && issued.current) return restart(draft, "restarted");
    // The follow-up starts from what the owner sees; its suggestions are the shown ones. A 直接加上 version refines the
    // model version it came from, its appended items sent as answers (the host masks and registers the owner's words).
    const answered = new Set(answers.map((a) => a.id));
    const previous: RewriteVersion = v.base
      ? { ...v, text: v.base.text, suggestions: v.base.suggestions }
      : { ...v, text: versionText(s, v) };
    const all = v.base ? [...v.base.answers.filter((a) => !answered.has(a.id)), ...answers] : [...answers];
    const { protection: _, base: __, ...sent } = previous;
    const latest = () => callRef.current.draft?.() ?? draft;
    run(t, s.template, s.versions, s.shown, { previous: { ...sent, ...(protection ? { protection } : {}) }, answers: all }, undefined,
      protection ? () => { dropProtections(); restart(latest(), "protectionExpired"); } : undefined);
  }, [run, restart, dropProtections]);

  const append = useCallback((picks: readonly { id: string; text?: string }[], label: string) => {
    setState((s) => {
      const v = shownVersion(s);
      if (s.phase === "idle" || !v || !picks.length) return s;
      const byId = new Map(v.suggestions.map((x) => [x.id, x]));
      const lines = picks.flatMap((p) => { const x = byId.get(p.id); return x ? [{ text: x.text, answer: p.text }] : []; });
      if (!lines.length) return s;
      const picked = new Set(picks.map((p) => p.id));
      const added = picks.filter((p) => byId.has(p.id)).map((p) => (p.text?.trim() ? { id: p.id, text: p.text } : { id: p.id }));
      const base = v.base ? { ...v.base, answers: [...v.base.answers, ...added] } : { text: versionText(s, v), suggestions: v.suggestions, answers: added };
      const next: RewriteVersion = { text: appendSuggestions(versionText(s, v), lines, label), suggestions: v.suggestions.filter((x) => !picked.has(x.id)), corrections: [], used: null, choices: {}, dropped: 0, base, ...(v.protection ? { protection: v.protection } : {}) };
      const versions = [...s.versions, next];
      return s.phase === "running" ? { ...s, versions } : { ...s, phase: "done", draftChanged: false, versions, shown: versions.length - 1 } as EnhanceState;
    });
  }, []);

  const show = useCallback((index: number) => {
    setState((s) => (s.phase === "idle" || index < 0 || index >= s.versions.length ? s : { ...s, shown: index, ...(s.phase === "done" ? { draftChanged: false } : {}) }));
  }, []);

  /** 取决于你的意思: change `index` uses alternative `alt` (null: as suggested). */
  const choose = useCallback((index: number, alt: number | null) => {
    setState((s) => {
      const v = shownVersion(s);
      if (s.phase === "idle" || !v || !v.corrections[index]) return s;
      const choices = chooseCorrection(v.corrections, v.choices, index, alt);
      return { ...s, versions: s.versions.map((x, i) => (i === s.shown ? { ...x, choices } : x)) };
    });
  }, []);

  const close = useCallback(() => {
    drop();
    setState(IDLE);
  }, [drop]);

  const cancel = useCallback(() => {
    const s = stateRef.current;
    // 重新整理 in flight: only that request goes; the versions stay.
    if (s.phase === "running" && s.versions.length) {
      drop();
      setState({ phase: "done", draftChanged: false, target: s.target, template: s.template, versions: s.versions, shown: s.shown });
      return;
    }
    close();
  }, [drop, close]);

  const adoption = useCallback(() => {
    const s = stateRef.current;
    const v = shownVersion(s);
    if (s.phase === "idle" || !v || !s.target) return null;
    return { start: s.target.start, end: s.target.end, text: versionText(s, v), expected: s.target.text, whole: s.target.whole };
  }, []);

  const adopted = useCallback((ok: boolean) => {
    if (ok) return close();
    dropProtections();
    setState((s) => (s.phase === "done" ? { ...s, draftChanged: true } : s));
  }, [close, dropProtections]);

  return { state, active: state.phase !== "idle", start, restart: (draft: string) => restart(draft), regroup, append, show, choose, cancel, close, adoption, adopted };
}

/** The draft with the shown version in place (pure; tests and callers without a replace). */
export function adoptShown(draft: string, state: EnhanceState): { text: string; caret: number } | null {
  const v = shownVersion(state);
  if (state.phase === "idle" || !v || !state.target) return null;
  return adoptRewrite(draft, state.target, versionText(state, v));
}
