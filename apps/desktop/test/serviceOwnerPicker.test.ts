// modules/services/ownerPicker (Services 更换负责人, owner bug 2026-10-28): cutex only accepts the
// daemon's own known non-archived sessions (validate_owner_session), so the picker mirrors the
// service host's active sidebar rows — Director and project members first, offline folded, one-off
// chats hidden until searched.
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { eligibleOwnerChoices, filterOwnerChoices, ownerChoices } from "../src/renderer/src/lib/ownerPicker";

const session = (id: string, { runtime, ...over }: Partial<Omit<SessionResource, "runtime">> & { runtime?: Partial<SessionResource["runtime"]> } = {}): SessionResource =>
  ({
    cutexSessionId: id,
    displayName: id,
    formalAgentName: null,
    displayNameOverride: null,
    threadName: null,
    registrationClass: null,
    lifecycle: "active",
    runtime: { status: "online", ...runtime } as SessionResource["runtime"],
    ...over,
  }) as SessionResource;

const sidebar = (over: {
  active?: SessionResource[];
  retired?: SessionResource[];
  director?: string | null;
  members?: string[];
} = {}): SidebarSnapshot =>
  ({
    active: over.active ?? [],
    retired: over.retired ?? [],
    projects: { schema: "cutex/projects/v1", projects: [{ project_id: "cutex-e", director_cutex_session_id: over.director ?? null }] },
    hostRows: Object.fromEntries((over.members ?? []).map((id) => [id, { id, projectId: "cutex-e" }])),
  }) as SidebarSnapshot;

const service = (over: { ownerCutexSessionId?: string | null; projectId?: string | null } = {}) =>
  ({ ownerCutexSessionId: over.ownerCutexSessionId ?? null, projectId: over.projectId ?? "cutex-e" }) as never;

const ids = (choices: ReturnType<typeof ownerChoices>) => choices.map((c) => c.id);

describe("ownerChoices", () => {
  it("offers only the host's active sessions — archived (retired) ones are not pickable, like cutex refuses them", () => {
    const choices = ownerChoices(service(), sidebar({ active: [session("eva"), session("mika")], retired: [session("old")] }));
    expect(ids(choices)).toEqual(["eva", "mika"]);
  });

  it("orders the Director, then the project's members, then everyone else alphabetically", () => {
    const choices = ownerChoices(
      service(),
      sidebar({ active: [session("zeta"), session("director"), session("member-b"), session("member-a")], director: "director", members: ["member-b", "member-a"] }),
    );
    expect(ids(choices)).toEqual(["director", "member-a", "member-b", "zeta"]);
    expect(choices.map((c) => c.group)).toEqual(["project", "project", "project", "all"]);
    expect(choices[0]).toMatchObject({ isDirector: true, isCurrent: false });
  });

  it("folds non-project offline agents into the offline group but keeps offline members in the project group", () => {
    const choices = ownerChoices(
      service(),
      sidebar({
        active: [session("member-off", { activityStatus: "offline" }), session("stranger-off", { runtime: { status: "offline" } }), session("stranger-on")],
        members: ["member-off"],
      }),
    );
    expect(choices.find((c) => c.id === "member-off")).toMatchObject({ group: "project", offline: true });
    expect(choices.find((c) => c.id === "stranger-off")).toMatchObject({ group: "offline", offline: true });
    expect(choices.find((c) => c.id === "stranger-on")).toMatchObject({ group: "all", offline: false });
  });

  it("marks one-off chats (no agent name, displayName is the thread title) unnamed, and shows the real name under an alias", () => {
    const choices = ownerChoices(
      service(),
      sidebar({
        active: [
          session("chat-1", { displayName: "Wait for one cross-agent nonce…", formalAgentName: null, registrationClass: "local_only" }),
          session("alias-1", { displayName: "小花", displayNameOverride: "小花", formalAgentName: "eva-agent-1" }),
          session("named-1", { displayName: "Board Lead", formalAgentName: "board-lead" }),
        ],
      }),
    );
    expect(choices.find((c) => c.id === "chat-1")).toMatchObject({ unnamed: true, name: "Wait for one cross-agent nonce…" });
    expect(choices.find((c) => c.id === "alias-1")).toMatchObject({ unnamed: false, name: "小花", real: "eva-agent-1" });
    expect(choices.find((c) => c.id === "named-1")).toMatchObject({ unnamed: false, real: null });
  });

  it("marks the service's current owner", () => {
    const choices = ownerChoices(service({ ownerCutexSessionId: "mika" }), sidebar({ active: [session("eva"), session("mika")] }));
    expect(choices.find((c) => c.id === "mika")?.isCurrent).toBe(true);
    expect(choices.find((c) => c.id === "eva")?.isCurrent).toBe(false);
  });
});

