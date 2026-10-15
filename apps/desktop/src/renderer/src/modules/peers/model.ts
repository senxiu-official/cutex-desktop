// Pure helpers of Settings → 跨主机 (cutex peers-v2): state words, diagnostics, outbox age, the
// policy PATCH built from the editor's draft, the export picker over this host's projects and
// standalone agents, what a delete does to open asks, refusal words, and whether the desktop's link
// to the host is loopback (cutex refuses peer writes otherwise). Unit-tested in test/peers.test.ts.
// No cutex logic is re-implemented: cutex decides; this only shapes requests and words.
import type { SessionResource } from "@cutex-desktop/protocol";
import type { HostView } from "../../../../shared/hosts";
import type { AskDetail, SidebarSnapshot } from "../../../../shared/ipc";
import type { PeerError, PeerExport, PeerPatch, PeerPolicy, PeerState, PeerView } from "../../../../shared/peers";
import { isQuickChat } from "../../lib/sidebar";
import { singleLine } from "../../lib/peerText";

// ---------- state ----------

export type PeerTone = "ok" | "warn" | "danger" | "muted";
export const PEER_TONE_DOT: Record<PeerTone, string> = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", muted: "bg-subtle/60" };
export const PEER_TONE_TEXT: Record<PeerTone, string> = { ok: "text-ok-text", warn: "text-warn", danger: "text-danger", muted: "text-subtle" };

const STATE_TONE: Record<PeerState, PeerTone> = {
  online: "ok",
  pending: "muted",
  disabled: "muted",
  unreachable: "warn",
  versionMismatch: "warn",
  credentialRejected: "danger",
  identityChanged: "danger",
  removedByPeer: "danger",
};

/** The badge of a peer: `peers.state.<key>` + tone; an unknown state shows its raw name. */
export function peerStateView(peer: Pick<PeerView, "state" | "enabled">): { key: PeerState | null; raw: string; tone: PeerTone } {
  const state = !peer.enabled && peer.state !== "removedByPeer" ? "disabled" : peer.state;
  if (state in STATE_TONE) return { key: state as PeerState, raw: state, tone: STATE_TONE[state as PeerState] };
  return { key: null, raw: String(state), tone: "warn" };
}

/** `lastError` as one safe line: "<code>: <message>" (+ missing features). Null when there is none. */
export function peerErrorLine(error: PeerError | null | undefined): string | null {
  if (!error?.code) return null;
  const missing = Array.isArray(error.details?.missingFeatures) ? (error.details!.missingFeatures as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const message = singleLine(error.message ?? "", 240);
  const parts = [singleLine(error.code, 64), message && message !== error.code ? message : null, missing.length ? `missing ${missing.map((m) => singleLine(m, 40)).join(", ")}` : null].filter(Boolean);
  return parts.join(" · ");
}

/**
 * `lastError` in words (settings audit 2026-10-15 #44): a known code reads as its refusal text, any
 * other as 「最近一次通信出错」; the raw line (peerErrorLine) goes in the tooltip. Null when there is none.
 */
export function peerErrorText(error: PeerError | null | undefined, t: (key: string, vars?: Record<string, string | number>) => string): { text: string; title: string } | null {
  const line = peerErrorLine(error);
  if (!line) return null;
  const known = peerRefusalCode(error!.code);
  return { text: known ? t(`peers.refusal.${known}`) : t("peers.lastErrorUnknown"), title: line };
}

/** Age in seconds of the oldest queued outbox entry (computed here: cutex sends no event for age alone). */
export function outboxAgeSecs(oldestAt: string | null | undefined, nowMs: number): number | null {
  if (!oldestAt) return null;
  const at = Date.parse(oldestAt);
  return Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / 1000)) : null;
}

/** Outbox older than this share of `outboxMaxAgeHours` is shown as a warning (it will expire). */
export const OUTBOX_WARN_SHARE = 0.5;

export function outboxTone(ageSecs: number | null, maxAgeHours: number | null | undefined): PeerTone {
  if (ageSecs === null) return "muted";
  const limit = (maxAgeHours ?? 24) * 3600;
  return ageSecs >= limit * OUTBOX_WARN_SHARE ? "warn" : "muted";
}

// ---------- policy ----------

const sameExport = (a: PeerExport, b: PeerExport) => JSON.stringify(a) === JSON.stringify(b);

export function sameExports(a: readonly PeerExport[], b: readonly PeerExport[]): boolean {
  return a.length === b.length && a.every((x) => b.some((y) => sameExport(x, y)));
}

/**
 * The `policy` part of `PATCH /v2/peers/{id}` for an edited draft: only changed fields; `exports`
 * and `assumedCaps` are replaced whole by cutex, so they are sent whole. Null = nothing changed.
 */
