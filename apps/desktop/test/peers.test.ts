// Cross-host peers (cutex peers-v2): state words, diagnostics, outbox age, policy PATCH building, the
// export picker, delete effects, link detection, the main-side body builders, and how delegations
// show a peer requester / mirror (lib/delegations) and a peer review card (lib/approvals).
import { describe, expect, it } from "vitest";
import type { AskSummary, ApprovalRecord } from "../src/shared/ipc";
import { PEER_POLICY_DEFAULT, peerAddBody, peerInviteBody, peerPatchBody, peersSettingsBody, type PeerPolicy } from "../src/shared/peers";
import { approvalFacts, approvalPeer } from "../src/renderer/src/lib/approvals";
import { delegationActions, delegationBucket, delegationStatus, interruptReasonOf, lateAnswerOf, peerPartyText, peerSideOf, remoteSyncKey, requesterName, requesterPeer, requesterSession, summaryFromRecord } from "../src/renderer/src/lib/delegations";
import { singleLine } from "../src/renderer/src/lib/peerText";
import { exportChoices, exportMode, hostLink, inflightEffect, inviteText, isFullInvite, outboxAgeSecs, outboxTone, parseInvite, PEER_REFUSALS, peerErrorLine, peerErrorText, peerFailure, peerFailureText, peerRefusalCode, peerStateView, policyPatch, preferredInviteUrl, toggleExport, urlTarget, withExportMode } from "../src/renderer/src/modules/peers/model";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const PEER_ID = "ci-7a3f01c2b4d5e6f708192a3b4c5d6e7f";
const policy = (): PeerPolicy => structuredClone(PEER_POLICY_DEFAULT);

describe("peer state", () => {
  it("maps every state to a word and tone; disabled wins unless removed by peer", () => {
    expect(peerStateView({ state: "online", enabled: true })).toEqual({ key: "online", raw: "online", tone: "ok" });
    expect(peerStateView({ state: "unreachable", enabled: true }).tone).toBe("warn");
    expect(peerStateView({ state: "identityChanged", enabled: true }).tone).toBe("danger");
    expect(peerStateView({ state: "online", enabled: false }).key).toBe("disabled");
    expect(peerStateView({ state: "removedByPeer", enabled: false }).key).toBe("removedByPeer");
    expect(peerStateView({ state: "somethingNew", enabled: true })).toEqual({ key: null, raw: "somethingNew", tone: "warn" });
  });

  it("has state words in both languages", () => {
    for (const s of ["pending", "online", "unreachable", "credentialRejected", "identityChanged", "versionMismatch", "disabled", "removedByPeer"]) {
      expect(zhCN[`peers.state.${s}` as keyof typeof zhCN]).toBeTruthy();
      expect(en[`peers.state.${s}` as keyof typeof en]).toBeTruthy();
    }
  });

  it("renders lastError as one sanitized line with missing features", () => {
    expect(peerErrorLine(null)).toBeNull();
    expect(peerErrorLine({ code: "peer_unsupported", message: "lacks\nfeatures", details: { missingFeatures: ["asks.close.v1"] } })).toBe("peer_unsupported · lacks features · missing asks.close.v1");
    expect(peerErrorLine({ code: "x", message: "token cxp1.AAAAAAAAAAAAAAAAAAAAAAAA leaked" })).toBe("x · token [redacted] leaked");
  });

  it("shows lastError in words, the raw line only as the tooltip", () => {
    const t = (key: string) => `<${key}>`;
    expect(peerErrorText(null, t)).toBeNull();
    expect(peerErrorText({ code: "peer_unreachable", message: "connect refused" }, t)).toEqual({ text: "<peers.refusal.peer_unreachable>", title: "peer_unreachable · connect refused" });
    expect(peerErrorText({ code: "some_new_code", message: "" }, t)).toEqual({ text: "<peers.lastErrorUnknown>", title: "some_new_code" });
  });

  it("sanitizes remote text", () => {
    expect(singleLine("a‮b\u0007c\n\nd")).toBe("abc d");
    expect(singleLine("Bearer abcdefghijklmnop")).toBe("[redacted]");
    expect(singleLine("x".repeat(400)).length).toBe(300);
  });

  it("computes outbox age locally and warns past half the retention", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(outboxAgeSecs(null, now)).toBeNull();
    expect(outboxAgeSecs("2026-10-11T11:00:00Z", now)).toBe(3600);
    expect(outboxTone(3600, 24)).toBe("muted");
    expect(outboxTone(13 * 3600, 24)).toBe("warn");
  });
});

