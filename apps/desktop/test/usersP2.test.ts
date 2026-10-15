// r236 desktop side: users-p2-access gating (shared/users canUseP2 + hostFeatureSet), the non-owner
// image upload plan (shared/input uploadKind), refusal texts, and 新建用户并分配 (modules/users/model).
import { describe, expect, it } from "vitest";
import { canUseP2, hostFeatureSet, isOwnerFeatures, OWNER_ACCESS, RESTRICTED_FEATURE, USERS_P2_ACCESS_FEATURE, userAccessOf, type UsersList, type UsersResult } from "../src/shared/users";
import { dataUrlImage, uploadKind } from "../src/shared/input";
import { workspaceErrorText } from "../src/renderer/src/lib/workspace";
import { sendErrorText } from "../src/renderer/src/lib/outbox";
import { createUserAndAssign, newUserDefaultName, rememberKeyFor, type CreateAndAssignApi } from "../src/renderer/src/modules/users/model";

const member = (send: boolean) => ({ id: "u-1", name: "Alex", isOwner: false, pending: false, grant: { projects: ["alpha"], standaloneAgents: [], send } });
const pending = { id: null, name: null, isOwner: false, pending: true, grant: null };

describe("canUseP2", () => {
  const p2 = [USERS_P2_ACCESS_FEATURE];
  it("gives the owner (and an unknown / older host) everything", () => {
    expect(canUseP2([], OWNER_ACCESS)).toEqual({ files: true, attachments: true, delegations: true, owner: true });
    expect(canUseP2(new Set(), userAccessOf(null))).toMatchObject({ files: true, owner: true });
  });
  it("opens files read-only to any non-owner user, images and delegation commands only with send", () => {
    expect(canUseP2(p2, userAccessOf({ user: member(false) }))).toEqual({ files: true, attachments: false, delegations: false, owner: false });
    expect(canUseP2(new Set(p2), userAccessOf({ user: member(true) }))).toEqual({ files: true, attachments: true, delegations: true, owner: false });
  });
  it("gives nothing without the capability or to a pending device", () => {
    expect(canUseP2([], userAccessOf({ user: member(true) }))).toEqual({ files: false, attachments: false, delegations: false, owner: false });
    expect(canUseP2(p2, userAccessOf({ user: pending }))).toEqual({ files: false, attachments: false, delegations: false, owner: false });
  });
});

describe("hostFeatureSet with users-p2-access", () => {
  const featureList = ["terminal", "workspace-fs", "fs-file-read", "fs-dir-browse", "session-attachments", "asks", "asks-pause-v2", USERS_P2_ACCESS_FEATURE];
  it("keeps the read-only workspace routes for a reader and attachments for a sender; terminals / host files stay the owner's", () => {
    const reader = hostFeatureSet({ featureList, user: member(false) });
    expect([...reader].sort()).toEqual(["asks", "workspace-fs", USERS_P2_ACCESS_FEATURE, RESTRICTED_FEATURE].sort());
    const sender = hostFeatureSet({ featureList, user: member(true) });
    expect([...sender].sort()).toEqual(["asks", "session-attachments", "workspace-fs", USERS_P2_ACCESS_FEATURE, RESTRICTED_FEATURE].sort());
    expect(isOwnerFeatures(sender)).toBe(false);
  });
  it("drops them all on an older host and for a pending device", () => {
    const older = hostFeatureSet({ featureList: featureList.filter((f) => f !== USERS_P2_ACCESS_FEATURE), user: member(true) });
    expect([...older].sort()).toEqual(["asks", RESTRICTED_FEATURE].sort());
    expect(hostFeatureSet({ featureList, user: pending }).has("workspace-fs")).toBe(false);
  });
  it("leaves the owner's set untouched", () => {
    expect([...hostFeatureSet({ featureList, user: { id: "owner", name: "Sam", isOwner: true, pending: false, grant: null } })]).toEqual(featureList);
  });
});