export function policyPatch(before: PeerPolicy, after: PeerPolicy): NonNullable<PeerPatch["policy"]> | null {
  const inbound: NonNullable<NonNullable<PeerPatch["policy"]>["inbound"]> = {};
  const bi = before.inbound;
  const ai = after.inbound;
  if (!sameExports(bi.exports, ai.exports)) inbound.exports = ai.exports.map((e) => ({ ...e }));
  if (bi.accept !== ai.accept) inbound.accept = ai.accept;
  if (bi.review !== ai.review) inbound.review = ai.review;
  if (bi.assumedCaps.sandbox !== ai.assumedCaps.sandbox || bi.assumedCaps.networkAccess !== ai.assumedCaps.networkAccess || bi.assumedCaps.unrestrictedServices !== ai.assumedCaps.unrestrictedServices) inbound.assumedCaps = { ...ai.assumedCaps };
  if (bi.maxOpenAsks !== ai.maxOpenAsks) inbound.maxOpenAsks = ai.maxOpenAsks;
  if (bi.asksPerHour !== ai.asksPerHour) inbound.asksPerHour = ai.asksPerHour;
  const out: NonNullable<PeerPatch["policy"]> = {};
  if (Object.keys(inbound).length) out.inbound = inbound;
  if (before.outbound.visibility !== after.outbound.visibility) out.outbound = { visibility: after.outbound.visibility };
  return Object.keys(out).length ? out : null;
}

/** The export picker's mode: nothing, everything, or a selection. */
export type ExportMode = "none" | "all" | "some";

export function exportMode(exports: readonly PeerExport[]): ExportMode {
  if (exports.some((e) => "all" in e && e.all)) return "all";
  return exports.length ? "some" : "none";
}

/** Exports after switching mode (a selection keeps the picked items; "some" with none picked yet stays empty). */
export function withExportMode(exports: readonly PeerExport[], mode: ExportMode): PeerExport[] {
  if (mode === "none") return [];
  if (mode === "all") return [{ all: true }];
  return exports.filter((e) => !("all" in e));
}

export function hasExport(exports: readonly PeerExport[], item: PeerExport): boolean {
  return exports.some((e) => sameExport(e, item));
}

export function toggleExport(exports: readonly PeerExport[], item: PeerExport, on: boolean): PeerExport[] {
  const rest = exports.filter((e) => !("all" in e) && !sameExport(e, item));
  return on ? [...rest, item] : rest;
}

export interface ExportChoice {
  item: PeerExport;
  name: string;
  /** Project: its active member count; agent: null. */
  members: number | null;
  color?: string;
}

/**
 * What can be exported on this host: its live projects and its standalone agents (no project; quick
 * chats excluded), each once. Exports stored for things no longer listed are kept as "unknown".
 */
