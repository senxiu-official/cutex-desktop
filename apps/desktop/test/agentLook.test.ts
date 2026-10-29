// lib/agentLook: an avatar's Profile colour / 头像主题 / importance from the agent id alone.
import { describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";

vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign(() => null, { getState: () => ({}) }), featuresOf: () => new Set(), pinnedOn: (hostId: string) => new Set(hostId === "hosta" ? ["t-pinned"] : []) }));

const { agentIndex, lookOf, sessionProfileName } = await import("../src/renderer/src/lib/agentLook");

const session = (id: string, over: Partial<SessionResource> = {}): SessionResource =>
  ({
    cutexSessionId: id,
    displayName: id,
    profile: "omega",
    configuredProfile: "omega",
    launchedProfile: "omega",
    effectiveNextLaunch: { profile: "omega", source: "session_configured" },
    runtime: { backend: "codex", status: "online" },
    runtimeDefaults: null,
    native: { threadId: null, schema: null },
    ...over,
  }) as SessionResource;

const snapshot = (sessions: SessionResource[], director?: string, styles: Record<string, string> = {}): SidebarSnapshot => ({
  active: sessions,
  retired: [],
  projects: director ? ({ schema: "x", projects: [{ project_id: "p", director_cutex_session_id: director }] } as never) : null,
  hostRows: Object.fromEntries(sessions.map((s) => [s.cutexSessionId, { id: s.cutexSessionId, profileStyle: styles[s.cutexSessionId] ? { color: styles[s.cutexSessionId] } : null } as never])),
});

describe("agentIndex", () => {
  it("indexes the focus host and other hosts, with Directors and pins", () => {
    const index = agentIndex({
      hosts: { active: "local" },
      sidebar: snapshot([session("eva"), session("mika")], "eva"),
      byHost: { hosta: { sidebar: snapshot([session("t-pinned"), session("t-plain")]) } },
      pinned: new Set(["mika"]),
    });
    expect(index.get("eva")).toMatchObject({ hostId: "local", isDirector: true, pinned: false });
    expect(index.get("mika")).toMatchObject({ hostId: "local", isDirector: false, pinned: true });
    expect(index.get("t-pinned")).toMatchObject({ hostId: "hosta", pinned: true });
    expect(index.get("t-plain")).toMatchObject({ hostId: "hosta", pinned: false });
    expect(index.get("nobody")).toBeUndefined();
  });

  it("is memoised per snapshot set", () => {
    const s = { hosts: { active: "local" }, sidebar: snapshot([session("a")]), byHost: {}, pinned: new Set<string>() };
    expect(agentIndex(s)).toBe(agentIndex({ ...s }));
    expect(agentIndex(s)).not.toBe(agentIndex({ ...s, sidebar: snapshot([session("a")]) }));
  });
});