describe("policy patch", () => {
  it("is null when nothing changed", () => {
    expect(policyPatch(policy(), policy())).toBeNull();
  });

  it("sends only changed scalar fields", () => {
    const after = policy();
    after.inbound.review = "never";
    after.outbound.visibility = "all";
    expect(policyPatch(policy(), after)).toEqual({ inbound: { review: "never" }, outbound: { visibility: "all" } });
  });

  it("replaces exports and assumedCaps whole", () => {
    const before = policy();
    before.inbound.exports = [{ project: "p1" }];
    const after = structuredClone(before);
    after.inbound.exports = [{ project: "p1" }, { agent: "a1" }];
    after.inbound.assumedCaps.networkAccess = true;
    expect(policyPatch(before, after)).toEqual({ inbound: { exports: [{ project: "p1" }, { agent: "a1" }], assumedCaps: { sandbox: "read-only", networkAccess: true, unrestrictedServices: false } } });
  });

  it("treats a reordered export list as unchanged", () => {
    const before = policy();
    before.inbound.exports = [{ project: "p1" }, { agent: "a1" }];
    const after = structuredClone(before);
    after.inbound.exports = [{ agent: "a1" }, { project: "p1" }];
    expect(policyPatch(before, after)).toBeNull();
  });

  it("switches export modes", () => {
    expect(exportMode([])).toBe("none");
    expect(exportMode([{ all: true }])).toBe("all");
    expect(exportMode([{ agent: "a" }])).toBe("some");
    expect(withExportMode([{ agent: "a" }], "all")).toEqual([{ all: true }]);
    expect(withExportMode([{ all: true }], "some")).toEqual([]);
    expect(toggleExport([{ all: true }], { agent: "a" }, true)).toEqual([{ agent: "a" }]);
    expect(toggleExport([{ agent: "a" }, { project: "p" }], { agent: "a" }, false)).toEqual([{ project: "p" }]);
  });

  it("offers live projects and standalone agents, keeps unknown exports", () => {
    const session = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ cutexSessionId: id, displayName: name, formalAgentName: name, registrationClass: null, ...extra }) as never;
    const sidebar = {
      active: [session("a1", "Solo"), session("a2", "Member"), session("c1", "Chat", { formalAgentName: null, registrationClass: "local_only" })],
      hostRows: { a2: { projectId: "p1" } } as never,
      projects: { schema: "x", projects: [{ project_id: "p1", presentation: { display_name: "Desktop", color: "#f00", badge_label: "D" }, active_member_count: 3, lifecycle: "active" } as never, { project_id: "old", presentation: { display_name: "Old" }, active_member_count: 0, lifecycle: "archived" } as never] },
    };
    const c = exportChoices(sidebar, [{ agent: "gone" }, { project: "p1" }]);
    expect(c.projects.map((p) => p.item)).toEqual([{ project: "p1" }]);
    expect(c.agents.map((a) => a.item)).toEqual([{ agent: "a1" }]);
    expect(c.unknown).toEqual([{ agent: "gone" }]);
  });
});