export function exportChoices(sidebar: Pick<SidebarSnapshot, "active" | "hostRows" | "projects"> | null, current: readonly PeerExport[]): { projects: ExportChoice[]; agents: ExportChoice[]; unknown: PeerExport[] } {
  const projects: ExportChoice[] = (sidebar?.projects?.projects ?? [])
    .filter((p) => p.lifecycle !== "archived")
    .map((p) => ({ item: { project: p.project_id }, name: p.presentation.display_name || p.project_id, members: p.active_member_count, color: p.presentation.color }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const agents: ExportChoice[] = (sidebar?.active ?? [])
    .filter((s: SessionResource) => {
      const row = sidebar?.hostRows[s.cutexSessionId];
      return !row?.projectId && !isQuickChat(s, row);
    })
    .map((s) => ({ item: { agent: s.cutexSessionId }, name: s.displayName, members: null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const known = [...projects, ...agents].map((c) => c.item);
  const unknown = current.filter((e) => !("all" in e) && !known.some((k) => sameExport(k, e)));
  return { projects, agents, unknown };
}

// ---------- delete ----------

/** What deleting the peer does to an open ask (cutex PEERS.md peer-state table: owner delete). */
export type InflightEffect = "outgoingInterrupted" | "incomingStopped";

export function inflightEffect(ask: Pick<AskDetail, "requester"> & { remote?: unknown }): InflightEffect {
  return ask.requester?.kind === "peer" ? "incomingStopped" : "outgoingInterrupted";
}

// ---------- refusals and link ----------

/** Refusal codes with our own words (`peers.refusal.<code>`); others show a generic line with the code. */
export const PEER_REFUSALS = [
  "self_peer",
  "peer_exists",
  "label_taken",
  "peer_rate_limited",
  "peer_protocol_error",
  "peer_request_failed",
  "peer_credential_required",
  "remote_credential_refused",
  "remote_unsupported",
  "persistence_unavailable",
  "loopback_only",
  "invalid_pairing_code",
  "peer_already_active",
  "pair_incomplete",
  "peer_callback_forbidden",
  "peer_callback_unavailable",
  "peer_url_insecure",
  "peer_unreachable",
  "peer_unsupported",
  "identity_changed",
  "peer_user_unsupported",
  "peer_not_found",
  "invalid_request",
] as const;
export type PeerRefusalCode = (typeof PEER_REFUSALS)[number];

export function peerRefusalCode(code: string | null | undefined): PeerRefusalCode | null {
  return code && (PEER_REFUSALS as readonly string[]).includes(code) ? (code as PeerRefusalCode) : null;
}

/** What failed, as words: a known refusal, another cutex code, a bare HTTP status, or a raw message. */
export type PeerFailure = { kind: "refusal"; code: PeerRefusalCode } | { kind: "code"; code: string } | { kind: "http"; status: number } | { kind: "raw"; text: string };

const CODE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Classify a failed peer write: a `{code, message}` refusal from main, or a thrown error whose
 * message carries "<code>: <message>" (Electron prefixes "Error invoking remote method …: Error: ").
 * A raw `http_503` is only ever the last resort, when cutex sent no code at all.
 */
export function peerFailure(error: { code?: string | null; message?: string | null } | Error | string | null | undefined): PeerFailure {
  let code: string | null = null;
  let text = "";
  if (typeof error === "string") text = error;
  else if (error instanceof Error) text = error.message;
  else if (error) {
    code = typeof error.code === "string" ? error.code : null;
    text = error.message ?? "";
  }
  if (!code) {
    // The last "<code>: " in the message (after any IPC prefixes).
    const found = [...text.matchAll(/(?:^|[\s:])([a-z][a-z0-9_]{0,63}): /g)].map((m) => m[1]!);
    code = found.find((c) => peerRefusalCode(c)) ?? found.find((c) => c.includes("_")) ?? null;
  }
  const known = peerRefusalCode(code);
  if (known) return { kind: "refusal", code: known };
  const http = code ? /^http_(\d{3})$/.exec(code) : null;
  if (http) return { kind: "http", status: Number(http[1]) };
  if (code && CODE.test(code)) return { kind: "code", code };
  return { kind: "raw", text: singleLine(text, 240) || "?" };
}

/** `peerFailure` in words; `t` is the i18n lookup (passed in so this stays pure and testable). */
export function peerFailureText(error: Parameters<typeof peerFailure>[0], t: (key: string, vars?: Record<string, string | number>) => string): string {
  const f = peerFailure(error);
  switch (f.kind) {
    case "refusal":
      return t(`peers.refusal.${f.code}`);
    case "code":
      return t("peers.refusal.other", { code: f.code });
    case "http":
      return t("peers.refusal.http", { status: f.status });
    case "raw":
      return f.text;
  }
}

// ---------- invite string ----------

/**
 * The one-line invite 「复制邀请」 copies: `<url> <code>`, e.g. `http://100.64.0.27:24270 ABCD-EFGH`.
 * Readable as is, and `parseInvite` takes it apart again (also with extra spaces / newlines, or the
 * two parts in either order). The url is the host's preferred address for another host.
 */
export function inviteText(invite: { urls: readonly string[]; code: string }): string {
  const url = preferredInviteUrl(invite.urls);
  return url ? `${url} ${invite.code}` : invite.code;
}

function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\./.test(h);
}

/**
 * The address to hand to another host: cutex lists its loopback `local_url` first, then its remote
 * listeners (IPs, then the MagicDNS name), so the first non-loopback one; loopback only when that is
 * all there is (pairing two instances on one machine).
 */
export function preferredInviteUrl(urls: readonly string[]): string | null {
  const remote = urls.find((u) => {
    const t = urlTarget(u);
    return t && !isLoopbackHost(t.host);
  });
  return remote ?? urls[0] ?? null;
}

const URL_TOKEN = /^https?:\/\//i;
const CODE_TOKEN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** Split a pasted invite (or a bare address / code) into its parts; whitespace is trimmed. */
export function parseInvite(text: string): { url: string | null; code: string | null } {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const url = tokens.find((x) => URL_TOKEN.test(x)) ?? null;
  const code = tokens.find((x) => !URL_TOKEN.test(x) && CODE_TOKEN.test(x)) ?? null;
  return { url, code };
}

/** True when the text holds both parts (so pasting it fills both fields). */
export function isFullInvite(text: string): boolean {
  const p = parseInvite(text);
  return !!p.url && !!p.code && /\s/.test(text.trim());
}

/** host + port the address points at (explicit port or the scheme's default); null when it is no http(s) URL. */
export function urlTarget(url: string): { host: string; port: number; explicitPort: boolean; path: boolean } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  const explicitPort = u.port !== "";
  const port = explicitPort ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  return { host: u.hostname, port, explicitPort, path: (u.pathname !== "/" && u.pathname !== "") || !!u.search || !!u.hash };
}

/**
 * How the desktop reaches the host's Management API, as cutex sees it: the local host, an SSH tunnel
 * (it ends at the remote's 127.0.0.1) and a dev-direct host are loopback; anything else is unknown —
 * then writes stay enabled until cutex refuses one with `loopback_only`.
 */
export function hostLink(host: Pick<HostView, "kind"> | null | undefined): "loopback" | "unknown" {
  return host && (host.kind === "local" || host.kind === "ssh" || host.kind === "dev-direct") ? "loopback" : "unknown";
}
