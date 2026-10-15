// Answering a native server request (store.respond) while another client (phone, second desktop)
// may answer it too: a request resolved elsewhere never comes back into the dock; a failure that a
// retry can fix puts it back.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { translate } from "../src/renderer/src/i18n";

const api = vi.hoisted(() => ({
  respond: vi.fn<(...args: unknown[]) => Promise<void>>(),
  bootstrap: vi.fn<(...args: unknown[]) => Promise<never>>(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api, onEvent: () => () => {} }));

const REQUEST = { id: 7, method: "item/commandExecution/requestApproval", params: { threadId: "t", command: "rm -rf build" } };
const ACCEPT = { result: { decision: "accept" } };
const UNREACHABLE = "cutex management API unreachable at http://127.0.0.1:24270";

const resolvedEvent = (requestId: number) =>
  ({ correlation: {}, native: { kind: "notification", message: { method: "serverRequest/resolved", params: { threadId: "t", requestId } } } }) as unknown as EventEnvelope;

async function seed() {
  const { useApp } = await import("../src/renderer/src/store");
  const timeline = timelineFromThreadRead({ thread: { id: "t", turns: [] } }, [{ runtimeGeneration: 3, native: REQUEST }]);
  useApp.setState({ selectedId: "a", sessions: { a: { timeline, runtimeGeneration: 3, version: 0 } as never }, notice: null });
  return { useApp, timeline };
}

describe("store.respond with several clients", () => {
  beforeEach(() => {
    api.respond.mockReset();
    api.bootstrap.mockReset();
    api.bootstrap.mockImplementation(() => new Promise<never>(() => {}));
  });

  it("success: the card is gone, nothing left in flight", async () => {
    api.respond.mockResolvedValueOnce(undefined);
    const { useApp, timeline } = await seed();
    await useApp.getState().respond(7, ACCEPT);
    expect(api.respond).toHaveBeenCalledWith("a", 3, 7, ACCEPT);
    expect(timeline.pending.size).toBe(0);
    expect(timeline.answering.size).toBe(0);
    expect(useApp.getState().notice).toBeNull();
  });

  it("another client answered first (409 server_request_resolved): not put back, a notice instead of an error", async () => {
    api.respond.mockRejectedValueOnce(new Error("server_request_resolved: the native server request was already resolved"));
    const { useApp, timeline } = await seed();
    await useApp.getState().respond(7, ACCEPT);
    expect(timeline.pending.has("7")).toBe(false);
    expect(timeline.answering.size).toBe(0);
    expect(useApp.getState().notice).toMatchObject({ text: translate("interaction.err.resolved"), tone: "info" });
  });

  it("no longer pending (404 server_request_not_found): not put back", async () => {
    api.respond.mockRejectedValueOnce(new Error("server_request_not_found: the exact native server request is not pending for this runtime generation"));
    const { useApp, timeline } = await seed();
    await useApp.getState().respond(7, ACCEPT);
    expect(timeline.pending.has("7")).toBe(false);
    expect(useApp.getState().notice).toMatchObject({ text: translate("interaction.err.gone"), tone: "info" });
  });

  it("serverRequest/resolved while the reply is in flight: a failing reply does not bring the card back", async () => {
    let fail!: (e: unknown) => void;
    api.respond.mockImplementationOnce(() => new Promise<void>((_, reject) => (fail = reject)));
    const { useApp, timeline } = await seed();
    const answer = useApp.getState().respond(7, ACCEPT);
    expect(timeline.pending.has("7")).toBe(false);
    expect(timeline.answering.has("7")).toBe(true);
    // What the session event handler does with the stream event.
    applyEvent(timeline, resolvedEvent(7));
    fail(new Error(UNREACHABLE));
    await answer;
    expect(timeline.pending.has("7")).toBe(false);
    expect(timeline.answering.size).toBe(0);
    expect(useApp.getState().notice).toBeNull();
  });

  it("a failure a retry can fix (daemon unreachable): the card comes back with the error", async () => {
    api.respond.mockRejectedValueOnce(new Error(UNREACHABLE));
    const { useApp, timeline } = await seed();
    await useApp.getState().respond(7, ACCEPT);
    expect(timeline.pending.get("7")).toEqual(REQUEST);
    expect(timeline.answering.size).toBe(0);
    expect(useApp.getState().notice).toMatchObject({ text: UNREACHABLE, tone: "error" });
  });

  it("runtime restarted (412 stale_runtime_generation): re-reads the agent instead of restoring the card", async () => {
    api.respond.mockRejectedValueOnce(new Error("stale_runtime_generation: the app-server runtime generation no longer matches this request occurrence"));
    const { useApp, timeline } = await seed();
    await useApp.getState().respond(7, ACCEPT);
    expect(timeline.pending.has("7")).toBe(false);
    expect(api.bootstrap.mock.calls.map((call) => call[0])).toEqual(["a"]);
    expect(useApp.getState().sessions.a?.resyncing).toBe(true);
    expect(useApp.getState().notice).toMatchObject({ text: translate("interaction.err.stale"), tone: "info" });
  });
});