describe("delete, refusals, link", () => {
  it("says what a delete does to each open ask", () => {
    expect(inflightEffect({ requester: { kind: "peer", peerId: PEER_ID, cutexSessionId: "r", label: "lab" } })).toBe("incomingStopped");
    expect(inflightEffect({ requester: { kind: "agent", cutexSessionId: "lead" } })).toBe("outgoingInterrupted");
  });

  it("knows its refusal codes", () => {
    expect(peerRefusalCode("loopback_only")).toBe("loopback_only");
    expect(peerRefusalCode("whatever")).toBeNull();
    expect(zhCN["peers.refusal.loopback_only"]).toBeTruthy();
    for (const code of PEER_REFUSALS) {
      expect(zhCN[`peers.refusal.${code}` as keyof typeof zhCN], code).toBeTruthy();
      expect(en[`peers.refusal.${code}` as keyof typeof en], code).toBeTruthy();
    }
  });

  it("puts failed peer writes in words and never shows a raw http_503 when a code exists", () => {
    const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
    expect(peerFailure({ code: "peer_unreachable", message: "peer unreachable" })).toEqual({ kind: "refusal", code: "peer_unreachable" });
    expect(peerFailureText({ code: "peer_unreachable", message: "x" }, t)).toBe("peers.refusal.peer_unreachable");
    // Thrown over IPC: Electron's prefix, then cutex's "<code>: <message>".
    expect(peerFailure(new Error("Error invoking remote method 'addPeer': Error: peer_unreachable: peer unreachable"))).toEqual({ kind: "refusal", code: "peer_unreachable" });
    expect(peerFailure(new Error("Error invoking remote method 'addPeer': Error: http_503: request failed"))).toEqual({ kind: "http", status: 503 });
    expect(peerFailureText(new Error("Error: http_503: request failed"), t)).toBe('peers.refusal.http{"status":503}');
    expect(peerFailure({ code: "brand_new_code", message: "brand new code" })).toEqual({ kind: "code", code: "brand_new_code" });
    expect(peerFailureText({ code: "brand_new_code", message: "" }, t)).toBe('peers.refusal.other{"code":"brand_new_code"}');
    expect(peerFailure("socket hang up")).toEqual({ kind: "raw", text: "socket hang up" });
    expect(peerFailure({ code: "invalid_pairing_code", message: "" })).toEqual({ kind: "refusal", code: "invalid_pairing_code" });
    expect(peerFailure({ code: "self_peer", message: "" }).kind).toBe("refusal");
  });
});

describe("invite string", () => {
  const urls = ["http://127.0.0.1:24270", "http://100.64.0.27:24270", "http://host-a.tail1234.ts.net:24270"];

  it("prefers the first non-loopback address (cutex lists local_url first)", () => {
    expect(preferredInviteUrl(urls)).toBe("http://100.64.0.27:24270");
    expect(preferredInviteUrl(["http://127.0.0.1:24270", "http://[::1]:24270", "http://localhost:1"])).toBe("http://127.0.0.1:24270");
    expect(preferredInviteUrl([])).toBeNull();
  });

  it("is `<url> <code>` and parses back (round trip, any order, extra whitespace)", () => {
    const line = inviteText({ urls, code: "ABCD-EFGH" });
    expect(line).toBe("http://100.64.0.27:24270 ABCD-EFGH");
    expect(parseInvite(line)).toEqual({ url: "http://100.64.0.27:24270", code: "ABCD-EFGH" });
    expect(parseInvite("  ABCD-EFGH\n\thttp://host-a.tail1234.ts.net:24270  ")).toEqual({ url: "http://host-a.tail1234.ts.net:24270", code: "ABCD-EFGH" });
    expect(isFullInvite(line)).toBe(true);
    expect(isFullInvite(" http://100.64.0.27:24270 ")).toBe(false);
    expect(isFullInvite("ABCD-EFGH")).toBe(false);
    expect(parseInvite("http://100.64.0.27:24270")).toEqual({ url: "http://100.64.0.27:24270", code: null });
    expect(inviteText({ urls: [], code: "ABCD-EFGH" })).toBe("ABCD-EFGH");
  });

  it("shows host and port of an address", () => {
    expect(urlTarget("http://100.64.0.27:2427")).toEqual({ host: "100.64.0.27", port: 2427, explicitPort: true, path: false });
    expect(urlTarget(" http://host-a.tail1234.ts.net:24270/ ")).toMatchObject({ host: "host-a.tail1234.ts.net", port: 24270, path: false });
    expect(urlTarget("http://100.64.0.27")).toMatchObject({ port: 80, explicitPort: false });
    expect(urlTarget("http://100.64.0.27:24270/v2")).toMatchObject({ path: true });
    expect(urlTarget("100.64.0.27:24270")).toBeNull();
    expect(urlTarget("ftp://x")).toBeNull();
  });
});