describe("non-owner image uploads", () => {
  const picked = (path: string) => path === "/pics/a.png";
  const png = "data:image/png;base64,iVBORw0KGgo=";
  it("uploads picked files on a remote host, everything image-like for a non-owner", () => {
    expect(uploadKind({ type: "localImage", path: "/pics/a.png" }, { remote: true, restricted: false, picked })).toBe("path");
    expect(uploadKind({ type: "image", url: png }, { remote: true, restricted: false, picked })).toBeNull();
    expect(uploadKind({ type: "image", url: png }, { remote: false, restricted: true, picked })).toBe("data");
    expect(uploadKind({ type: "localImage", path: "/pics/a.png" }, { remote: false, restricted: true, picked })).toBe("path");
  });
  it("never uploads a path the user did not pick, nor non-images", () => {
    expect(uploadKind({ type: "localImage", path: "/etc/passwd" }, { remote: true, restricted: true, picked })).toBeNull();
    expect(uploadKind({ type: "skill", name: "s", path: "/x" }, { remote: true, restricted: true, picked })).toBeNull();
    expect(uploadKind({ type: "localImage", path: "/pics/a.png" }, { remote: false, restricted: false, picked })).toBeNull();
  });
  it("reads only the image types cutex attachments take", () => {
    expect(dataUrlImage(png)).toEqual({ mime: "image/png", base64: "iVBORw0KGgo=" });
    expect(dataUrlImage("data:image/bmp;base64,Qk0=")).toBeNull();
    expect(dataUrlImage("https://example.com/a.png")).toBeNull();
  });
});

describe("P2 refusal texts", () => {
  it("names a workspace root that is too broad, passes other errors through", () => {
    const broad = () => "too broad";
    expect(workspaceErrorText(new Error("Error invoking remote method 'fsDir': CutexApiError: workspace_root_too_broad: not for you"), broad)).toBe("too broad");
    expect(workspaceErrorText("path_not_found: gone", broad)).toBe("path_not_found: gone");
    expect(workspaceErrorText(new Error("my_workspace_root_too_broad_x"), broad)).toBe("my_workspace_root_too_broad_x");
  });
  it("maps a non-owner's input refusals when asked to", () => {
    const capacity = () => "busy";
    const refusal = (code: string) => `refused:${code}`;
    expect(sendErrorText(new Error("CutexApiError: attachment_not_owned: localImage must be…"), capacity, refusal)).toBe("refused:attachment_not_owned");
    expect(sendErrorText(new Error("input_type_not_allowed: only text"), capacity, refusal)).toBe("refused:input_type_not_allowed");
    expect(sendErrorText(new Error("input_type_not_allowed: only text"), capacity)).toBe("input_type_not_allowed: only text");
  });
});