describe("lookOf", () => {
  const entry = (s: SessionResource, color?: string) => ({ hostId: "local", session: s, row: color ? ({ profileStyle: { color } } as never) : undefined, isDirector: false, pinned: false });
  const gpt = { id: "p-gamma", name: "gamma", model: "gpt-5.5", cliKind: "codex", appearance: { color: "#7950f2", effectiveColor: null, providerCategory: null } };

  it("Profile known: its colour and model-family theme; the owner's choice wins", () => {
    expect(lookOf(entry(session("a")), gpt, null)).toMatchObject({ color: "#7950f2", themes: ["gems"] });
    expect(lookOf(entry(session("a")), gpt, ["plants"]).themes).toEqual(["plants"]);
    expect(lookOf(entry(session("a")), gpt, ["sky", "plants"]).themes).toEqual(["plants", "sky"]);
    // cutex's profileStyle on the host row comes first
    expect(lookOf(entry(session("a"), "#123456"), gpt, null).color).toBe("#123456");
  });

  it("a Profile without its own model takes the session's (owner 2026-10-28: Shared agents created with a per-session model)", () => {
    // Profile Shared carries no model; the session's runtimeDefaults says gpt-6-astra → openai, not "other".
    const noModel = { ...gpt, model: null };
    const withDefaults = session("osprey", { runtimeDefaults: { model: "gpt-6-astra" } as never });
    expect(lookOf(entry(withDefaults), noModel, null)).toMatchObject({ family: "openai", themes: ["gems"] });
    const withNext = session("kittiwake", { effectiveNextLaunch: { profile: "omega", source: "session_configured", model: "gpt-6-astra" } });
    expect(lookOf(entry(withNext), noModel, null).family).toBe("openai");
    // the Profile's own model still wins; no facts anywhere → other (no portrait pool, nothing borrowed)
    expect(lookOf(entry(session("a")), gpt, null).family).toBe("openai");
    expect(lookOf(entry(session("bare", { profile: null, configuredProfile: null, launchedProfile: null })), noModel, null).family).toBe("other");
    // A Claude runtime with no model string is claude by itself — the "Profile not loaded" test above covers it
    // (`claude_subscription` backend → animals); a Claude creator is never inherited through an OpenAI Profile.
  });

  it("the cached entry carries follow intent and an explicit empty fixed letter", () => {
    expect(lookOf(entry(session("follow", { avatarMode: "inherit", avatar: null })), null, null)).toMatchObject({ avatarMode: "inherit", fixedLetter: false });
    expect(lookOf(entry(session("letter", { avatarMode: "fixed", avatar: null })), null, null)).toMatchObject({ avatarMode: "fixed", fixedLetter: true });
    expect(lookOf(entry(session("emoji", { avatarMode: "fixed", avatar: { kind: "emoji", value: "E" } })), null, null)).toMatchObject({ avatarMode: "fixed", fixedLetter: false });
  });

  it("Profile without a colour → the Profile name's hash colour", () => {
    const look = lookOf(entry(session("a")), { ...gpt, appearance: { color: null, effectiveColor: null, providerCategory: null } }, null);
    expect(look.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("Profile not loaded: theme from the session's own runtime / model, no colour", () => {
    const claude = session("c", { runtime: { backend: "claude_subscription", status: "online" } as never });
    expect(lookOf(entry(claude), null, null)).toMatchObject({ color: null, themes: ["animals"] });
    const ds = session("d", { effectiveNextLaunch: { profile: "x", source: "s", model: "deepseek-v4-pro" } });
    expect(lookOf(entry(ds), null, null).themes).toEqual(["sea"]);
    expect(lookOf(entry(session("z")), null, null).themes).toEqual(["animals", "sea", "gems", "plants", "food", "sky"]);
  });

  it("no selection input: the look never depends on which agent is open", () => {
    expect(lookOf(entry(session("a")), gpt, null)).not.toHaveProperty("open");
  });

  it("the profile a session names: launched, else configured", () => {
    expect(sessionProfileName(session("a", { launchedProfile: null, configuredProfile: "GLM" }))).toBe("GLM");
    expect(sessionProfileName(session("a", { launchedProfile: "claude" }))).toBe("claude");
  });
});

describe("portraitsWornIn", () => {
  it("the pack pictures stored in one project on one host; other projects, hosts and avatar kinds don't count", async () => {
    const { portraitsWornIn } = await import("../src/renderer/src/lib/agentLook");
    const pic = (stem: string) => ({ avatar: { kind: "icon" as const, value: `portrait:p/office/${stem}` } });
    const inProject = (sessions: SessionResource[], projects: Record<string, string>): SidebarSnapshot => ({
      ...snapshot(sessions),
      hostRows: Object.fromEntries(sessions.map((s) => [s.cutexSessionId, { id: s.cutexSessionId, projectId: projects[s.cutexSessionId] ?? null } as never])),
    });
    const index = agentIndex({
      hosts: { active: "local" },
      sidebar: inProject([session("a", pic("claude-v1")), session("b", pic("claude-v2")), session("c", { avatar: { kind: "emoji", value: "🦊" } }), session("d", pic("gpt-v1")), session("e")], { a: "p1", b: "p1", c: "p1", d: "p2" }),
      byHost: { hosta: { sidebar: inProject([session("x", pic("claude-v3"))], { x: "p1" }) } },
      pinned: new Set<string>(),
    });
    expect([...portraitsWornIn(index, "local", "p1")].sort()).toEqual(["p/office/claude-v1", "p/office/claude-v2"]);
    expect([...portraitsWornIn(index, "local", "p2")]).toEqual(["p/office/gpt-v1"]);
    expect([...portraitsWornIn(index, "hosta", "p1")]).toEqual(["p/office/claude-v3"]);
    expect(portraitsWornIn(index, "local", null).size).toBe(0);
  });
});
