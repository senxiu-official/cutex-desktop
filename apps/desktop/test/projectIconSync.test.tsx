// 项目图标 on the host (cutex `project-icon`, lib/projectIconSync): which value each surface shows with
// and without the capability, the picker's write path, and the one-time upload of local choices.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import { withIcon, type ProjectIconChoice } from "../src/renderer/src/lib/projectIcons";

const fx = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  listeners: new Set<(s: any) => void>(),
  icons: {} as Record<string, any>,
  calls: [] as { hostId: string; projectId: string; expected: unknown; presentation: any }[],
  refuse: false,
  onWrite: null as null | ((hostId: string) => void),
}));

vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: any) => unknown) => select(fx.state), { getState: () => fx.state, subscribe: (l: (s: any) => void) => (fx.listeners.add(l), () => fx.listeners.delete(l)) }),
  hostApi: (hostId: string) => ({
    async projectPresentation(projectId: string, expected: unknown, presentation: any) {
      fx.calls.push({ hostId, projectId, expected, presentation });
      const hook = fx.onWrite;
      fx.onWrite = null;
      hook?.(hostId);
      if (fx.refuse) throw new Error("conflict: presentation_revision");
      // the host stores it: the next list has the icon and a new revision
      const list = hostId === "local" ? fx.state.sidebar.projects : fx.state.byHost[hostId].sidebar.projects;
      const p = list.projects.find((x: ProjectSummary) => x.project_id === projectId);
      p.presentation = { ...p.presentation, ...presentation, revision: (p.presentation.revision ?? 0) + 1 };
      return {};
    },
  }),
}));
vi.mock("../src/renderer/src/lib/prefs", async () => {
  const { withIcon } = await import("../src/renderer/src/lib/projectIcons");
  return {
    useUiPrefs: () => ({ projectIcons: fx.icons }),
    getUiPrefs: () => ({ projectIcons: fx.icons }),
    setProjectIcon: (hostId: string, projectId: string, icon: ProjectIconChoice | null) => {
      fx.icons = withIcon(fx.icons, hostId, projectId, icon);
    },
  };
});

const sync = await import("../src/renderer/src/lib/projectIconSync");
const { effectiveIcons, readHostIcons, setProjectIconOn, uploadLocalProjectIcons, uploadPlan, useProjectIcons, resetProjectIconSyncForTests } = sync;

const fox: ProjectIconChoice = { kind: "emoji", value: "🦊" };
const wave: ProjectIconChoice = { kind: "emoji", value: "🌊" };
const terminal: ProjectIconChoice = { kind: "icon", value: "terminal" };

const project = (id: string, icon?: ProjectIconChoice | null): ProjectSummary => ({
  project_id: id,
  authority_epoch: 2,
  presentation: { display_name: id, badge_label: id.slice(0, 1).toUpperCase(), color: "cyan", revision: 5, ...(icon !== undefined ? { icon } : {}) },
  active_member_count: 1,
  lifecycle: "active",
});

function setState(next: Record<string, any>): void {
  fx.state = next;
  for (const l of fx.listeners) l(fx.state);
}
/** Focus host `local` (+ optional slice `remote`), each with features and projects. */
function hosts(local: { features: string[]; projects: ProjectSummary[] | null }, remote?: { features: string[]; projects: ProjectSummary[] | null }): void {
  const sidebar = (p: ProjectSummary[] | null) => ({ projects: p ? { schema: "x", projects: p } : null });
  setState({
    hosts: { active: "local" },
    features: new Set(local.features),
    sidebar: sidebar(local.projects),
    byHost: remote ? { remote: { features: new Set(remote.features), sidebar: sidebar(remote.projects) } } : {},
    refreshHostSidebar: async () => setState({ ...fx.state }),
    notify: vi.fn(),
  });
}

beforeEach(() => {
  fx.icons = {};
  fx.calls = [];
  fx.refuse = false;
  fx.onWrite = null;
  fx.state = {};
  resetProjectIconSyncForTests();
});
afterEach(() => resetProjectIconSyncForTests());

