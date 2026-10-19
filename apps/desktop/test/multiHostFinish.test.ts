// Multi-host P1 finish: per-host keys and filters used by the open agent of a non-focus host.
import { describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { AskSummary } from "../src/shared/ipc";
import { attentionChips, type AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { hostDelegations } from "../src/renderer/src/lib/delegationStore";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import { emptyPendingChat } from "../src/renderer/src/lib/pendingChat";
import type { AgentRow } from "../src/renderer/src/lib/sidebar";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

function row(id: string, hostId: string): AgentRow {
  const session = { cutexSessionId: id, displayName: id, runtime: {} } as unknown as SessionResource;
  return { id, key: hostKey(hostId, id), hostId, name: `${id}@${hostId}`, subtitle: "", status: "idle", isDirector: false, pinned: false, lastActivity: 0, profile: null, color: null, session };
}

// (v1.17, docs/desktop-modules.md §24: the side layout's per-agent view keys are gone with §18.5's views;
// the panes key conversation views by host + id in lib/viewKey, test/viewKey.test.ts.)

describe("delegations per host", () => {
  const ask = (askId: string) => ({ askId }) as unknown as AskSummary;
  const byKey = { [hostKey("local", "a1")]: ask("a1"), [hostKey("workstation", "a2")]: ask("a2"), [hostKey("local", "a3")]: ask("a3") };

  it("splits the host-keyed records by host, by ask id", () => {
    expect(Object.keys(hostDelegations(byKey, "local"))).toEqual(["a1", "a3"]);
    expect(Object.keys(hostDelegations(byKey, "workstation"))).toEqual(["a2"]);
    expect(hostDelegations(byKey, "other")).toEqual({});
  });
});

describe("需要你 strip across hosts", () => {
  it("keys chips by host + id, excludes only the open agent of its own host", () => {
    const rows = [row("a", "local"), row("a", "workstation"), row("b", "workstation")];
    const signals = new Map<string, AgentSignal>(rows.map((r) => [r.key!, "needsYou"]));
    const chips = attentionChips(rows, signals, new Map(), () => undefined, hostKey("local", "a"));
    expect(chips.map((c) => c.key)).toEqual([hostKey("workstation", "a"), hostKey("workstation", "b")]);
    expect(chips.every((c) => c.hostId === "workstation")).toBe(true);
  });

  it("still reads bare-id rows (one host) by id", () => {
    const plain = { ...row("x", "local"), key: undefined, hostId: undefined };
    const chips = attentionChips([plain], new Map([["x", "error"]]), new Map(), {}, null);
    expect(chips).toMatchObject([{ id: "x", key: "x", signal: "error" }]);
    expect(chips[0]!.hostId).toBeUndefined();
  });
});

describe("quick chat draft host", () => {
  it("starts without a host (the page picks one) or on the menu's host", () => {
    expect(emptyPendingChat(null).hostId).toBeNull();
    expect(emptyPendingChat("p1", "workstation")).toMatchObject({ hostId: "workstation", profile: "p1" });
  });
});