describe("host link", () => {

  it("treats local, ssh and dev-direct links as loopback", () => {
    expect(hostLink({ kind: "local" })).toBe("loopback");
    expect(hostLink({ kind: "ssh" })).toBe("loopback");
    expect(hostLink({ kind: "dev-direct" })).toBe("loopback");
    expect(hostLink(null)).toBe("unknown");
    expect(hostLink({ kind: "tailnet" as never })).toBe("unknown");
  });
});

describe("main-side bodies", () => {
  it("keeps only known, valid patch fields", () => {
    expect(peerPatchBody({ label: "lab", enabled: false, policy: { inbound: { exports: [{ all: true }], review: "ifTargetWider" }, outbound: { visibility: "all" } } })).toEqual({ label: "lab", enabled: false, policy: { inbound: { exports: [{ all: true }], review: "ifTargetWider" }, outbound: { visibility: "all" } } });
    expect(() => peerPatchBody({ label: "Bad Label" })).toThrow();
    expect(() => peerPatchBody({ urls: [] })).toThrow();
    expect(() => peerPatchBody({ urls: Array(9).fill("http://100.64.0.1:1") })).toThrow();
    expect(() => peerPatchBody({ policy: { inbound: { maxOpenAsks: 0 } } })).toThrow();
    expect(() => peerPatchBody({ policy: { inbound: { exports: [{ nope: 1 }] } } })).toThrow();
    expect(peerPatchBody({ policy: { inbound: { exports: [{ agent: "a", extra: 1 }] } } })).toEqual({ policy: { inbound: { exports: [{ agent: "a" }] } } });
  });

  it("validates settings, invite and add bodies", () => {
    expect(peersSettingsBody({ enabled: true, maxHops: 4 })).toEqual({ enabled: true, maxHops: 4 });
    expect(() => peersSettingsBody({ maxHops: 9 })).toThrow();
    expect(() => peersSettingsBody({ unknownKey: 1 })).toThrow();
    expect(peerInviteBody({})).toEqual({});
    expect(peerInviteBody({ label: "workstation" })).toEqual({ label: "workstation" });
    expect(() => peerInviteBody({ label: "Workstation!" })).toThrow();
    expect(peerAddBody({ url: " http://100.64.0.2:24270 ", code: " ABCDE-FGHIJ ", label: "" })).toEqual({ url: "http://100.64.0.2:24270", code: "ABCDE-FGHIJ" });
    expect(() => peerAddBody({ url: "", code: "x" })).toThrow();
  });
});