describe("reading", () => {
  it("capability absent: the local pref shows; the host's value is not read", () => {
    hosts({ features: [], projects: [project("a", wave)] });
    const host = readHostIcons(fx.state);
    expect(host.capable.size).toBe(0);
    const local = withIcon({}, "local", "a", fox);
    expect(effectiveIcons(local, host, {})).toEqual({ [hostKey("local", "a")]: fox });
  });

  it("capability present: the host value shows and the local pref is ignored for that host only", () => {
    hosts({ features: ["project-icon"], projects: [project("a", wave), project("b", null), project("c")] }, { features: [], projects: [project("r")] });
    const host = readHostIcons(fx.state);
    expect([...host.capable]).toEqual(["local"]);
    let local = withIcon({}, "local", "a", fox);
    local = withIcon(local, "local", "b", terminal);
    local = withIcon(local, "remote", "r", terminal);
    expect(effectiveIcons(local, host, {})).toEqual({ [hostKey("local", "a")]: wave, [hostKey("remote", "r")]: terminal });
  });

  it("drops host values the catalog does not know (falls back to the letter badge)", () => {
    hosts({ features: ["project-icon"], projects: [project("a", { kind: "icon", value: "no-such-icon" })] });
    expect(effectiveIcons({}, readHostIcons(fx.state), {})).toEqual({});
  });

  it("a pending write shows first (null hides the host value)", () => {
    hosts({ features: ["project-icon"], projects: [project("a", wave), project("b", fox)] });
    const host = readHostIcons(fx.state);
    expect(effectiveIcons({}, host, { [hostKey("local", "a")]: terminal, [hostKey("local", "b")]: null })).toEqual({ [hostKey("local", "a")]: terminal });
  });

  it("useProjectIcons follows the host list", () => {
    hosts({ features: ["project-icon"], projects: [project("a", wave)] });
    const Probe = () => createElement("span", null, JSON.stringify(useProjectIcons()));
    expect(renderToStaticMarkup(createElement(Probe))).toContain("🌊");
  });
});

describe("writing (the picker)", () => {
  it("capability absent: the local pref, no host call", async () => {
    hosts({ features: [], projects: [project("a")] });
    await setProjectIconOn("local", "a", fox);
    expect(fx.calls).toEqual([]);
    expect(fx.icons).toEqual({ [hostKey("local", "a")]: fox });
  });

  it("capability present: the presentation with name / badge / colour kept and the current revision; null clears", async () => {
    hosts({ features: ["project-icon"], projects: [project("a")] });
    await setProjectIconOn("local", "a", fox);
    expect(fx.calls[0]).toEqual({ hostId: "local", projectId: "a", expected: { authorityEpoch: 2, presentationRevision: 5 }, presentation: { display_name: "a", badge_label: "A", color: "cyan", icon: fox } });
    expect(fx.icons).toEqual({});
    expect(sync.projectIconsNow()).toEqual({ [hostKey("local", "a")]: fox });
    await setProjectIconOn("local", "a", null);
    expect(fx.calls[1]!.presentation.icon).toBeNull();
    expect(fx.calls[1]!.expected).toEqual({ authorityEpoch: 2, presentationRevision: 6 });
    expect(sync.projectIconsNow()).toEqual({});
  });

  it("a refused write drops back to the host's value and reports it", async () => {
    hosts({ features: ["project-icon"], projects: [project("a", wave)] });
    fx.refuse = true;
    const failed = vi.fn();
    await setProjectIconOn("local", "a", fox, failed);
    expect(failed).toHaveBeenCalledOnce();
    expect(sync.projectIconsNow()).toEqual({ [hostKey("local", "a")]: wave });
  });
});

