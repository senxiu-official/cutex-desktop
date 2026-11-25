// Finding a delegation by its id in the sidebar search (owner 2026-11-25: typing 「#47c47e」 found nothing). The text is a
// delegation id when it reads as one: `#47c47e`, `47c47e`, `ask-47c47e…`, `delegation-47c47e…` — a full id or a unique
// prefix / suffix of at least 6 hex digits (cutex short ids, lib/shortIds); a bare abbreviation only counts when it has a
// digit (「facade」 is a word). Management v2 has no short-id lookup, so each host in view is asked once per search: a
// full id with `GET /v2/asks/{id}`, an abbreviation with one list read (the newest LIST_LIMIT delegations of every state)
// matched here and kept LIST_TTL_MS (dropped on the host's next delegation event or another connection), so pauses in
// typing do not read it again. Requests share the host's session-search lane (lib/sessionSearchStore) but are gated by
// this feature's hosts (setIdLookupHosts: connected, with `agent-asks`). Every search has its own token: a changed text /
// scope drops it — nothing more is sent and late replies are ignored, also after returning to the same text.
// cutex r296 `asks-short-id-lookup-v1`: a host that advertises it is asked `GET /v2/asks?idPrefix=` (main IPC askIdLookup)
// instead of the list read — every stored delegation, archived ones too; its hits are merged with the rows this desktop
// already holds (one per ask id, the held row first: it has the requester), and `hasMore` (the host cut its candidate
// window) asks for a longer id. A host without it, or one whose route is missing, keeps the list read.
// Tested in test/delegationIdSearch.test.ts.
import { create } from "zustand";
import type { AskDetail, AskIdLookupHit, AskSummary } from "../../../shared/ipc";
import { apiFor, bridge } from "../bridge";
import { summaryFromRecord } from "./delegations";
import { useDelegations } from "./delegationStore";
import { hostKey, parseHostKey } from "./hostKeys";
import { inSearchLane } from "./sessionSearchStore";
import { parseIdRef, type IdRef } from "./shortIds";

/** cutex's smallest accepted abbreviation. */
const MIN_HEX = 6;
/** cutex management v2 asks MAX_LIMIT: the one list read of a host. */
export const LIST_LIMIT = 1000;
/** Results shown at most (an abbreviation shared by many). */
export const HITS_MAX = 20;
/** How long one host's list read answers further abbreviations. */
export const LIST_TTL_MS = 60_000;

export interface DelegationIdQuery {
  ref: IdRef;
  /** Written as an id on purpose (`#…`, `ask-…`, `delegation-…`): the sidebar offers no full-text 查找旧任务 for it. */
  explicit: boolean;
  /** The id as typed, without `#`, for the header. */
  text: string;
}

/**
 * The delegation id the search text spells; null for anything else (a name, a session id, under 6 hex digits, a bare hex
 * word without a digit such as 「facade」 / 「decade」 — written `#facade` or `…facade` it is looked up).
 */
export function delegationIdQuery(input: string): DelegationIdQuery | null {
  const raw = input.trim();
  const hash = raw.startsWith("#");
  const text = (hash ? raw.slice(1) : raw).trim();
  if (!text || /\s/.test(text)) return null;
  const ref = parseIdRef(text);
  if (!ref || (ref.kind !== null && ref.kind !== "ask") || ref.hex.length < MIN_HEX) return null;
  const explicit = hash || ref.kind === "ask";
  if (!explicit && ref.mode === "either" && !/\d/.test(ref.hex)) return null;
  return { ref, explicit, text };
}

const hexOf = (askId: string): string | null => {
  const ref = parseIdRef(askId);
  return ref?.mode === "full" ? ref.hex : null;
};

/** Whether `askId` (a full stored id) is the one `ref` names. */
export function askIdMatches(ref: IdRef, askId: string): boolean {
  const hex = hexOf(askId);
  if (!hex) return false;
  if (ref.mode === "full") return hex === ref.hex;
  if (ref.mode === "suffix") return hex.endsWith(ref.hex);
  return hex.startsWith(ref.hex) || hex.endsWith(ref.hex);
}

export interface DelegationIdHit {
  hostId: string;
  d: AskSummary;
}

