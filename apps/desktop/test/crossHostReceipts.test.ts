// Cross-host delivery receipts (cutex peer-delivery-receipts-v1; desktop spec r296-crosshost-desktop): the wire
// object is read defensively, shown only on hosts with the capability and on records that carry it, its words are the
// same in a list row and the detail, a peer is matched to a connected host only by its Management instance id (two
// hosts with one name stay apart), and a late observation never moves a receipt back.
import { describe, expect, it } from "vitest";
import { asCrossHost, newerCrossHost, PEER_RECEIPTS_FEATURE, type CrossHost } from "../src/shared/crossHost";
import { crossHostOf, peerHostIn, peerHostView, receiptKey, receiptNeedsNotice, receiptTone, receiptWords, reasonMessageKey } from "../src/renderer/src/lib/crossHost";
import { applyAskEvent, peerSideOf, summaryFromRecord } from "../src/renderer/src/lib/delegations";
import { applyMessageEvent, seedMessages } from "../src/renderer/src/lib/legacyDelivery/agentMessages";
import { zhCN, en } from "../src/renderer/src/lib/crossHostMessages";
import type { ScopeSource } from "../src/renderer/src/lib/hostScope";

const LAB = "ci-7a3f01c2b4d5e6f708192a3b4c5d6e7f";
const LAB2 = "ci-00000000000000000000000000000002";
const wire = (state: string, reason: string | null = null, confirmedAt: string | null = "2026-11-25T10:00:00Z", direction = "outbound") =>
  ({ direction, peer: { instanceId: LAB, label: "workstation-lab" }, receipt: { state, reason, confirmedAt } });
const ON = new Set([PEER_RECEIPTS_FEATURE]);

describe("reading crossHost", () => {
  it("keeps a valid object (unknown states and reasons too) and drops malformed ones", () => {
    expect(asCrossHost(wire("accepted"))).toEqual(wire("accepted"));
    expect(asCrossHost(wire("pausedSomewhere", "newReason"))?.receipt).toEqual({ state: "pausedSomewhere", reason: "newReason", confirmedAt: "2026-11-25T10:00:00Z" });
    expect(asCrossHost({ ...wire("accepted"), direction: "sideways" })).toBeNull();
    expect(asCrossHost({ ...wire("accepted"), peer: { instanceId: "workstation-lab", label: "x" } })).toBeNull();
    expect(asCrossHost({ ...wire("accepted"), receipt: null })).toBeNull();
    expect(asCrossHost(wire("accepted", null, "not a date"))?.receipt.confirmedAt).toBeNull();
    expect(asCrossHost(null)).toBeNull();
  });

  it("is shown only on a host with peer-delivery-receipts-v1 and a record that carries one", () => {
    expect(crossHostOf({ crossHost: wire("accepted") }, ON)?.receipt.state).toBe("accepted");
    expect(crossHostOf({ crossHost: wire("accepted") }, new Set())).toBeNull();
    expect(crossHostOf({}, ON)).toBeNull();
  });
});

describe("receipt words", () => {
  const t = (key: string, vars?: Record<string, string | number>) => {
    const table = { ...zhCN, "delegation.status.cancelled": "已取消", "delegation.status.interrupted": "已中断", "delegation.status.outcomeUnknown": "结果未确认" } as Record<string, string>;
    return (table[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ""));
  };
  const ch = (state: string, reason: string | null = null) => asCrossHost(wire(state, reason))!;

  it("the five states and the fixed reasons in the spec's short words", () => {
    expect(receiptWords(t, ch("queuedAtSource")).state).toBe("来源主机待发送");
    expect(receiptWords(t, ch("deliveredToPeer")).state).toBe("已送达对端");
    expect(receiptWords(t, ch("accepted")).state).toBe("对端已接单");
    expect(receiptWords(t, ch("failed", "destinationRoutingRefused"))).toEqual({ state: "失败", reason: "目的项目限制跨主机委托" });
    expect(receiptWords(t, ch("queuedAtSource", "sourceRoutingRefused")).reason).toBe("发起项目限制跨主机委托");
    expect(receiptWords(t, ch("failed", "peerRefusedUnspecified")).reason).toBe("目的主机拒绝了请求，未提供具体原因");
    expect(receiptWords(t, ch("failed", "cancelled")).reason).toBe("已取消");
    // A reason that only repeats the state adds nothing.
    expect(receiptWords(t, ch("outcomeUnknown", "outcomeUnknown"))).toEqual({ state: "送达结果待确认", reason: null });
    expect(receiptWords(t, ch("brandNew", "otherNew"))).toEqual({ state: "回执无法识别", reason: "原因代码 otherNew" });
  });

  it("every fixed reason has words in zh-CN and en", () => {
    for (const r of ["sourceRoutingRefused", "destinationRoutingRefused", "peerRefusedUnspecified", "peerUnreachable", "peerCredentialRefused", "peerIdentityChanged", "peerVersionMismatch", "peerRemoved", "peerDisabled", "peerRejectedRequest", "destinationRejected", "destinationFailed"]) {
      const key = reasonMessageKey(r)!;
      expect(key).toBe(`crossHost.reason.${r}`);
      expect((zhCN as Record<string, string>)[key]).toBeTruthy();
      expect((en as Record<string, string>)[key]).toBeTruthy();
    }
    expect(reasonMessageKey("interrupted")).toBe("delegation.status.interrupted");
    expect(receiptKey("whatever")).toBe("unknown");
  });

  it("loudness: a route refusal is a separate fact from the connection; only trouble shows in list rows", () => {
    expect(receiptTone(ch("failed", "destinationRoutingRefused"))).toBe("danger");
    expect(receiptTone(ch("queuedAtSource", "sourceRoutingRefused"))).toBe("warn");
    expect(receiptTone(ch("queuedAtSource"))).toBe("muted");
    expect(receiptTone(ch("accepted"))).toBe("green");
    expect(receiptNeedsNotice(ch("deliveredToPeer"))).toBe(false);
    expect(receiptNeedsNotice(ch("outcomeUnknown"))).toBe(true);
  });
});

