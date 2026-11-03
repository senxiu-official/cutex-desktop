// @vitest-environment jsdom
// Owner 2026-11-01 (screenshot: agent_create rows 「创建 wuwa-db-scout …」 in a tool group drew a round 'W' on an orange fill
// while the sidebar showed framed DS / RS tiles): every inline agent chip — task / delegation rows (components/Parties Who),
// 发给 rows (BusMessage → SenderAvatar), the new-agent picker — draws the shared letter tile with the sidebar's initials,
// also for an agent the snapshots do not hold yet (lib/agentHint). People keep their round letter on a colour.
import { act, createElement as h, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";

vi.mock("../src/renderer/src/i18n", async (original) => ({
  ...(await original<object>()), useI18n: () => ({ t: (key: string) => (key === "taskrow.agentCreate" ? "create {who}" : key === "taskrow.tell" ? "note to {who}" : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
// The enabled themes always offer a picture: an agent the app does not hold must not draw it (nor a hashed emoji).
vi.mock("../src/renderer/src/lib/portraitPacks", () => ({
  usePortraitPacks: () => ({ index: null }), portraitRefOf: () => null,
  portraitFor: (_index: unknown, avatar: unknown, seed: unknown, _family: unknown, themes: readonly string[]) => (!avatar && seed && themes.length ? { picture: "p" } : null),
  usePortraitImage: (picture: string | undefined) => (picture ? "data:image/png;base64,cG9ydHJhaXQ=" : null),
}));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const useApp = create(() => ({ sidebar: null, byHost: {}, hosts: { active: "local" }, pinned: new Set<string>(), selectedId: null as string | null, select: () => {} }));
  type S = ReturnType<typeof useApp.getState>;
  return {
    useApp, featuresOf: () => new Set(), pinnedOn: () => new Set(),
    sidebarOf: (s: S, hostId: string | null | undefined) => (!hostId || hostId === (s.hosts?.active ?? "local") ? s.sidebar : ((s.byHost as Record<string, { sidebar: unknown }>)[hostId]?.sidebar ?? null)),
  };
});
vi.mock("../src/renderer/src/lib/conversationScope", async () => {
  const { useApp } = await import("../src/renderer/src/store");
  return {
    useConvScope: () => null, useConvHost: () => "local", convFeaturesOf: () => new Set(),
    convSidebarOf: (_scope: unknown, s: { sidebar: unknown }) => s.sidebar,
    convSessionOf: (_scope: unknown, s: { selectedId: string | null }) => s.selectedId,
    useConvSidebar: () => useApp((s) => s.sidebar),
  };
});
vi.mock("../src/renderer/src/lib/userLayoutToggle", () => ({ useUserLayoutToggle: () => (action: () => void) => action() }));
vi.mock("../src/renderer/src/lib/wakeBusyWaitView", () => ({ useWakeHint: () => null }));
vi.mock("../src/renderer/src/lib/agentMessageStore", () => ({ useAgentMessage: () => null }));
vi.mock("../src/renderer/src/components/MessageSettlementControl", () => ({ MessageSettlementControl: () => null }));

import { useApp } from "../src/renderer/src/store";
import { Avatar } from "../src/renderer/src/components/Avatar";
import { Who } from "../src/renderer/src/components/Parties";
import { TaskToolRow } from "../src/renderer/src/components/TaskRows";
import { BusMessage } from "../src/renderer/src/components/BusMessage";
import { SenderAvatar } from "../src/renderer/src/components/SystemAvatar";
import { hintInitials, hintTint } from "../src/renderer/src/lib/agentHint";
import { taskToolRow } from "../src/renderer/src/lib/taskRows";
import { noteProfileLooks } from "../src/renderer/src/lib/profileLooks";
import { setAppAvatarStyle } from "../src/renderer/src/lib/avatarStyle";
import { setUiPref } from "../src/renderer/src/lib/prefs";
import type { RawItem } from "../src/renderer/src/lib/timeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (id: string, name: string, day: number, profile = "omega"): SessionResource =>
  ({ cutexSessionId: id, displayName: name, profile, configuredProfile: profile, launchedProfile: profile, runtime: { backend: "codex", status: "online" },
    runtimeDefaults: null, native: { threadId: null, schema: null }, avatar: null, createdAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z` }) as SessionResource;
// The owner's case: project wuwa, its Director creating wuwa-db-scout / wuwa-rotation-scout.
const DIRECTOR = session("wuwa-dir", "wuwa-director", 1, "Jasmine");
const BUILDER = session("wuwa-bld", "wuwa-builder", 2);
const SNAPSHOT = {
  active: [DIRECTOR, BUILDER, session("pipit", "Pipit", 3)], retired: [],
  projects: { projects: [{ project_id: "wuwa", director_cutex_session_id: "wuwa-dir", presentation: { display_name: "wuwa" } }] },
  hostRows: { "wuwa-dir": { projectId: "wuwa" }, "wuwa-bld": { projectId: "wuwa" } },
};

let host: HTMLDivElement;
let root: Root;
const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const draw = (el: ReactElement) => act(() => root.render(el));
beforeEach(() => {
  setUiPref("agentAvatarDefault", "important");
  setAppAvatarStyle({ kind: "portrait", portraitThemes: ["p/beach"] });
  noteProfileLooks("local", [{ id: "jasmine", name: "Jasmine", model: "glm-5.3", cliKind: "codex" }, { id: "omega", name: "omega", model: "gpt-5.5", cliKind: "codex" }] as never);
  useApp.setState({ sidebar: SNAPSHOT, byHost: {}, hosts: { active: "local" }, pinned: new Set(), selectedId: "wuwa-dir" } as never);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const createItem = (name: string, args: Record<string, unknown> = {}, result: unknown = null): RawItem =>
  ({ type: "mcpToolCall", id: `c-${name}`, server: "cutex", tool: "agent_create", status: result ? "completed" : "inProgress", arguments: { name, ...args }, result }) as never;

describe("hintInitials: an agent not in the snapshot gets the sidebar's letters", () => {
  it("skips the project's prefix (wuwa-db-scout → DS, wuwa-rotation-scout → RS)", () => {
    expect(hintInitials(SNAPSHOT as never, "wuwa-db-scout", "wuwa")).toBe("DS");
    expect(hintInitials(SNAPSHOT as never, "wuwa-rotation-scout", "wuwa")).toBe("RS");
  });
  it("without a known project: the plain two letters (no prefix rule)", () => {
    expect(hintInitials(SNAPSHOT as never, "wuwa-db-scout", null)).toBe("WS");
    expect(hintInitials(null, "Pipit", "wuwa")).toBe("Pi");
  });
  it("a clash in the project goes to the new agent (it is the newest), as the sidebar will do", () => {
    const snap = { ...SNAPSHOT, active: [...SNAPSHOT.active, session("dsy", "wuwa-data-sync", 4)], hostRows: { ...SNAPSHOT.hostRows, dsy: { projectId: "wuwa" } } };
    expect(hintInitials(snap as never, "wuwa-data-sync", "wuwa")).toBe("DS");
    expect(hintInitials(snap as never, "wuwa-db-scout", "wuwa")).not.toBe("DS");
  });
  it("hintTint: the call's model, else its Profile's, else unknown", () => {
    expect(hintTint({ model: "claude-opus-5" })).toBe("claude");
    expect(hintTint({ hostId: "local", profile: "Jasmine" })).toBe("glm");
    expect(hintTint({ projectId: "wuwa" })).toBeNull();
    expect(hintTint(null)).toBeNull();
  });
});

describe("tool rows (Who)", () => {
  it("the owner's case: agent_create rows in the Director's conversation draw DS / RS tiles in the model colour", () => {
    for (const [name, letters] of [["wuwa-db-scout", "DS"], ["wuwa-rotation-scout", "RS"]] as const) {
      const item = createItem(name);
      draw(h(TaskToolRow, { item, task: taskToolRow(item)! }));
      const tile = q("[data-minor-tile]")!;
      expect(tile.textContent).toBe(letters);
      // The Director's Profile (Jasmine, GLM): cutex's default Profile for agent_create.
      expect(tile.dataset.avatarFrame).toBe("glm");
      expect(tile.style.background).toBe("var(--surface)");
      expect(q("[data-avatar]")!.dataset.avatar).toBe("letter");
      expect(q(".rounded-full[data-avatar]")).toBeNull();
    }
  });

  it("the call's own model / project win over the creator's", () => {
    const item = createItem("scout", { model: "claude-sonnet-5", project_id: "wuwa" });
    draw(h(TaskToolRow, { item, task: taskToolRow(item)! }));
    expect(q("[data-minor-tile]")!.textContent).toBe("Sc");
    expect(q("[data-minor-tile]")!.dataset.avatarFrame).toBe("claude");
  });

  it("an id the sidebar does not hold yet (receipt before the refresh): the tile, never a picked portrait / emoji", () => {
    const item = createItem("wuwa-db-scout", {}, { content: [], structuredContent: { outcome: { receipt: { result: { agent: { cutex_session_id: "new-1" } } } } } });
    draw(h(TaskToolRow, { item, task: taskToolRow(item)! }));
    expect(q("[data-minor-tile]")!.textContent).toBe("DS");
    expect(q("[data-avatar] img")).toBeNull();
  });

  it("once the agent is in the snapshot it is its own look (same letters as the sidebar)", () => {
    useApp.setState({ sidebar: { ...SNAPSHOT, active: [...SNAPSHOT.active, session("new-1", "wuwa-db-scout", 5)], hostRows: { ...SNAPSHOT.hostRows, "new-1": { projectId: "wuwa" } } } } as never);
    draw(h(Who, { id: "new-1", name: "wuwa-db-scout" }));
    expect(q("[data-minor-tile]")!.textContent).toBe("DS");
    expect(q("[data-minor-tile]")!.dataset.avatarFrame).toBe("openai");
  });

  it("a bare name (agent_tell to wuwa-builder) resolves to that agent: a link with its sidebar tile", () => {
    draw(h(Who, { id: null, name: "wuwa-builder" }));
    expect(q("[role=link]")).not.toBeNull();
    expect(q("[data-minor-tile]")!.textContent).toBe("Bu");
  });

  it("an unknown name with nothing known: the tile with a neutral frame", () => {
    draw(h(Who, { id: null, name: "elsewhere-agent" }));
    const tile = q("[data-minor-tile]")!;
    expect(tile.textContent).toBe("EA");
    expect(tile.dataset.avatarFrame).toBeUndefined();
    expect(tile.style.boxShadow).toContain("var(--fg) 12%");
  });

  it("keeps the chip's 16 px slot (no layout shift in timeline rows)", () => {
    draw(h(Who, { id: null, name: "wuwa-db-scout" }));
    const slot = q("[data-avatar]")!;
    expect([slot.style.width, slot.style.height]).toEqual(["16px", "16px"]);
  });
});

describe("发给 rows (BusMessage)", () => {
  it("a sent message shows the addressee's tile with its sidebar letters", () => {
    draw(h(BusMessage, { direction: "out", name: "wuwa-builder", mode: "note", text: "hi", recipientId: "wuwa-bld", onContextMenu: () => {} }));
    expect(q("[data-minor-tile]")!.textContent).toBe("Bu");
  });
  it("without the addressee's id still an agent tile, not a round letter on a fill", () => {
    draw(h(BusMessage, { direction: "out", name: "wuwa-rotation-scout", mode: "note", text: "hi", onContextMenu: () => {} }));
    expect(q("[data-avatar]")!.dataset.avatar).toBe("letter");
    expect(q("[data-minor-tile]")!.textContent).toBe("WS");
  });
  it("a sender id from another host (not in the snapshot): the tile", () => {
    draw(h(SenderAvatar, { id: "peer-agent-9", name: "Moth", size: 16 }));
    expect(q("[data-minor-tile]")!.textContent).toBe("Mo");
  });
});

describe("people keep their look", () => {
  it("no seed and no agent hint (owner, users): the round letter on its colour", () => {
    draw(h(Avatar, { name: "Yang", initial: "Y", color: "#868e96", size: 20 }));
    const face = q("[data-avatar]")!;
    expect(face.dataset.avatar).toBe("letter");
    expect(face.className).toContain("rounded-full");
    expect(face.style.background).not.toBe("");
    expect(q("[data-minor-tile]")).toBeNull();
    expect(face.textContent).toBe("Y");
  });
});
