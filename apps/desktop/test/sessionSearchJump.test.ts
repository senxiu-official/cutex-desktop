// Opening an old-task result of another connection (review 2026-11-25 P2-3), with the real lib/jump: the reading
// position is noted BEFORE the switch, so 「回到」 leads back to the agent and turn the owner was reading on the other
// host of the scope; a host outside the scope is not opened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});

import { useApp } from "../src/renderer/src/store";
import { viewKey } from "../src/renderer/src/lib/viewKey";
import { goBack, registerViewport, useJump } from "../src/renderer/src/lib/jump";
import { useFocusRequest } from "../src/renderer/src/lib/focusRequest";
import { openTaskHit } from "../src/renderer/src/lib/sessionSearchStore";

const view = (turns: string[]) => ({ timeline: { turns: turns.map((id) => ({ id })), threadId: null }, loading: false, older: null });
const focused: { sessionId: string; turnId: string }[] = [];
let unprobe: () => void;
let unfocus: () => void;

function setHosts(scope: "all" | "local") {
  useApp.setState({
    hosts: {
      active: "local",
      scope: scope === "all" ? { kind: "all" } : { kind: "host", id: "local" },
      groups: [],
      hosts: [
        { id: "local", kind: "local", label: "This PC", conn: { epoch: "e1", daemon: { kind: "connected" } } },
        { id: "ws", kind: "ssh", label: "workstation", conn: { epoch: "e2", daemon: { kind: "connected" } } },
      ],
    } as never,
  });
}

beforeEach(() => {
  focused.length = 0;
  setHosts("all");
  // Opening on the focus host selects; another host's agent opens there (store openAgent → select with its host).
  const select = async (sessionId: string, hostId?: string) => void useApp.setState({ selectedId: sessionId, selectedHost: hostId && hostId !== "local" ? hostId : null });
  useApp.setState({
    selectedId: "eva",
    selectedHost: null,
    view: { kind: "conversation" },
    sessions: { [viewKey("local", "eva")]: view(["e-t1", "e-t2", "e-t3"]), [viewKey("ws", "scratch")]: view(["s-t1", "s-t2"]) },
    select,
    openAgent: (sessionId: string, hostId: string) => select(sessionId, hostId),
  } as never);
  useJump.setState({ back: null, miss: null, busy: false });
  // The conversation's viewport: reading e-t2 of whatever agent is open.
  unprobe = registerViewport({ get sessionId() { return useApp.getState().selectedId ?? ""; }, capture: () => ({ turnId: useApp.getState().selectedId === "eva" ? "e-t2" : "s-t2", offset: 12, atBottom: false }), toBottom: () => {}, scroller: () => null });
  // The timeline answers focus requests.
  unfocus = useFocusRequest.subscribe((s) => {
    const r = s.request as { sessionId: string; turnId?: string; onDone?: (ok: boolean) => void } | null;
    if (r?.turnId && r.onDone) {
      focused.push({ sessionId: r.sessionId, turnId: r.turnId });
      r.onDone(true);
    }
  });
});
afterEach(() => {
  unprobe();
  unfocus();
});

describe("old-task result of another connection", () => {
  it("opens there at the turn, and 「回到」 returns to where the owner was reading on this host", async () => {
    const result = await openTaskHit({ connectionId: "ws", cutexSessionId: "scratch", turnId: "s-t1" });
    expect(result).toEqual({ status: "focused" });
    expect(useApp.getState()).toMatchObject({ selectedId: "scratch", selectedHost: "ws" });
    expect(focused.at(-1)).toEqual({ sessionId: "scratch", turnId: "s-t1" });
    // Noted before the switch: this host's agent and turn, not the target's.
    expect(useJump.getState().back?.point).toMatchObject({ hostId: "local", sessionId: "eva", turnId: "e-t2", offset: 12 });
    await goBack();
    expect(useApp.getState()).toMatchObject({ selectedId: "eva", selectedHost: null });
    expect(focused.at(-1)).toEqual({ sessionId: "eva", turnId: "e-t2" });
    expect(useJump.getState().back).toBeNull();
  });

  it("回到 from this host back to the other connection works the same way", async () => {
    useApp.setState({ selectedId: "scratch", selectedHost: "ws" });
    await openTaskHit({ connectionId: "local", cutexSessionId: "eva", turnId: "e-t3" });
    expect(useJump.getState().back?.point).toMatchObject({ hostId: "ws", sessionId: "scratch", turnId: "s-t2" });
    await goBack();
    expect(useApp.getState()).toMatchObject({ selectedId: "scratch", selectedHost: "ws" });
    expect(focused.at(-1)).toEqual({ sessionId: "scratch", turnId: "s-t2" });
  });

  it("a connection outside the view scope is not opened (host-offline), nothing changes", async () => {
    setHosts("local");
    expect(await openTaskHit({ connectionId: "ws", cutexSessionId: "scratch", turnId: "s-t1" })).toEqual({ status: "host-offline" });
    expect(useApp.getState()).toMatchObject({ selectedId: "eva", selectedHost: null });
    expect(useJump.getState().back).toBeNull();
  });
});