interface Run {
  key: string;
  /** This search: one started again later with the same key is another. */
  token: number;
  query: DelegationIdQuery;
  /** Hosts still answering. */
  pending: readonly string[];
  failed: readonly string[];
  /** A host had more delegations than the list read covers: an older one may be missed. */
  truncated: boolean;
  /** A host's short-id lookup cut its candidate window (r296 `hasMore`): a longer id narrows it. */
  hasMore: boolean;
}

/** cutex r296 short-id lookup (a host's `features`). */
export const SHORT_ID_LOOKUP_FEATURE = "asks-short-id-lookup-v1";

interface State {
  run: Run | null;
  hits: DelegationIdHit[];
}

export const useDelegationIdSearch = create<State>(() => ({ run: null, hits: [] }));

// ---- which hosts may be asked; one list read per host, kept briefly ----

let lookupHosts: ReadonlySet<string> | null = null;
/** The hosts in view, connected and with delegations (the sidebar keeps this current; null = no restriction, tests). */
export function setIdLookupHosts(ids: readonly string[] | null): void {
  lookupHosts = ids ? new Set(ids) : null;
}
const mayAsk = (hostId: string) => !lookupHosts || lookupHosts.has(hostId);

interface ListRead {
  epoch: string;
  at: number;
  rows: AskSummary[];
}
const lists = new Map<string, ListRead>();
let watching = false;
/** Any delegation event of a host (created, state, title…) makes its kept list stale. */
function watchDelegationEvents(): void {
  if (watching) return;
  watching = true;
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    const method = envelope.cutex?.method;
    if (method?.startsWith("cutex/ask/") || method?.startsWith("cutex/delegation/")) lists.delete(hostId);
  });
}

/** Tests: forget kept list reads. */
export function resetIdLookupLists(): void {
  lists.clear();
}

/** The host's newest LIST_LIMIT delegations: a read under LIST_TTL_MS old on the same connection, else a new read. */
async function listRead(hostId: string, epoch: string): Promise<AskSummary[]> {
  const kept = lists.get(hostId);
  if (kept && kept.epoch === epoch && Date.now() - kept.at < LIST_TTL_MS) return kept.rows;
  watchDelegationEvents();
  const at = Date.now();
  const rows = (await apiFor(hostId).asks({ limit: LIST_LIMIT, background: true })) ?? [];
  lists.set(hostId, { epoch, at, rows });
  return rows;
}

type Found = { rows: AskSummary[]; truncated: boolean; hasMore: boolean };

/** A lookup hit as a row: the row this desktop holds for it, else what the hit says (no requester / creation known). */
function hitRow(hostId: string, hit: AskIdLookupHit): AskSummary {
  const held = useDelegations.getState().byKey[hostKey(hostId, hit.askId)];
  if (held) return held;
  return {
    askId: hit.askId, title: hit.title ?? "", requester: { kind: "agent", name: null }, target: hit.target ?? "", targetName: hit.targetName ?? null,
    projectId: hit.projectId ?? null, execution: hit.execution ?? "queued", closed: hit.closed ?? null, attempts: 0,
    createdAt: hit.updatedAt ?? "", updatedAt: hit.updatedAt ?? "", revision: -1,
  };
}

/** The rows this desktop already holds on `hostId` whose id `ref` names. */
function heldRows(hostId: string, ref: IdRef): AskSummary[] {
  return Object.entries(useDelegations.getState().byKey).filter(([k, d]) => parseHostKey(k)?.[0] === hostId && askIdMatches(ref, d.askId)).map(([, d]) => d);
}

/** r296: the host's own short-id lookup, merged with the held rows; null when the route is missing (older build). */
async function shortIdRows(hostId: string, ref: IdRef): Promise<Found | null> {
  const found = await apiFor(hostId).askIdLookup(`${ref.mode === "suffix" ? "…" : ""}${ref.hex}`, HITS_MAX);
  if (!found) return null;
  const byId = new Map<string, AskSummary>();
  for (const hit of found.asks) if (typeof hit?.askId === "string" && askIdMatches(ref, hit.askId)) byId.set(hit.askId, hitRow(hostId, hit));
  for (const d of heldRows(hostId, ref)) if (!byId.has(d.askId)) byId.set(d.askId, d);
  return { rows: [...byId.values()], truncated: false, hasMore: found.hasMore };
}

