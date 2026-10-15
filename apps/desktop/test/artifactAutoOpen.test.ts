// Auto-open of an agent's live publish (modules/artifacts/autoOpen.ts; docs/research/agent-side-display-20261013.md §3.2 B).
import { describe, expect, it } from "vitest";
import { autoOpenEvent, autoOpenSetting, CLOSED_QUIET_MS, decideAutoOpen, isVisual, parsePublished, parseShowRequested, type AutoOpenContext } from "../src/renderer/src/modules/artifacts/autoOpen";
import { isLiveEvent, LIVE_WINDOW_MS } from "../src/renderer/src/lib/liveEvents";

const ID = "af-0123456789abcdef0123456789abcdef";
const START = 1_000_000;
const NOW = START + 60_000;
const ev = { hostId: "local", sessionId: "s1", name: "figures/doodle.html", kind: "figure", receivedAt: NOW - 500 };
const ctx = (patch: Partial<AutoOpenContext> = {}): AutoOpenContext => ({ setting: "open", now: NOW, startedAt: START, viewing: { hostId: "local", sessionId: "s1" }, typing: false, closedAt: null, ...patch });

describe("auto-open policy", () => {
  it("reveals a visual publish of the agent in view", () => {
    expect(decideAutoOpen(ev, ctx())).toEqual({ action: "reveal" });
  });
  it("never opens for another agent, another host, or no conversation in view", () => {
    expect(decideAutoOpen(ev, ctx({ viewing: { hostId: "local", sessionId: "s2" } }))).toEqual({ action: "none", reason: "other-agent" });
    expect(decideAutoOpen(ev, ctx({ viewing: { hostId: "workstation", sessionId: "s1" } }))).toEqual({ action: "none", reason: "other-agent" });
    expect(decideAutoOpen(ev, ctx({ viewing: null }))).toEqual({ action: "none", reason: "other-agent" });
  });
  it("goes to the background while the owner types", () => {
    expect(decideAutoOpen(ev, ctx({ typing: true }))).toEqual({ action: "background", why: "typing" });
  });
  it("goes to the background for 10 min after the owner closed the right column here", () => {
    expect(decideAutoOpen(ev, ctx({ closedAt: NOW - 1000 }))).toEqual({ action: "background", why: "closed" });
    expect(decideAutoOpen(ev, ctx({ closedAt: NOW - CLOSED_QUIET_MS - 1 }))).toEqual({ action: "reveal" });
  });
  it("puts a report / table in the background", () => {
    expect(decideAutoOpen({ ...ev, name: "reports/regression.md", kind: "report" }, ctx())).toEqual({ action: "background", why: "not-visual" });
  });
  it("follows the setting: just tell me / do nothing", () => {
    expect(decideAutoOpen(ev, ctx({ setting: "notify" }))).toEqual({ action: "notify" });
    expect(decideAutoOpen(ev, ctx({ setting: "off" }))).toEqual({ action: "none", reason: "off" });
    expect(autoOpenSetting("bogus")).toBe("open");
    expect(autoOpenSetting("notify")).toBe("notify");
  });
  it("ignores replays, unknown times, owner publishes and auto captures", () => {
    expect(decideAutoOpen({ ...ev, receivedAt: START - 60_000 }, ctx())).toEqual({ action: "none", reason: "replay" });
    expect(decideAutoOpen({ ...ev, receivedAt: NOW - LIVE_WINDOW_MS - 1 }, ctx())).toEqual({ action: "none", reason: "replay" });
    expect(decideAutoOpen({ ...ev, receivedAt: null }, ctx())).toEqual({ action: "none", reason: "replay" });
    expect(decideAutoOpen({ ...ev, sessionId: null }, ctx())).toEqual({ action: "none", reason: "not-agent" });
    expect(isLiveEvent(START - 4000, START + 1000, START)).toBe(true);
  });
  it("visual = page, picture or figure", () => {
    expect(isVisual("a/b.html", "other")).toBe(true);
    expect(isVisual("plot.svg", "other")).toBe(true);
    expect(isVisual("data.csv", "figure")).toBe(true);
    expect(isVisual("notes.md", "report")).toBe(false);
  });
});

