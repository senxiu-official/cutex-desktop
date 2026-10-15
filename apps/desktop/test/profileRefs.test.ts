import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { bulkArchivedRefs, profileInUseMessage, profileRefs } from "../src/renderer/src/lib/profileRefs";

const s = (id: string, name: string, lifecycle = "active") => ({ cutexSessionId: id, displayName: name, lifecycle, revision: 4 }) as unknown as SessionResource;
const lists = { active: [s("a1", "Sora"), s("a2", "Akari")], retired: [s("r1", "atlas-v1", "retired"), s("r2", "AUTO_old", "retired")] };
const ref = (id: string, displayName: string, lifecycle?: "active" | "retired") => ({ cutexSessionId: id, displayName, ...(lifecycle ? { lifecycle } : {}) });

describe("profileRefs", () => {
  it("matches the refusal to the desktop's lists: in use, then archived; listed before unlisted; by name", () => {
    const refs = profileRefs(
      [ref("r1", "atlas-v1", "retired"), ref("h1", "hidden", "active"), ref("a1", "Sora", "active"), ref("hr", "gone-host", "retired"), ref("a2", "Akari", "active"), ref("r2", "AUTO_old", "retired")],
      lists,
    );
    expect(refs.map((r) => [r.id, r.archived, r.session !== null])).toEqual([
      ["a2", false, true],
      ["a1", false, true],
      ["h1", false, false],
      ["r1", true, true],
      ["r2", true, true],
      ["hr", true, false],
    ]);
  });

  it("prefers the desktop's lifecycle and name; without either, cutex's (no lifecycle = in use)", () => {
    const [unlisted, listed] = profileRefs([ref("r1", "old name", "active"), ref("x", "", undefined)], lists);
    expect(listed).toMatchObject({ id: "r1", name: "atlas-v1", archived: true });
    expect(unlisted).toMatchObject({ id: "x", name: "x", archived: false, session: null });
  });

  it("drops deleted and duplicate ids", () => {
    const refs = profileRefs([ref("a1", "Sora"), ref("a1", "Sora"), ref("r1", "atlas-v1", "retired")], lists, new Set(["r1"]));
    expect(refs.map((r) => r.id)).toEqual(["a1"]);
    expect(profileRefs(undefined, null)).toEqual([]);
  });
});

describe("profileInUseMessage", () => {
  const active = profileRefs([ref("a1", "Sora")], lists);
  const mixed = profileRefs([ref("a1", "Sora"), ref("r1", "atlas-v1", "retired")], lists);
  it("says when archived agents count, and whether they can be deleted here", () => {
    expect(profileInUseMessage(active, true)).toBe("settings.profile.refs.active");
    expect(profileInUseMessage(mixed, true)).toBe("settings.profile.refs.archived");
    expect(profileInUseMessage(active, false)).toBe("settings.profile.refs.activeNoDelete");
    expect(profileInUseMessage(mixed, false)).toBe("settings.profile.refs.archivedNoDelete");
  });
  it("says the profile can be deleted once none are left", () => {
    expect(profileInUseMessage([], true)).toBe("settings.profile.refs.cleared");
  });
});

describe("bulkArchivedRefs", () => {
  const refs = profileRefs([ref("a1", "Sora"), ref("r1", "atlas-v1", "retired"), ref("r2", "AUTO_old", "retired")], lists);
  it("offers two or more archived agents when the host can delete agents", () => {
    expect(bulkArchivedRefs(refs, true).map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(bulkArchivedRefs(refs, false)).toEqual([]);
    expect(bulkArchivedRefs(refs.slice(0, 2), true)).toEqual([]);
  });
});
