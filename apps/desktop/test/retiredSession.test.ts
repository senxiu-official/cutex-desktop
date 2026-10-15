import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { withRetiredDefaults } from "../src/renderer/src/lib/retiredSession";

// What `GET /v2/sessions?lifecycle=retired` returns (cutex retired_session_resource_value).
const retired = {
  contractVersion: 2,
  cutexSessionId: "cutex.1",
  revision: 4,
  lifecycle: "retired",
  retiredAt: "2026-10-08T00:00:00Z",
  hostId: "HOST-A",
  displayName: "Rust 生命周期报错",
  threadName: null,
  cwd: null,
  managedCwd: null,
  profile: null,
  groups: [],
  registrationClass: "local_only",
  native: { threadId: "thread-1" },
  runtime: { backend: "host_background", status: "offline", runtimeGeneration: 3, runtimeAgentId: null },
  runtimeDefaults: null,
  activity: null,
  createdAt: null,
  updatedAt: null,
} as unknown as SessionResource;

describe("withRetiredDefaults", () => {
  it("fills the fields the archive projection leaves out", () => {
    const s = withRetiredDefaults(retired);
    // The black screen: Conversation read `effectiveNextLaunch.profile` of a just-archived agent.
    expect(s.effectiveNextLaunch).toEqual({ profile: null, source: "retired" });
    expect(s.native).toEqual({ threadId: "thread-1", schema: null });
    expect(s.runtime.activeTurnId).toBeNull();
    expect(s.runtime.threadSettings).toBeNull();
    expect(s.runtime.runtimeGeneration).toBe(3);
    expect(s.runtime.backend).toBe("host_background");
    expect(s.note).toBeNull();
    expect(s.avatar).toBeNull();
    expect(s.displayName).toBe("Rust 生命周期报错");
  });

  it("keeps what cutex did send", () => {
    const full = withRetiredDefaults({ ...retired, profile: "omega", note: "n", effectiveNextLaunch: { profile: "omega", source: "session_configured" } });
    expect(full.effectiveNextLaunch).toEqual({ profile: "omega", source: "session_configured" });
    expect(full.configuredProfile).toBe("omega");
    expect(full.note).toBe("n");
  });
});
