// Settings → 用户 review fixes (2026-10-15): the grant draft survives a list refresh when edited,
// 全部项目 off restores the hidden project ids, person-key PUTs are serialized and built fresh.
import { describe, expect, it, vi } from "vitest";
import type { PersonKeyInput, UserGrant, UserRecord, UsersList } from "../src/shared/users";
import { rebaseGrantDraft, toggleAllProjects, withoutPersonKey, withPersonKey } from "../src/renderer/src/modules/users/model";
import { changePersonKeys } from "../src/renderer/src/modules/users/personKeyWrites";

const g = (projects: UserGrant["projects"], send = false): UserGrant => ({ projects, standaloneAgents: [], send });

describe("grant draft", () => {
  it("an untouched draft follows a newer saved grant; an edited one is kept", () => {
    expect(rebaseGrantDraft(g(["a"]), g(["a"]), g(["a", "b"]))).toEqual(g(["a", "b"]));
    expect(rebaseGrantDraft(g(["a"], true), g(["a"]), g(["a", "b"]))).toEqual(g(["a"], true));
  });

  it("全部项目 on then off restores the previous list, including ids not shown", () => {
    const on = toggleAllProjects(g(["shown", "archived-x"]), true, []);
    expect(on.draft.projects).toBe("all");
    const off = toggleAllProjects(on.draft, false, on.kept);
    expect(off.draft.projects).toEqual(["shown", "archived-x"]);
  });
});

describe("person-key writes", () => {
  it("two quick adds to one user are serialized and each built from the latest listing", async () => {
    let keys: PersonKeyInput[] = [{ publicKey: "k0" }];
    const user = (): UserRecord => ({ id: "u1", name: "U", isOwner: false, grant: null, personKeys: keys.map((k) => ({ ...k, addedAt: "" })) }) as unknown as UserRecord;
    const stale = user();
    let inFlight = 0;
    const api = {
      users: vi.fn(async () => ({ users: [user()] }) as unknown as UsersList),
      putUserPersonKeys: vi.fn(async (_id: string, next: PersonKeyInput[]) => {
        expect(inFlight).toBe(0);
        inFlight++;
        await new Promise((r) => setTimeout(r, 5));
        keys = next;
        inFlight--;
        return { ok: true as const, value: { userId: "u1", personKeys: [] } };
      }),
    };
    await Promise.all([
      changePersonKeys(api, "h", "u1", stale, (u) => withPersonKey(u, { publicKey: "k1" })),
      changePersonKeys(api, "h", "u1", stale, (u) => withPersonKey(u, { publicKey: "k2" })),
    ]);
    expect(keys.map((k) => k.publicKey)).toEqual(["k0", "k1", "k2"]);
    await changePersonKeys(api, "h", "u1", stale, (u) => withoutPersonKey(u, "k1"));
    expect(keys.map((k) => k.publicKey)).toEqual(["k0", "k2"]);
  });

  it("falls back to the page's record when the fresh read fails", async () => {
    const put = vi.fn(async () => ({ ok: true as const, value: { userId: "u1", personKeys: [] } }));
    await changePersonKeys({ users: () => Promise.reject(new Error("down")), putUserPersonKeys: put }, "h", "u1", { personKeys: [] }, (u) => withPersonKey(u, { publicKey: "k" }));
    expect(put).toHaveBeenCalledWith("u1", [{ publicKey: "k" }]);
  });
});
