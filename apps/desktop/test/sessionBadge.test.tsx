// @vitest-environment jsdom
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, onEvent: () => () => {} }));
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { agentInfoPatch } from "../src/renderer/src/lib/avatar";
import { fieldsUnchanged, writeMetadataRetrying } from "../src/renderer/src/lib/metadataRetry";
import { ProjectBadge } from "../src/renderer/src/components/ProjectBadge";
import { AgentBadge } from "../src/renderer/src/components/AgentBadge";
import { useApp } from "../src/renderer/src/store";

const before = { avatar: null, note: null, badge: { text: "挂件", tint: "blue" as const } };
describe("session badge", () => {
  it("sets, clears and preserves the tri-state metadata field", () => {
    expect(agentInfoPatch(before, before)).toEqual({});
    expect(agentInfoPatch(before, { ...before, badge: null })).toEqual({ badge: null });
    expect(agentInfoPatch(before, { avatar: null, note: null })).toEqual({});
    expect(agentInfoPatch(before, { ...before, badge: { text: "HELP", tint: "pink" } })).toEqual({ badge: { text: "HELP", tint: "pink" } });
  });
  it("does not overwrite another editor's badge after a revision conflict", async () => {
    let calls = 0;
    const fresh = { ...before, badge: { text: "新值", tint: "blue" } };
    expect(fieldsUnchanged({ badge: before.badge }, fresh)).toBe(false);
    await expect(writeMetadataRetrying({
      write: async () => { calls++; throw new Error("revision_conflict"); },
      reread: async () => fresh,
      before: { badge: before.badge }, fenced: true,
      changed: () => new Error("refreshed"),
    })).rejects.toThrow("refreshed");
    expect(calls).toBe(1);
  });
  it("shows all four columns without shrinking the icon row height", () => {
    const out = renderToStaticMarkup(createElement(ProjectBadge, { badge: "ABCD", color: "blue" }));
    expect(out).toContain(">ABCD<");
    expect(out).toContain("height:16px");
    expect(out).not.toContain("width:16px");
    const cjk = renderToStaticMarkup(createElement(ProjectBadge, { badge: "挂件", color: "blue" }));
    expect(cjk).toContain(">挂件<");
  });
  it("uses the badge's own host capability and hides it on old daemons", () => {
    useApp.setState({ features: new Set(), hosts: null, byHost: {} });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(AgentBadge, { badge: before.badge })));
    expect(host.textContent).toBe("");
    act(() => useApp.setState({ features: new Set(["session-badge"]) }));
    expect(host.textContent).toContain("挂件");
    act(() => root.render(createElement(AgentBadge, { badge: before.badge, hostId: "older-host" })));
    expect(host.textContent).toBe("");
    act(() => root.unmount());
    useApp.setState({ features: new Set() });
  });
});
