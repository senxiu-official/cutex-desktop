// lib/agentLook: an avatar's Profile colour / 头像主题 / importance from the agent id alone.
import { describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";

vi.mock("../src/renderer/src/store", () => ({ useApp: () => null, pinnedOn: (hostId: string) => new Set(hostId === "hosta" ? ["t-pinned"] : []) }));

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