describe("delegations with peers", () => {
  const peerRequester = { kind: "peer" as const, peerId: PEER_ID, cutexSessionId: "cutex.9b2e4f1d77aa", name: "proj-research", label: "workstation-lab", claimedCaps: { sandbox: "workspace-write", networkAccess: true } };
  const base = (over: Partial<AskSummary>): AskSummary => ({ askId: "ask-1", title: "t", requester: { kind: "owner" }, target: "helper", execution: "queued", attempts: 0, createdAt: "", updatedAt: "", revision: 1, ...over });

  it("shows a peer requester as name @ label, never as owner or a local session", () => {
    expect(requesterName(peerRequester)).toBe("proj-research @ workstation-lab");
    expect(requesterSession(peerRequester)).toBeNull();
    expect(requesterPeer(peerRequester)?.label).toBe("workstation-lab");
    expect(peerPartyText(null, "cutex.9b2e4f1d77aa", "lab")).toBe("…1d77aa @ lab");
    // An awaiting-acceptance answer from a peer requester is the peer agent's to accept, not the owner's.
    expect(delegationBucket(base({ requester: peerRequester, execution: "answered", review: "awaitingAcceptance" }))).toBe("waiting");
  });

  it("finds the far end of incoming and outgoing delegations", () => {
    expect(peerSideOf(base({ requester: peerRequester }))).toEqual({ side: "requester", peerId: PEER_ID, label: "workstation-lab", name: "proj-research @ workstation-lab" });
    const mirror = base({ requester: { kind: "agent", cutexSessionId: "lead" }, target: "cutex.4be81f", remote: { peerId: PEER_ID, label: "workstation-lab", targetName: "proj-worker", syncState: "synced" } });
    expect(peerSideOf(mirror)?.name).toBe("proj-worker @ workstation-lab");
    expect(peerSideOf(base({}))).toBeNull();
  });

  it("words peer holds and interrupt reasons", () => {
    expect(delegationStatus(base({ hold: { reason: "peerUnreachable" } })).key).toBe("peerUnreachable");
    expect(delegationStatus(base({ hold: { reason: "peerUnknown", raw: "x=y" } })).key).toBe("peerUnknown");
    const removed = base({ execution: "interrupted", closed: "stopped", remote: { peerId: PEER_ID, label: "l", targetName: "w", syncState: "peerRemoved", interruptReason: "peerRemoved" } });
    expect(interruptReasonOf(removed)).toBe("peerRemoved");
    expect(delegationStatus(removed).key).toBe("peerRemoved");
    const unknown = base({ execution: "interrupted", remote: { peerId: PEER_ID, label: "l", targetName: "w", syncState: "outcomeUnknown", interruptReason: "outcomeUnknown" } });
    expect(delegationStatus(unknown).key).toBe("outcomeUnknown");
    expect(delegationBucket(unknown)).toBe("needsYou");
    // A mirror cannot be retried across hosts.
    expect(delegationActions(unknown).retry).toBe(false);
    for (const k of ["peerUnreachable", "peerIdentityChanged", "peerVersionMismatch", "peerUnknown", "peerRemoved", "peerDisabled", "peersDisabled", "removedByPeer", "peerStripped"]) {
      expect(zhCN[`delegation.status.${k}` as keyof typeof zhCN]).toBeTruthy();
      expect(en[`delegation.status.${k}` as keyof typeof en]).toBeTruthy();
    }
  });

  it("words remote sync states", () => {
    expect(remoteSyncKey(null)).toBeNull();
    expect(remoteSyncKey({ syncState: "synced" })).toBeNull();
    expect(remoteSyncKey({ syncState: "queued" })).toBe("queued");
    expect(remoteSyncKey({ syncState: "remoteStateUnknown" })).toBe("unknown");
    expect(remoteSyncKey({ syncState: "peer_unreachable" })).toBe("unreachable");
    expect(remoteSyncKey({ syncState: "peer_request_incompatible" })).toBe("incompatible");
    expect(remoteSyncKey({ syncState: "outcomeUnknown" })).toBe("outcomeUnknown");
    expect(remoteSyncKey({ syncState: "peersDisabled" })).toBe("disabled");
    expect(remoteSyncKey({ syncState: "removedByPeer" })).toBe("removed");
    expect(remoteSyncKey({ syncState: "somethingElse" })).toBe("other");
  });

  it("carries peer fields through a stored record", () => {
    const d = summaryFromRecord({ askId: "ask-9", title: "x", requester: peerRequester, targetCutexSessionId: "helper", execution: "answered", hops: 2, resultUndeliverable: true, lateAnswer: { artifactId: "art-1", preview: "p" }, remote: null });
    expect(d?.hops).toBe(2);
    expect(d?.resultUndeliverable).toBe(true);
    expect(d && lateAnswerOf(d)?.artifactId).toBe("art-1");
    expect(d?.remote).toBeUndefined();
    expect(lateAnswerOf(base({ lateAnswer: { artifactId: null, preview: null } }))).toBeNull();
  });

  it("reads a peer review card and keeps claimed caps out of the raw facts", () => {
    const record = { requesterCutexSessionId: `peer:${PEER_ID}:cutex.9b2e4f`, requesterName: "proj-research@workstation-lab", details: { askId: "ask-1", claimedCaps: { sandbox: "workspace-write", networkAccess: true, unrestrictedServices: false }, claimedCapsLabel: "对端声称" } } as Pick<ApprovalRecord, "requesterCutexSessionId" | "requesterName" | "details">;
    expect(approvalPeer(record)).toEqual({ name: "proj-research", label: "workstation-lab", peerId: PEER_ID, claimedCaps: { sandbox: "workspace-write", networkAccess: true, unrestrictedServices: false } });
    expect(approvalFacts(record.details).map((f) => f.key)).toEqual(["askId"]);
    expect(approvalPeer({ requesterCutexSessionId: "lead", requesterName: "Lead", details: null })).toBeNull();
  });
});
