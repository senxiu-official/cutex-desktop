// `delegations.detail` (side component, bound to the agent it was opened for) and the `delegation` ref kind it serves: one
// delegation's full detail on the right side — the timeline card's body (components/DelegationCard
// DelegationDetailBody) under a header with the parties and the status. Pure helpers here (tested
// in test/delegationDetail.test.ts); the view in DetailView.tsx.
import type { AskDetail, AskSummary } from "../../../../shared/ipc";
import { askIdOfRef, isAskId } from "../../lib/delegationRefs";
import { summaryFromRecord } from "../../lib/delegations";
import type { CutexRef, RefOpenResult, SideOpenResult } from "../slots";
import type { Json } from "../types";

export const DETAIL = "delegations.detail";
/** Page group of the detail cards (docs/desktop-modules.md §18.6). */
export const DETAIL_GROUP = "delegations";

const MAX_TITLE = 200;

export interface DetailParams {
  askId: string;
  /** Known title, for the tab before the record loads. */
  title?: string;
}
export type DetailState = DetailParams;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseDetailParams(raw: Json): DetailParams | null {
  if (!isRecord(raw) || !isAskId(raw.askId)) return null;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, MAX_TITLE) : undefined;
  return title ? { askId: raw.askId, title } : { askId: raw.askId };
}

export function detailKey(p: Pick<DetailParams, "askId">): string {
  return p.askId;
}

export function initDetail(p: DetailParams, previous: DetailState | null): DetailState {
  const title = p.title ?? (previous?.askId === p.askId ? previous.title : undefined);
  return title ? { askId: p.askId, title } : { askId: p.askId };
}

/**
 * State version 2 = agent-bound details (fix/delegations-side-stale). Version 1 instances were all
 * host-bound (visible beside every agent of the host) and are dropped on restore.
 */
export const DETAIL_STATE_VERSION = 2;

export function restoreDetail(raw: Json, version: number): DetailState | null {
  return version === DETAIL_STATE_VERSION ? parseDetailParams(raw) : null;
}

/** 「委托 #3 · title」; no title yet: 「委托 #3」. `label` = the translated 委托 word. */
export function detailTabTitle(label: string, tag: string, title: string | null | undefined): string {
  const t = title?.replace(/\s+/g, " ").trim();
  return t ? `${label} ${tag} · ${t}` : `${label} ${tag}`;
}

export type DetailBinding = { kind: "agent"; hostId: string; sessionId: string } | { kind: "host"; hostId: string };

/**
 * The side open of a `delegation` ref. The host is always the ref's (a delegation is a host record;
 * the selected agent's host is never substituted). The binding is the agent whose side view it opens
 * in (`sessionId`: the open agent, on the ref's host): the side layout's pages are shared by every
 * agent and each agent sees the instances bound to it, so a host binding showed one agent's detail
 * beside every other agent of the host, and a transient open replaced another agent's detail in
 * place. Host-bound only with no agent open.
 */
export function detailOpenArgs(ref: CutexRef, sessionId: string | null): { params: DetailParams; binding: DetailBinding } | null {
  const askId = askIdOfRef(ref);
  if (!askId) return null;
  const title = ref.title && ref.title !== askId ? ref.title.slice(0, MAX_TITLE) : undefined;
  const binding: DetailBinding = sessionId ? { kind: "agent", hostId: ref.hostId, sessionId } : { kind: "host", hostId: ref.hostId };
  return { params: title ? { askId, title } : { askId }, binding };
}

export function refResult(r: SideOpenResult): RefOpenResult {
  if (r.status === "opened") return { status: "opened", where: "card" };
  if (r.status === "stale") return r;
  const reason = r.reason === "capability" || r.reason === "agent-feature" ? "capability" : r.reason === "host-offline" ? "host-offline" : r.reason === "bad-params" ? "bad-ref" : "module-off";
  return { status: "unavailable", reason };
}

/**
 * A summary out of the detail (a record the list store has not loaded: closed long ago, another
 * host not followed): lib/delegations summaryFromRecord, with the answer id from `answer`.
 */
export function summaryFromDetail(detail: AskDetail): AskSummary | null {
  const answerId = typeof detail.answerId === "string" ? detail.answerId : (detail.answer?.answerId ?? null);
  return summaryFromRecord({ ...detail, answerId });
}