describe("新建用户并分配", () => {
  const KEY = "A".repeat(43);
  const OWNED = "B".repeat(43);
  const list: Pick<UsersList, "users" | "tokenPersons"> = {
    users: [{ id: "owner", name: "Sam", color: null, builtin: true, isOwner: true, grant: null, createdAt: "", updatedAt: "", personKeys: [{ publicKey: OWNED, fingerprint: "f", addedAt: "" }] }],
    tokenPersons: {},
  };
  const pendingToken = (person: { publicKey: string; displayName?: string | null } | null, deviceName: string | null = "Tablet") => ({
    tokenId: "mct-1", label: "desktop-demo-laptop", deviceName, userId: null, pending: true,
    person: person ? { publicKey: person.publicKey, fingerprint: "f", userId: undefined as unknown as null, displayName: person.displayName ?? null, claimedAt: "", previousPublicKey: null } : null,
  });

  it("defaults the name to the claimed name, else the device name / label", () => {
    const t = (key: string, vars?: Record<string, string | number>) => `${key}:${vars?.app}@${vars?.host}`;
    expect(newUserDefaultName(list, pendingToken({ publicKey: KEY, displayName: "Alex (laptop)" }), t)).toBe("Alex (laptop)");
    expect(newUserDefaultName(list, pendingToken(null), t)).toBe("Tablet");
    expect(newUserDefaultName(list, pendingToken(null, null), t)).toBe("desktop-demo-laptop");
    expect(newUserDefaultName(list, { ...pendingToken(null, null), label: "desktop-demo-laptop-dev-a1b2c3" }, t)).toBe("device.appOnHost:dev@demo-laptop");
    expect(newUserDefaultName(list, { ...pendingToken(null), ownerName: "Kai's laptop" }, t)).toBe("Kai's laptop");
    expect(newUserDefaultName(list, pendingToken({ publicKey: KEY, displayName: "x".repeat(80) }), t)).toHaveLength(64);
  });

  it("remembers only an unknown key, and only with the box on", () => {
    expect(rememberKeyFor(list, pendingToken({ publicKey: KEY }), true)).toBe(KEY);
    expect(rememberKeyFor(list, pendingToken({ publicKey: KEY }), false)).toBeNull();
    expect(rememberKeyFor(list, pendingToken({ publicKey: OWNED }), true)).toBeNull();
    expect(rememberKeyFor(list, pendingToken(null), true)).toBeNull();
  });

  /** A fake users API recording calls; `refuse` names the call that comes back refused. */
  function fake(refuse?: "createUser" | "bindUserToken" | "putUserPersonKeys") {
    const calls: [string, ...unknown[]][] = [];
    const answer = <V>(name: string, value: V): Promise<UsersResult<V>> =>
      Promise.resolve(refuse === name ? { ok: false as const, error: { code: "user_not_found", message: "" } } : { ok: true as const, value });
    const api: CreateAndAssignApi = {
      createUser: (request) => (calls.push(["createUser", request]), answer("createUser", { user: { id: "u-new" } })),
      bindUserToken: (tokenId, userId) => (calls.push(["bindUserToken", tokenId, userId]), answer("bindUserToken", { tokenId, userId, pending: false })),
      putUserPersonKeys: (userId, keys) => (calls.push(["putUserPersonKeys", userId, keys]), answer("putUserPersonKeys", { userId, personKeys: [] })),
    };
    const reported: string[] = [];
    const write = async <V>(run: () => Promise<UsersResult<V>>): Promise<V | null> => {
      const r = await run();
      if (r.ok) return r.value;
      reported.push(r.error.code);
      return null;
    };
    return { api, write, calls, reported };
  }

  it("creates the user without a grant, binds the device, then puts the remembered key", async () => {
    const f = fake();
    expect(await createUserAndAssign(f.api, f.write, { name: "  Alex  ", tokenId: "mct-1", rememberKey: KEY })).toEqual({ userId: "u-new", bound: true, remembered: true });
    expect(f.calls).toEqual([
      ["createUser", { name: "Alex", grant: { projects: [], standaloneAgents: [], send: false } }],
      ["bindUserToken", "mct-1", "u-new"],
      ["putUserPersonKeys", "u-new", [{ publicKey: KEY }]],
    ]);
  });

  it("skips the key without 「记住这个人」 and stops at the first refusal", async () => {
    const noKey = fake();
    expect(await createUserAndAssign(noKey.api, noKey.write, { name: "Alex", tokenId: "mct-1", rememberKey: null })).toEqual({ userId: "u-new", bound: true, remembered: false });
    expect(noKey.calls.map((c) => c[0])).toEqual(["createUser", "bindUserToken"]);

    const notCreated = fake("createUser");
    expect(await createUserAndAssign(notCreated.api, notCreated.write, { name: "Alex", tokenId: "mct-1", rememberKey: KEY })).toEqual({ userId: null, bound: false, remembered: false });
    expect(notCreated.calls.map((c) => c[0])).toEqual(["createUser"]);
    expect(notCreated.reported).toEqual(["user_not_found"]);

    const notBound = fake("bindUserToken");
    expect(await createUserAndAssign(notBound.api, notBound.write, { name: "Alex", tokenId: "mct-1", rememberKey: KEY })).toEqual({ userId: "u-new", bound: false, remembered: false });
    expect(notBound.calls.map((c) => c[0])).toEqual(["createUser", "bindUserToken"]);
  });

  it("does nothing for an empty name", async () => {
    const f = fake();
    expect(await createUserAndAssign(f.api, f.write, { name: "   ", tokenId: "mct-1", rememberKey: null })).toEqual({ userId: null, bound: false, remembered: false });
    expect(f.calls).toEqual([]);
  });
});