describe("cutex/artifact/published parsing", () => {
  const envelope = (params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ eventId: "e1", receivedAt: new Date(NOW).toISOString(), cutex: { method: "cutex/artifact/published", params }, ...extra });
  const agent = { kind: "agent", sessionId: "s1", displayName: "Reader" };
  it("reads the agent producer, name, version and receivedAt", () => {
    expect(parsePublished("local", envelope({ artifactId: ID, version: 2, name: "doodle.html", kind: "figure", producer: agent }), "cutex/artifact/published")).toEqual({
      hostId: "local", eventId: "e1", artifactId: ID, version: 2, name: "doodle.html", kind: "figure", sessionId: "s1", agentName: "Reader", receivedAt: NOW,
    });
  });
  it("owner / auto producers have no session; malformed events are dropped", () => {
    expect(parsePublished("local", envelope({ artifactId: ID, version: 1, name: "x", kind: "report", producer: { kind: "auto", sessionId: "s1" } }), "cutex/artifact/published")?.sessionId).toBeNull();
    expect(parsePublished("local", envelope({ artifactId: "af-x", version: 1, name: "x", producer: agent }), "cutex/artifact/published")).toBeNull();
    expect(parsePublished("local", envelope({ artifactId: ID, version: 0, name: "x", producer: agent }), "cutex/artifact/published")).toBeNull();
    expect(parsePublished("local", { cutex: { method: "cutex/artifact/updated", params: {} } }, "cutex/artifact/published")).toBeNull();
  });
});

describe("cutex/artifact/showRequested (capability artifact-show)", () => {
  const published = { eventId: "p1", receivedAt: new Date(NOW).toISOString(), cutex: { method: "cutex/artifact/published", params: { artifactId: ID, version: 3, name: "doodle.html", kind: "figure", producer: { kind: "agent", sessionId: "s1", displayName: "Reader" } } } };
  const show = (patch: Record<string, unknown> = {}) => ({ eventId: "e7", receivedAt: new Date(NOW).toISOString(), cutex: { method: "cutex/artifact/showRequested", params: {
    artifactId: ID, version: 3, ref: `${ID}@3`, scope: { kind: "project", id: "p" }, name: "doodle.html", kind: "figure", mediaType: "text/html",
    cutexSessionId: "s1", displayName: "Reader", hostId: "workstation-machine", newVersion: true, requestedAt: new Date(NOW).toISOString(), ...patch } } });
  const SHOW = new Set(["artifacts", "artifact-show"]), OLD = new Set(["artifacts"]);
  it("reads session, display name and the envelope's host (not cutex's machine name)", () => {
    expect(parseShowRequested("local", show())).toEqual({ hostId: "local", eventId: "e7", artifactId: ID, version: 3, name: "doodle.html", kind: "figure", sessionId: "s1", agentName: "Reader", receivedAt: NOW });
    expect(parseShowRequested("local", show({ displayName: null }))?.agentName).toBeNull();
    expect(parseShowRequested("local", show({ cutexSessionId: "" }))).toBeNull();
    expect(parseShowRequested("local", show({ artifactId: "af-x" }))).toBeNull();
    expect(parseShowRequested("local", published)).toBeNull();
  });
  it("a host with artifact-show drives auto-open from show requests only; plain publishes open nothing", () => {
    expect(autoOpenEvent("local", show(), SHOW)?.eventId).toBe("e7");
    expect(autoOpenEvent("local", published, SHOW)).toBeNull();
  });
  it("a host without the capability keeps the published path and ignores show requests", () => {
    expect(autoOpenEvent("local", published, OLD)?.eventId).toBe("p1");
    expect(autoOpenEvent("local", show(), OLD)).toBeNull();
  });
  it("a show request goes through the same policy (setting, viewing, typing, just closed, replay)", () => {
    const ev = autoOpenEvent("local", show(), SHOW)!;
    expect(decideAutoOpen(ev, ctx())).toEqual({ action: "reveal" });
    expect(decideAutoOpen(ev, ctx({ setting: "notify" }))).toEqual({ action: "notify" });
    expect(decideAutoOpen(ev, ctx({ setting: "off" }))).toEqual({ action: "none", reason: "off" });
    expect(decideAutoOpen(ev, ctx({ typing: true }))).toEqual({ action: "background", why: "typing" });
    expect(decideAutoOpen(ev, ctx({ closedAt: NOW - 1000 }))).toEqual({ action: "background", why: "closed" });
    expect(decideAutoOpen(ev, ctx({ viewing: { hostId: "local", sessionId: "s2" } }))).toEqual({ action: "none", reason: "other-agent" });
    expect(decideAutoOpen({ ...ev, receivedAt: START - 60_000 }, ctx())).toEqual({ action: "none", reason: "replay" });
  });
});