/** The delegations whose id `ref` abbreviates: the host's short-id lookup when it has one (r296), else the list read. */
async function abbreviationRows(hostId: string, epoch: string, ref: IdRef, shortId: boolean): Promise<Found> {
  if (shortId) {
    const found = await shortIdRows(hostId, ref);
    if (found) return found;
  }
  const rows = await listRead(hostId, epoch);
  return { rows: rows.filter((d) => askIdMatches(ref, d.askId)), truncated: rows.length >= LIST_LIMIT, hasMore: false };
}

const errorCode = (e: unknown) => (e instanceof Error ? e.message : String(e));
const notFound = (e: unknown) => /ask_not_found|\b404\b/.test(errorCode(e));

/** What one host answers: the delegations it has under that id, whether its list was cut. */
async function lookUp(hostId: string, epoch: string, ref: IdRef, shortId: boolean): Promise<Found> {
  if (ref.mode === "full") {
    try {
      const detail = await apiFor(hostId).ask(`ask-${ref.hex}`);
      const row = detail ? summaryFromRecord({ ...detail, answerId: typeof detail.answerId === "string" ? detail.answerId : ((detail as AskDetail).answer?.answerId ?? null) }) : null;
      return { rows: row ? [row] : [], truncated: false, hasMore: false };
    } catch (e) {
      if (notFound(e)) return { rows: [], truncated: false, hasMore: false };
      throw e;
    }
  }
  return abbreviationRows(hostId, epoch, ref, shortId);
}

let searchGen = 0;
const hitKey = (hostId: string, askId: string) => `${hostId}\n${askId}`;

/**
 * Looks `query` up on `hostIds` (the hosts in view that have delegations; `epochs`: their connections, for the kept list
 * reads). `key`: what the results belong to (text, scope, connections); a newer search or `dropDelegationIdSearch` with
 * another key ends this one. `shortIdHosts`: those that advertise the r296 short-id lookup.
 */
export function searchDelegationId(query: DelegationIdQuery, hostIds: readonly string[], key: string, epochs: Readonly<Record<string, string>> = {}, shortIdHosts: ReadonlySet<string> = new Set()): void {
  if (useDelegationIdSearch.getState().run?.key === key) return;
  const token = ++searchGen;
  useDelegationIdSearch.setState({ run: { key, token, query, pending: hostIds, failed: [], truncated: false, hasMore: false }, hits: [] });
  const live = () => useDelegationIdSearch.getState().run?.token === token;
  const settle = (hostId: string, patch: (run: Run, hits: DelegationIdHit[]) => Partial<State> & { run?: Run }) =>
    useDelegationIdSearch.setState((s) => {
      if (s.run?.token !== token) return s;
      const run = { ...s.run, pending: s.run.pending.filter((h) => h !== hostId) };
      return { run, ...patch(run, s.hits) };
    });
  for (const hostId of hostIds) {
    void inSearchLane(hostId, () => live() && mayAsk(hostId), () => lookUp(hostId, epochs[hostId] ?? "", query.ref, shortIdHosts.has(hostId))).then(
      (r) => {
        // Not sent: the search was dropped (or the host left) before its turn.
        if (!r) return settle(hostId, () => ({}));
        settle(hostId, (run, hits) => {
          // One row per (host, delegation).
          const merged = new Map(hits.map((h) => [hitKey(h.hostId, h.d.askId), h]));
          for (const d of r.value.rows) merged.set(hitKey(hostId, d.askId), { hostId, d });
          return {
            run: { ...run, truncated: run.truncated || r.value.truncated, hasMore: run.hasMore || r.value.hasMore },
            hits: [...merged.values()].sort((a, b) => Date.parse(b.d.createdAt) - Date.parse(a.d.createdAt)).slice(0, HITS_MAX),
          };
        });
      },
      () => settle(hostId, (run) => ({ run: { ...run, failed: [...run.failed, hostId] } })),
    );
  }
}

/** The text / scope changed (or the search ended): drop a search of another key. */
export function dropDelegationIdSearch(key: string | null): void {
  const run = useDelegationIdSearch.getState().run;
  if (run && run.key !== key) useDelegationIdSearch.setState({ run: null, hits: [] });
}
