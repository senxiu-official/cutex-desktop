// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, onEvent: () => () => {} }));
import { useApp } from "../src/renderer/src/store";
import { followAgentProfile, setAgentAvatar } from "../src/renderer/src/lib/menus";
import { withRetiredDefaults } from "../src/renderer/src/lib/retiredSession";
const action = vi.fn().mockResolvedValue({});
const session = { cutexSessionId: "mode-test", displayName: "Mode", revision: 7, avatar: null, avatarMode: null, runtime: { status: "offline" } } as unknown as SessionResource;
beforeEach(() => { action.mockClear(); useApp.setState({ hosts: null, features: new Set(["session-metadata", "session-avatar-mode"]), sessionAction: action as never }); });
it("explicit follow and letter reset carry the same revision-fenced domain", async () => {
  await followAgentProfile(session, "local");
  expect(action).toHaveBeenLastCalledWith("mode-test", "cutex/session/metadata/update", { avatarMode: "inherit", expectedRevision: 7 }, "local");
  await setAgentAvatar({ ...session, avatarMode: "inherit" }, "local", null);
  expect(action).toHaveBeenLastCalledWith("mode-test", "cutex/session/metadata/update", { avatarMode: "fixed", avatar: null, expectedRevision: 7 }, "local");
});
it("old hosts retain avatar-only reset and never receive unsupported mode", async () => {
  useApp.setState({ features: new Set(["session-metadata"]) });
  await followAgentProfile(session, "local"); expect(action).not.toHaveBeenCalled();
  await setAgentAvatar(session, "local", null);
  expect(action).toHaveBeenLastCalledWith("mode-test", "cutex/session/metadata/update", { avatar: null, expectedRevision: 7 }, "local");
});
it("archive/restore projection preserves follow intent and explicit empty fixed choice", () => {
  expect(withRetiredDefaults({ ...session, avatarMode: "inherit" }).avatarMode).toBe("inherit");
  expect(withRetiredDefaults({ ...session, avatarMode: "fixed" })).toMatchObject({ avatarMode: "fixed", avatar: null });
});