describe("which connected host the peer is", () => {
  const view = (id: string, label: string, instanceId: string | null, connected = true) => ({
    id, label, kind: id === "local" ? "local" : "ssh",
    conn: connected ? { epoch: `e-${id}`, tunnel: null, cutexBuild: null, daemon: instanceId ? { kind: "connected", baseUrl: "", hostId: id, instanceId } : { kind: "connected", baseUrl: "", hostId: id } } : undefined,
  });
  const source = (views: ReturnType<typeof view>[]): ScopeSource => ({
    hosts: { active: "local", hosts: views } as never,
    daemon: (views.find((v) => v.id === "local")?.conn?.daemon ?? { kind: "unreachable", baseUrl: "", message: "" }) as never,
    byHost: Object.fromEntries(views.filter((v) => v.id !== "local" && v.conn).map((v) => [v.id, { daemon: v.conn!.daemon as never }])),
  });

  it("matches by instance id only: the same name with another identity is not that host", () => {
    const s = source([view("local", "This PC", "ci-11111111111111111111111111111111"), view("lab", "workstation-lab", LAB2), view("lab-b", "Lab B", LAB)]);
    expect(peerHostIn(s, LAB)).toEqual({ hostId: "lab-b", label: "Lab B" });
    // The current desktop name wins over the record's snapshot.
    expect(peerHostView(s, LAB, "workstation-lab")).toMatchObject({ name: "Lab B", hostId: "lab-b" });
    // No connected host has this id: the snapshot name, not connected; another host of the same name → the hover shows the id.
    const v = peerHostView(s, "ci-99999999999999999999999999999999", "workstation-lab");
    expect(v).toMatchObject({ name: "workstation-lab", hostId: null, ambiguous: true });
  });

  it("a disconnected host is never matched (even with the right name)", () => {
    const s = source([view("local", "This PC", null), view("lab", "workstation-lab", null, false)]);
    expect(peerHostIn(s, LAB)).toBeNull();
    expect(peerHostIn(s, "not-an-instance-id")).toBeNull();
  });
});

describe("records keep their receipt", () => {
  const ask = (extra: Record<string, unknown> = {}) => ({ askId: "ask-x", title: "t", requester: { kind: "owner" }, target: "cutex.t", execution: "queued", revision: 3, createdAt: "2026-11-25T09:00:00Z", attempts: 0, remote: { peerId: LAB, label: "workstation-lab", targetName: "worker", syncState: "queued" }, ...extra });

  it("a full record and a newer state event carry it; peerSideOf names the instance", () => {
    const s = summaryFromRecord(ask({ crossHost: wire("queuedAtSource", "sourceRoutingRefused") }))!;
    expect(s.crossHost?.receipt.reason).toBe("sourceRoutingRefused");
    expect(peerSideOf(s)).toMatchObject({ side: "target", label: "workstation-lab", instanceId: LAB });
    expect(summaryFromRecord(ask({ crossHost: { broken: true } }))!.crossHost).toBeUndefined();
    expect(peerSideOf(summaryFromRecord(ask())!)?.instanceId).toBeNull();
    const next = applyAskEvent({ byId: { "ask-x": s }, progress: {}, questions: {} } as never, "cutex/ask/stateChanged", { askId: "ask-x", revision: 4, execution: "failed", crossHost: wire("failed", "destinationRoutingRefused") });
    expect(next?.byId?.["ask-x"]?.crossHost?.receipt).toMatchObject({ state: "failed", reason: "destinationRoutingRefused" });
  });

  it("a late observation of a note never moves its receipt back", () => {
    const at = 1_700_000_000;
    let map = applyMessageEvent({}, "cutex/agentBus/messageDelivered", { messageId: "ptell-1", fromCutexSessionId: "a", toCutexSessionId: "b", crossHost: wire("deliveredToPeer", null, "2026-11-25T10:05:00Z") }, at);
    map = applyMessageEvent(map, "cutex/agentBus/messageQueued", { messageId: "ptell-1", fromCutexSessionId: "a", toCutexSessionId: "b", crossHost: wire("queuedAtSource", null, "2026-11-25T10:00:00Z") }, at);
    expect(map["ptell-1"]?.crossHost?.receipt.state).toBe("deliveredToPeer");
    map = seedMessages(map, "a", [], [{ messageId: "ptell-1", toCutexSessionId: "b", crossHost: wire("failed", "peerRejectedRequest", "2026-11-25T10:09:00Z") }]);
    expect(map["ptell-1"]?.crossHost?.receipt).toMatchObject({ state: "failed", reason: "peerRejectedRequest" });
  });

  it("newerCrossHost: an older confirmation or a step back keeps what is known", () => {
    const a = asCrossHost(wire("accepted", null, "2026-11-25T10:05:00Z")) as CrossHost;
    expect(newerCrossHost(a, asCrossHost(wire("deliveredToPeer", null, "2026-11-25T10:06:00Z")))).toBe(a);
    expect(newerCrossHost(a, asCrossHost(wire("failed", "destinationFailed", "2026-11-25T10:04:00Z")))).toBe(a);
    expect(newerCrossHost(a, asCrossHost(wire("failed", "destinationFailed", "2026-11-25T10:07:00Z")))?.receipt.state).toBe("failed");
    expect(newerCrossHost(null, a)).toBe(a);
    expect(newerCrossHost(a, null)).toBe(a);
  });
});
