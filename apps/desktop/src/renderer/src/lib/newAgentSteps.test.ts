import { describe, expect, it } from "vitest";
import type { ExtraInput } from "../../../shared/ipc";
import { NewAgentStepError, NO_PROGRESS, runNewAgentSteps, type NewAgentOps, type NewAgentProgress } from "./newAgentSteps";

function harness(fail: { director?: number; start?: number; message?: number; appearance?: number } = {}) {
  const calls: string[] = [];
  const messages: { text: string; extra: ExtraInput[] }[] = [];
  let directorFails = fail.director ?? 0;
  let startFails = fail.start ?? 0;
  let messageFails = fail.message ?? 0;
  let appearanceFails = fail.appearance ?? 0;
  const ops: NewAgentOps = {
    create: async (start) => {
      calls.push(`create(start=${start})`);
      return "a1";
    },
    refresh: async () => {
      calls.push("refresh");
    },
    assignDirector: async (id) => {
      calls.push(`director(${id})`);
      if (directorFails-- > 0) throw new Error("cas");
    },
    start: async (id) => {
      calls.push(`start(${id})`);
      if (startFails-- > 0) throw new Error("no creds");
    },
    submit: async (id, text, extra) => {
      calls.push(`message(${id},${text})`);
      messages.push({ text, extra });
      if (messageFails-- > 0) throw new Error("network");
    },
  };
  if (fail.appearance !== undefined) ops.saveAppearance = async (id) => {
    calls.push(`appearance(${id})`);
    if (appearanceFails-- > 0) throw new Error("metadata unavailable");
  };
  let progress: NewAgentProgress = NO_PROGRESS;
  const run = (plan: { start: boolean; director: boolean; message?: string; extra?: ExtraInput[] }) =>
    runNewAgentSteps(ops, plan, progress, (p) => {
      progress = p;
    });
  return { calls, messages, run, progress: () => progress };
}

describe("runNewAgentSteps", () => {
  it("starts and sends an image-only first message, preserving the payload on retry", async () => {
    const h = harness({ message: 1 });
    const extra: ExtraInput[] = [{ type: "image", url: "data:image/png;base64,YWJj" }, { type: "localImage", path: "C:\\Pictures\\first.png" }];
    const plan = { start: false, director: false, message: "  ", extra };
    const error = await h.run(plan).catch((e) => e);
    expect(error.step).toBe("message");
    expect(h.calls).toEqual(["create(start=true)", "refresh", "message(a1,)"]);
    expect(h.messages[0]).toEqual({ text: "", extra });
    h.calls.length = 0;
    await h.run(plan);
    expect(h.calls).toEqual(["refresh", "message(a1,)"]);
    expect(h.messages[1]).toEqual(h.messages[0]);
    await h.run(plan);
    expect(h.messages).toHaveLength(2);
  });

  it("sends text and attachments only after assigning and starting a Director", async () => {
    const h = harness();
    const extra: ExtraInput[] = [{ type: "image", url: "data:image/png;base64,YWJj" }];
    await h.run({ start: false, director: true, message: "  describe this  ", extra });
    expect(h.calls).toEqual(["create(start=false)", "refresh", "director(a1)", "refresh", "start(a1)", "message(a1,describe this)"]);
    expect(h.messages).toEqual([{ text: "describe this", extra }]);
  });

  it("saves the avatar before the first task and retries metadata without creating twice", async () => {
    const h = harness({ appearance: 1 });
    const plan = { start: true, director: false, message: "hello" };
    const err = await h.run(plan).catch((e) => e);
    expect(err.step).toBe("appearance");
    expect(h.calls).toEqual(["create(start=true)", "appearance(a1)"]);
    expect(h.progress().agent).toBe("a1");
    h.calls.length = 0;
    await h.run(plan);
    expect(h.calls).toEqual(["appearance(a1)", "refresh", "message(a1,hello)"]);
    h.calls.length = 0;
    await h.run(plan);
    expect(h.calls).toEqual(["refresh"]);
  });
  it("delivers the first task only after the Director is assigned and started", async () => {
    const h = harness();
    await h.run({ start: true, director: true, message: "  map the repo  " });
    expect(h.calls).toEqual(["create(start=false)", "refresh", "director(a1)", "refresh", "start(a1)", "message(a1,map the repo)"]);
    expect(h.progress().messageSent).toBe(true);
  });

  it("keeps the created agent on a send failure and does not resend a completed task", async () => {
    const h = harness({ message: 1 });
    const plan = { start: true, director: false, message: "hello" };
    const err = await h.run(plan).catch((e) => e);
    expect(err.step).toBe("message");
    expect(h.progress().agent).toBe("a1");
    h.calls.length = 0;
    await h.run(plan);
    expect(h.calls).toEqual(["refresh", "message(a1,hello)"]);
    h.calls.length = 0;
    await h.run(plan);
    expect(h.calls).toEqual(["refresh"]);
  });

  it("creates an empty agent without sending a blank task", async () => {
    const h = harness();
    await h.run({ start: false, director: false, message: "  " });
    expect(h.calls).toEqual(["create(start=false)", "refresh"]);
  });
  it("member: cutex starts it on create", async () => {
    const h = harness();
    expect(await h.run({ start: true, director: false })).toBe("a1");
    expect(h.calls).toEqual(["create(start=true)", "refresh"]);
  });

  it("Director: create stopped → assign → start", async () => {
    const h = harness();
    await h.run({ start: true, director: true });
    expect(h.calls).toEqual(["create(start=false)", "refresh", "director(a1)", "refresh", "start(a1)"]);
  });

  it("Director without start never starts", async () => {
    const h = harness();
    await h.run({ start: false, director: true });
    expect(h.calls).toEqual(["create(start=false)", "refresh", "director(a1)", "refresh"]);
  });

  it("Director failure: not started; retry assigns then starts, no second create", async () => {
    const h = harness({ director: 1 });
    const err = await h.run({ start: true, director: true }).catch((e) => e);
    expect(err).toBeInstanceOf(NewAgentStepError);
    expect(err.step).toBe("director");
    expect(h.calls).not.toContain("start(a1)");
    expect(h.progress()).toEqual({ agent: "a1", directorAssigned: false });
    h.calls.length = 0;
    await h.run({ start: true, director: true });
    expect(h.calls).toEqual(["refresh", "director(a1)", "refresh", "start(a1)"]);
  });

  it("start failure: retry only starts, even once the Director option is gone", async () => {
    const h = harness({ start: 1 });
    const err = await h.run({ start: true, director: true }).catch((e) => e);
    expect(err.step).toBe("start");
    expect(h.progress()).toEqual({ agent: "a1", directorAssigned: true });
    h.calls.length = 0;
    // The project now has a Director, so the page no longer plans one.
    await h.run({ start: true, director: false });
    expect(h.calls).toEqual(["refresh", "start(a1)"]);
  });
});
