// 提示词增强 in one composer: start (selection or whole draft), the request in flight, its answer, cancel (Esc:
// main aborts the Management request, which cancels the provider call in cutex) and adoption (lib/promptEnhance.ts).
// A request that is cancelled, replaced, or outlived by its composer (agent switched, unmounted) is dropped quietly.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonApi } from "../../../shared/ipc";
import type { TextRewriteAttempt, TextRewriteErrorCode, TextRewriteResult, TextRewriteRoute, TextRewriteUsed } from "../../../shared/textRewrite";
import { TEXT_REWRITE_MAX_BYTES, utf8Bytes } from "../../../shared/textRewrite";
import { adoptRewrite, enhanceTarget, type EnhanceTarget } from "./promptEnhance";

export type EnhanceState =
  | { phase: "idle" }
  | { phase: "running"; requestId: string; target: EnhanceTarget }
  | { phase: "done"; target: EnhanceTarget; rewrittenText: string; missingDetails: string[]; used: TextRewriteUsed; draftChanged: boolean }
  | { phase: "failed"; target: EnhanceTarget | null; code: TextRewriteErrorCode | "empty" | "tooLong" | "noRoute"; attempts: TextRewriteAttempt[] };

const IDLE: EnhanceState = { phase: "idle" };

function newRequestId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `pe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface PromptEnhance {
  state: EnhanceState;
  /** Something is shown (running, answer or failure): Enter / Esc belong to it. */
  active: boolean;
  start(draft: string, selStart: number | null | undefined, selEnd: number | null | undefined): void;
  /** Esc / 取消: drop the request in flight (cancelled in cutex) or close the answer. */
  cancel(): void;
  /** The draft with the rewrite in place, or null (nothing to adopt, or the draft changed there: the panel says so). */
  adopt(draft: string): { text: string; caret: number } | null;
}

/** `api` and `route` are read when a request starts; `scope` (host + agent) changing drops everything. */
export function usePromptEnhance(api: () => DaemonApi, route: () => TextRewriteRoute | null, scope: string): PromptEnhance {
  const [state, setState] = useState<EnhanceState>(IDLE);
  const live = useRef<{ requestId: string; api: DaemonApi } | null>(null);

  const drop = useCallback(() => {
    const cur = live.current;
    live.current = null;
    if (cur) try { void Promise.resolve(cur.api.cancelTextRewrite(cur.requestId)).catch(() => {}); } catch { /* best effort */ }
  }, []);

  // Another agent / host, or the composer goes away: the request is not this draft's any more.
  useEffect(() => {
    setState(IDLE);
    return drop;
  }, [scope, drop]);

  const start = useCallback((draft: string, selStart: number | null | undefined, selEnd: number | null | undefined) => {
    drop();
    const target = enhanceTarget(draft, selStart, selEnd);
    if (!target) return setState({ phase: "failed", target: null, code: "empty", attempts: [] });
    if (utf8Bytes(target.text) > TEXT_REWRITE_MAX_BYTES) return setState({ phase: "failed", target, code: "tooLong", attempts: [] });
    const r = route();
    if (!r) return setState({ phase: "failed", target, code: "noRoute", attempts: [] });
    const daemon = api();
    const requestId = newRequestId();
    live.current = { requestId, api: daemon };
    setState({ phase: "running", requestId, target });
    const settle = (next: EnhanceState) => {
      if (live.current?.requestId !== requestId) return;
      live.current = null;
      setState(next);
    };
    Promise.resolve()
      .then(() => {
        // Cancelled (or replaced) before the call went out: never issue it. Main also refuses an id it saw cancelled.
        if (live.current?.requestId !== requestId) return { ok: false, code: "cancelled", attempts: [] } satisfies TextRewriteResult as TextRewriteResult;
        return daemon.textRewrite({ requestId, text: target.text, route: r });
      })
      .then(
        (result) => settle(result.ok
          ? { phase: "done", target, rewrittenText: result.rewrittenText, missingDetails: result.missingDetails, used: result.used, draftChanged: false }
          : { phase: "failed", target, code: result.code, attempts: result.attempts }),
        () => settle({ phase: "failed", target, code: "failed", attempts: [] }),
      );
  }, [api, route, drop]);

  const cancel = useCallback(() => {
    drop();
    setState(IDLE);
  }, [drop]);

  const adopt = useCallback((draft: string) => {
    if (state.phase !== "done") return null;
    const next = adoptRewrite(draft, state.target, state.rewrittenText);
    if (!next) {
      setState({ ...state, draftChanged: true });
      return null;
    }
    setState(IDLE);
    return next;
  }, [state]);

  return { state, active: state.phase !== "idle", start, cancel, adopt };
}