describe("one-time upload", () => {
  it("plans only listed projects of a capable host; the host's icon wins", () => {
    hosts({ features: ["project-icon"], projects: [project("a"), project("b", wave)] }, { features: [], projects: [project("r")] });
    let local = withIcon({}, "local", "a", fox);
    local = withIcon(local, "local", "b", terminal);
    local = withIcon(local, "local", "gone", terminal);
    local = withIcon(local, "remote", "r", fox);
    const host = readHostIcons(fx.state);
    const plan = uploadPlan("local", local, host);
    expect(plan.upload.map((u) => [u.project.project_id, u.icon])).toEqual([["a", fox]]);
    expect(plan.drop).toEqual([hostKey("local", "b")]);
    expect(uploadPlan("remote", local, host)).toEqual({ upload: [], drop: [] }); // no capability: nothing
    expect(uploadPlan("local", local, host, new Set([hostKey("local", "a"), hostKey("local", "b")]))).toEqual({ upload: [], drop: [] });
  });

  it("uploads where the host has none, keeps the host's icon elsewhere, then stops using the local pref", async () => {
    fx.icons = withIcon(withIcon(withIcon({}, "local", "a", fox), "local", "b", terminal), "remote", "r", fox);
    hosts({ features: ["project-icon"], projects: [project("a"), project("b", wave)] }, { features: [], projects: [project("r")] });
    await uploadLocalProjectIcons();
    expect(fx.calls.map((c) => [c.projectId, c.presentation.icon])).toEqual([["a", fox]]);
    expect(fx.icons).toEqual({ [hostKey("remote", "r")]: fox }); // the other host keeps its local pref
    expect(sync.projectIconsNow()).toEqual({ [hostKey("local", "a")]: fox, [hostKey("local", "b")]: wave, [hostKey("remote", "r")]: fox });
    await uploadLocalProjectIcons(); // once: nothing left to do
    expect(fx.calls).toHaveLength(1);
  });

  it("a failed upload keeps the local entry and is not retried in the same run", async () => {
    fx.icons = withIcon({}, "local", "a", fox);
    fx.refuse = true;
    hosts({ features: ["project-icon"], projects: [project("a")] });
    await uploadLocalProjectIcons();
    await uploadLocalProjectIcons();
    expect(fx.calls).toHaveLength(1);
    expect(fx.icons).toEqual({ [hostKey("local", "a")]: fox });
  });

  it("never overwrites a host icon this desktop cannot draw (an id outside the catalog); it shows as the letter badge", async () => {
    const rocket = { kind: "icon", value: "rocket" } as unknown as ProjectIconChoice;
    const local = withIcon({}, "local", "a", fox);
    fx.icons = local;
    hosts({ features: ["project-icon"], projects: [project("a", rocket)] });
    const host = readHostIcons(fx.state);
    expect(host.stored.has(hostKey("local", "a"))).toBe(true);
    expect(uploadPlan("local", local, host)).toEqual({ upload: [], drop: [hostKey("local", "a")] });
    await uploadLocalProjectIcons();
    expect(fx.calls).toEqual([]);
    expect(fx.icons).toEqual({}); // the host wins
    expect(sync.projectIconsNow()).toEqual({}); // letter badge, not the local 🦊
  });

  it("a host list that arrives while another host's upload runs is uploaded when that one finishes", async () => {
    fx.icons = withIcon(withIcon({}, "local", "a", fox), "remote", "r", terminal);
    hosts({ features: ["project-icon"], projects: [project("a")] }, { features: ["project-icon"], projects: null });
    fx.onWrite = () => {
      // remote's list comes in during local's write (its trigger finds an upload running)
      fx.state = { ...fx.state, byHost: { remote: { features: new Set(["project-icon"]), sidebar: { projects: { schema: "x", projects: [project("r")] } } } } };
      for (const l of fx.listeners) l(fx.state);
    };
    await uploadLocalProjectIcons();
    expect(fx.calls.map((c) => [c.hostId, c.projectId])).toEqual([["local", "a"], ["remote", "r"]]);
    expect(fx.icons).toEqual({});
  });

  it("waits for the host's list and its capability", async () => {
    fx.icons = withIcon({}, "local", "a", fox);
    hosts({ features: ["project-icon"], projects: null });
    await uploadLocalProjectIcons();
    hosts({ features: [], projects: [project("a")] });
    await uploadLocalProjectIcons();
    expect(fx.calls).toHaveLength(0);
    hosts({ features: ["project-icon"], projects: [project("a")] });
    await uploadLocalProjectIcons();
    expect(fx.calls).toHaveLength(1);
  });
});

describe("cutex icon rules", () => {
  it("one emoji grapheme ≤ 32 bytes, lucide-like ids, 1–2 characters", () => {
    expect(sync.hostAcceptsIcon(fox)).toBe(true);
    expect(sync.hostAcceptsIcon({ kind: "emoji", value: "🧑‍🚀" })).toBe(true); // one ZWJ grapheme
    expect(sync.hostAcceptsIcon({ kind: "emoji", value: "🦊🐱" })).toBe(false);
    expect(sync.hostAcceptsIcon(terminal)).toBe(true);
    expect(sync.hostAcceptsIcon({ kind: "text", value: "卷" })).toBe(true);
    expect(sync.hostAcceptsIcon({ kind: "text", value: "CD" })).toBe(true);
  });

  it("the picker refuses what the host would refuse; the upload leaves it on this device", async () => {
    hosts({ features: ["project-icon"], projects: [project("a"), project("b")] });
    const failed = vi.fn();
    await setProjectIconOn("local", "a", { kind: "emoji", value: "🦊🐱" }, failed);
    expect(failed).toHaveBeenCalledOnce();
    expect(fx.calls).toEqual([]);
    fx.icons = withIcon({}, "local", "b", { kind: "emoji", value: "🦊🐱" });
    await uploadLocalProjectIcons();
    expect(fx.calls).toEqual([]);
    expect(Object.keys(fx.icons)).toEqual([hostKey("local", "b")]);
  });
});