describe("filterOwnerChoices", () => {
  const choices = ownerChoices(
    service({ ownerCutexSessionId: "chat-mine" }),
    sidebar({
      active: [
        session("eva"),
        session("alias-1", { displayName: "小花", displayNameOverride: "小花", formalAgentName: "eva-agent-1" }),
        session("chat-mine", { displayName: "My one-off chat title", registrationClass: "local_only" }),
        session("chat-other", { displayName: "Other one-off chat title", registrationClass: "local_only" }),
      ],
    }),
  );

  it("without a query hides unnamed one-off chats, except the current owner", () => {
    expect(ids(filterOwnerChoices(choices, ""))).toEqual(["alias-1", "eva", "chat-mine"]);
    expect(ids(filterOwnerChoices(choices, "  "))).toEqual(["alias-1", "eva", "chat-mine"]);
  });

  it("matches the shown name, the real name under an alias, or the session id (case-insensitive)", () => {
    expect(ids(filterOwnerChoices(choices, "小花"))).toEqual(["alias-1"]);
    expect(ids(filterOwnerChoices(choices, "EVA-AGENT"))).toEqual(["alias-1"]);
    expect(ids(filterOwnerChoices(choices, "eva"))).toEqual(["alias-1", "eva"]); // the real name under an alias matches too
    expect(ids(filterOwnerChoices(choices, "other"))).toEqual(["chat-other"]);
  });

  it("keeps an empty answer empty rather than falling back to everything", () => {
    expect(filterOwnerChoices(choices, "nobody")).toEqual([]);
  });
});


describe("eligibleOwnerChoices", () => {
  it("orders backend project seats first, preserving offline and unnamed eligibility", () => {
    const owner = (id: string, over = {}) => ({ id, name: id, realName: null, projectId: null, isDirector: false, online: true, unnamed: false, ...over });
    const choices = eligibleOwnerChoices(service({ ownerCutexSessionId: "hidden-chat" }), [
      owner("outsider"), owner("member", { projectId: "cutex-e", online: false }),
      owner("director", { isDirector: true, projectId: null, online: false }),
      owner("offline", { online: false }), owner("hidden-chat", { unnamed: true }),
      owner("alias", { name: "Keeper", realName: "formal-keeper" }),
    ]);
    expect(choices.slice(0, 2).map((c) => c.id)).toEqual(["director", "member"]);
    expect(choices.find((c) => c.id === "member")).toMatchObject({ group: "project", offline: true });
    expect(choices.find((c) => c.id === "offline")).toMatchObject({ group: "offline" });
    expect(choices.find((c) => c.id === "hidden-chat")).toMatchObject({ unnamed: true, isCurrent: true });
    expect(filterOwnerChoices(choices, "").map((c) => c.id)).toContain("hidden-chat");
    expect(filterOwnerChoices(choices, "formal-keeper").map((c) => c.id)).toEqual(["alias"]);
    expect(eligibleOwnerChoices(service(), [])).toEqual([]);
  });
});
