// @vitest-environment jsdom
// 开始使用 (onboarding v3, owner 2026-11-26): which step is open (modules/start/model) and the per-device state of
// 接下来可以试试 and the sample project (modules/start/state).
import { beforeEach, describe, expect, it } from "vitest";
import type { DaemonState, ProfileItem } from "../src/shared/ipc";
import { canSend, chosenProfile, firstAgentName, hostStage, profileSettled, profileStage, startStep } from "../src/renderer/src/modules/start/model";
import { dismissTryNext, getStartState, markTryNextDone, noteFirstAgent, reloadStartState, rememberSample, reopenTryNext, setTryNextCollapsed, START_KEY, tryNextFor } from "../src/renderer/src/modules/start/state";

const profile = (name: string, over: Partial<ProfileItem> = {}): ProfileItem => ({ id: name, name, isDefault: false, cliKind: "codex", authKind: "apiKey", authPresent: true, ...over }) as ProfileItem;
const daemon = (d: object) => d as DaemonState;

describe("hostStage", () => {
  it("no host first, then the daemon's state; a local setup problem keeps its kind", () => {
    expect(hostStage(daemon({ kind: "connected" }), true)).toBe("noHost");
    expect(hostStage(daemon({ kind: "connected" }), false)).toBe("connected");
    expect(hostStage(daemon({ kind: "connecting" }), false)).toBe("connecting");
    expect(hostStage(daemon({ kind: "unreachable", setup: "notInstalled" }), false)).toBe("notInstalled");
    expect(hostStage(daemon({ kind: "unreachable", setup: "notRunning" }), false)).toBe("notRunning");
    expect(hostStage(daemon({ kind: "unreachable" }), false)).toBe("unreachable");
  });
});

describe("profileStage / chosenProfile", () => {
  it("unknown until read; none; ready ones default first, a missing login or key apart", () => {
    expect(profileStage(null)).toEqual({ kind: "unknown" });
    expect(profileStage({ defaultProfile: null, profiles: [] })).toEqual({ kind: "none" });
    const stage = profileStage({
      defaultProfile: "b",
      profiles: [profile("a"), profile("b"), profile("gpt", { authKind: "chatgpt", authPresent: false }), profile("key", { authPresent: false })],
    });
    expect(stage.kind).toBe("some");
    if (stage.kind !== "some") return;
    expect(stage.ready.map((p) => p.name)).toEqual(["b", "a"]);
    expect(stage.unready.map((u) => `${u.profile.name}:${u.needs}`)).toEqual(["gpt:login", "key:key"]);
    expect(chosenProfile(stage, "a")?.name).toBe("a");
    expect(chosenProfile(stage, "gpt")?.name).toBe("b"); // picked but cannot run → the first that can
    expect(chosenProfile(stage, null)?.name).toBe("b");
    expect(chosenProfile({ kind: "none" }, "a")).toBeNull();
  });
});

describe("startStep", () => {
  const one = profileStage({ defaultProfile: null, profiles: [profile("a")] });
  const two = profileStage({ defaultProfile: null, profiles: [profile("a"), profile("b")] });
  const unready = profileStage({ defaultProfile: null, profiles: [profile("k", { authPresent: false })] });

  it("host until connected, Profile until one can run and is chosen, then the message", () => {
    expect(startStep("notInstalled", one, true)).toBe("host");
    expect(startStep("connecting", one, true)).toBe("host");
    expect(startStep("connected", { kind: "unknown" }, true)).toBe("profile");
    expect(startStep("connected", { kind: "none" }, true)).toBe("profile");
    expect(startStep("connected", unready, true)).toBe("profile");
    expect(startStep("connected", two, false)).toBe("profile");
    expect(startStep("connected", two, true)).toBe("message");
  });

  it("someone already connected with exactly one Profile that runs goes straight to sending", () => {
    expect(profileSettled(one)).toBe(true);
    expect(profileSettled(two)).toBe(false);
    expect(profileSettled(profileStage({ defaultProfile: null, profiles: [profile("a"), profile("k", { authPresent: false })] }))).toBe(false);
    expect(startStep("connected", one, profileSettled(one))).toBe("message");
  });
});

describe("firstAgentName / canSend", () => {
  it("names the agent after its Profile, else Cutex", () => {
    expect(firstAgentName(profile(" work "))).toBe("work");
    expect(firstAgentName(profile("x".repeat(60)))).toHaveLength(40);
    expect(firstAgentName(null)).toBe("Cutex");
  });

  it("needs text, and a folder unless the host offers a scratch workspace", () => {
    expect(canSend("  ", "/w", true)).toBe("text");
    expect(canSend("hi", " ", false)).toBe("folder");
    expect(canSend("hi", "", true)).toBe("ok");
    expect(canSend("hi", "/w", false)).toBe("ok");
  });
});

describe("接下来可以试试 state", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadStartState();
  });

  it("shows on the first agent only, collapses to a chip, is dismissed, and 帮助 brings it back open", () => {
    expect(tryNextFor(getStartState(), "local", "s1")).toBe(false);
    noteFirstAgent({ hostId: "local", sessionId: "s1" });
    expect(tryNextFor(getStartState(), "local", "s1")).toBe(true);
    expect(tryNextFor(getStartState(), "local", "s2")).toBe(false);
    expect(tryNextFor(getStartState(), "remote", "s1")).toBe(false);
    setTryNextCollapsed(true);
    expect(getStartState().collapsed).toBe(true);
    expect(tryNextFor(getStartState(), "local", "s1")).toBe(true); // the chip
    dismissTryNext();
    expect(tryNextFor(getStartState(), "local", "s1")).toBe(false);
    reopenTryNext();
    expect(getStartState()).toMatchObject({ dismissed: false, collapsed: false });
    expect(tryNextFor(getStartState(), "local", "s1")).toBe(true);
  });

  it("keeps done items once, the sample agent per host, and survives a reload; junk in storage is ignored", () => {
    noteFirstAgent({ hostId: "local", sessionId: "s1" });
    markTryNextDone("delegate");
    markTryNextDone("delegate");
    rememberSample("local", "guide-1");
    reloadStartState();
    expect(getStartState()).toMatchObject({ agent: { hostId: "local", sessionId: "s1" }, done: ["delegate"], sample: { local: "guide-1" } });
    localStorage.setItem(START_KEY, JSON.stringify({ agent: { hostId: 1 }, done: ["delegate", "nope"], sample: { a: 2, b: "x" }, collapsed: "yes" }));
    reloadStartState();
    expect(getStartState()).toEqual({ agent: null, collapsed: false, dismissed: false, done: ["delegate"], sample: { b: "x" } });
    localStorage.setItem(START_KEY, "{");
    reloadStartState();
    expect(getStartState().agent).toBeNull();
  });
});
