import { describe, expect, it } from "vitest";
import { canDetachArchived, profileInUseCount, profileInUseMessage, type ProfileRef } from "./profileRefs";

const ref = (id: string, archived: boolean): ProfileRef => ({ id, name: id, archived, session: null });

describe("profile in use with archived detach", () => {
  const active = ref("a", false);
  const archived = ref("b", true);
  it("keeps the old messages without the cutex feature", () => {
    expect(profileInUseMessage([active, archived], true)).toBe("settings.profile.refs.archived");
    expect(profileInUseCount([active, archived])).toBe(2);
    expect(canDetachArchived([archived], false)).toBe(false);
  });
  it("counts only active agents while there are some, and offers the detach once only archived ones are left", () => {
    expect(profileInUseMessage([active, archived], true, true)).toBe("settings.profile.refs.activeDetach");
    expect(profileInUseCount([active, archived], true)).toBe(1);
    expect(canDetachArchived([active, archived], true)).toBe(false);
    expect(profileInUseMessage([archived], false, true)).toBe("settings.profile.refs.onlyArchived");
    expect(profileInUseCount([archived], true)).toBe(1);
    expect(canDetachArchived([archived], true)).toBe(true);
    expect(profileInUseMessage([active], true, true)).toBe("settings.profile.refs.active");
    expect(profileInUseMessage([], true, true)).toBe("settings.profile.refs.cleared");
    expect(canDetachArchived([], true)).toBe(false);
  });
});
