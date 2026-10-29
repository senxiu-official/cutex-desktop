import { describe, expect, it, vi } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
const connection = vi.hoisted(() => ({ epoch: 0 }));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { subscribe: () => () => {}, getState: () => ({ hosts: { hosts: [] } }) } }));
vi.mock("../src/renderer/src/lib/profileLooks", () => ({ patchProfileLook: vi.fn() }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ updateCachedProfile: vi.fn() }));
vi.mock("../src/renderer/src/lib/profileAccountLinks", () => ({
  accountLinkIdentity: (profile: ProfileItem) => profile.link ? `${profile.link.secretId}:${profile.link.accountKey}` : null,
  accountLinkHostAllowed: () => true,
  captureAccountLinkAction: () => { const epoch = connection.epoch; return () => epoch === connection.epoch; },
  accountProfilesSnapshot: () => [], refreshAccountProfiles: async () => {}, subscribeAccountProfiles: () => () => {},
}));
import { cleanAppearanceChanges, noticeShown, SYNCED_NOTICE_MS, LOOK_FIELDS, PROFILE_LINK_APPEARANCE_STORAGE, ProfileLinkAppearanceSync, profileAppearanceTransport, type AppearanceTransport, type LookField, type LookValue } from "../src/renderer/src/lib/profileLinkAppearance";
import { apiFor } from "../src/renderer/src/bridge";
import { patchProfileLook } from "../src/renderer/src/lib/profileLooks";
import type { LinkedProfileRef } from "../src/renderer/src/lib/profileAccountLinks";

const IDENTITY = "1234abcd:AAAAAAAAAAAAAAAAAAAAAA";
const PNG = "data:image/png;base64,QQ==";
const PNG2 = "data:image/png;base64,Qg==";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const refs: LinkedProfileRef[] = ["a", "b"].map((hostId) => ({ hostId, hostName: hostId.toUpperCase(), connected: true, profile: {
    id: `profile-${hostId}`, name: `Different name ${hostId}`, providerFamily: "anthropic", avatarEtag: null, introPortraitEtag: null,
    link: { secretId: "1234abcd", accountKey: "AAAAAAAAAAAAAAAAAAAAAA", basis: "manual", source: "manual" },
    appearance: { color: null, avatarThemes: null, introGreeting: null, effectiveColor: null, providerCategory: null },
    appearanceRevisions: Object.fromEntries(LOOK_FIELDS.map((field) => [field, { etag: null, updatedAt: "2030-01-01T00:00:00.000Z" }])),
  } as unknown as ProfileItem }));
  const images = new Map<string, string>();
  const calls: { host: string; field: LookField; value: unknown }[] = [];
  let tick = 0;
  const denied = new Set<string>();
  const styled = new Set(["a", "b"]);
  const current = (ref: LinkedProfileRef) => refs.find((r) => r.hostId === ref.hostId && r.profile.id === ref.profile.id)!;
  const stamp = (ref: LinkedProfileRef, field: LookField, value: unknown, time?: string) => {
    ref.profile.appearanceRevisions ??= {};
    ref.profile.appearanceRevisions[field] = { etag: value === null ? null : JSON.stringify(value), updatedAt: time ?? `2040-01-01T00:00:${String(Math.floor(++tick / 1000)).padStart(2, "0")}.${String(tick % 1000).padStart(3, "0")}Z` };
  };
  const external = (index: number, field: LookField, value: LookValue, time: string) => {
    const ref = refs[index]!;
    if (field === "avatar" || field === "introPortrait") {
      const key = `${ref.hostId}:${field}`;
      if (value === null) images.delete(key); else images.set(key, value as string);
      if (field === "avatar") ref.profile.avatarEtag = value === null ? null : `image:${value}`;
      else ref.profile.introPortraitEtag = value === null ? null : `image:${value}`;
    } else Object.assign(ref.profile.appearance, { [field]: value });
    stamp(ref, field, value, time);
  };
  const transport: AppearanceTransport = {
    refs: () => refs,
    allowed: (host) => !!refs.find((r) => r.hostId === host && r.connected) && !denied.has(host),
    styled: (host) => styled.has(host),
    fresh: async (ref) => structuredClone(current(ref).profile),
    image: async (ref, field) => {
      const dataUrl = images.get(`${ref.hostId}:${field}`);
      return dataUrl ? { dataUrl, etag: field === "avatar" ? current(ref).profile.avatarEtag! : current(ref).profile.introPortraitEtag! } : null;
    },
    write: async (ref, field, value) => {
      expect(transport.allowed(ref.hostId)).toBe(true);
      if (field === "avatarStyle") expect(styled.has(ref.hostId), `avatarStyle sent to ${ref.hostId}`).toBe(true);
      calls.push({ host: ref.hostId, field, value });
      external(refs.indexOf(current(ref)), field, value, `2040-01-01T00:00:00.${String(++tick).padStart(3, "0")}Z`);
      return structuredClone(current(ref).profile);
    },
    refresh: async () => {},
  };
  const engine = () => new ProfileLinkAppearanceSync(transport, storage);
  return { refs, data, storage, images, calls, transport, external, denied, styled, engine };
}

describe("linked profile appearance", () => {
  it("cancels deferred source/target reads on undo or keepSeparate without any later write", async () => {
    for (const host of ["a", "b"]) for (const action of ["undo", "keepSeparate"] as const) {
      const f = fixture(); const sync = f.engine(); await sync.flush();
      const original = f.transport.fresh;
      const entered = deferred<void>(); const gate = deferred<ProfileItem>();
      let blocked = false;
      f.transport.fresh = async (ref) => {
        if (ref.hostId === host && !blocked) { blocked = true; entered.resolve(); return gate.promise; }
        return original(ref);
      };
      f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
      const running = sync.flush(); await entered.promise;
      if (action === "undo") await sync.undo(IDENTITY); else sync.keepSeparate(IDENTITY);
      gate.resolve(structuredClone(f.refs.find((r) => r.hostId === host)!.profile));
      await running; await sync.flush();
      expect(f.calls, `${action} during ${host} read`).toEqual([]);
      expect(f.refs[1]!.profile.appearance.color).toBeNull();
    }
  });

  it("cancels deferred target image reads and adapter preflight without sending the old write", async () => {
    for (const phase of ["image", "preflight"] as const) for (const action of ["undo", "keepSeparate"] as const) {
      const f = fixture();
      for (const index of [0, 1]) f.external(index, "avatar", PNG, "2030-01-01T00:00:00.000Z");
      const sync = f.engine(); await sync.flush();
      const entered = deferred<void>(); const gate = deferred<void>(); let blocked = false;
      if (phase === "image") {
        const image = f.transport.image;
        f.transport.image = async (ref, field) => {
          if (ref.hostId === "b" && !blocked) { blocked = true; entered.resolve(); await gate.promise; }
          return image(ref, field);
        };
      } else {
        const write = f.transport.write;
        f.transport.write = async (ref, field, value, isCurrent) => {
          if (!blocked) { blocked = true; entered.resolve(); await gate.promise; }
          if (!isCurrent?.()) throw Error("cancelled before mutation");
          return write(ref, field, value);
        };
      }
      f.external(0, "avatar", PNG2, "2031-01-01T00:00:00.000Z");
      const running = sync.flush(); await entered.promise;
      if (action === "undo") await sync.undo(IDENTITY); else sync.keepSeparate(IDENTITY);
      gate.resolve(); await running; await sync.flush();
      expect(f.calls, `${action} during ${phase}`).toEqual([]);
      expect(f.images.get("b:avatar")).toBe(PNG);
    }
  });

  it("retains compensation for an already-sent write but never sends later cancelled fields", async () => {
    for (const action of ["undo", "keepSeparate"] as const) {
      const f = fixture(); const sync = f.engine(); await sync.flush();
      const write = f.transport.write; const entered = deferred<void>(); const gate = deferred<void>(); let blocked = false;
      f.transport.write = async (...args) => {
        const next = await write(...args);
        if (!blocked) { blocked = true; entered.resolve(); await gate.promise; }
        return next;
      };
      f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
      f.external(0, "introGreeting", "must not arrive", "2031-01-01T00:00:00.000Z");
      const running = sync.flush(); await entered.promise;
      if (action === "undo") await sync.undo(IDENTITY); else sync.keepSeparate(IDENTITY);
      gate.resolve(); await running; await sync.flush();
      expect(f.calls.every((call) => call.field === "color")).toBe(true);
      expect(f.refs[1]!.profile.appearance.introGreeting).toBeNull();
      if (action === "keepSeparate") {
        expect(f.calls).toHaveLength(1);
        expect(sync.view(IDENTITY).notice?.undo).toBe(true);
        await sync.undo(IDENTITY); await sync.flush();
      }
      expect(f.refs[1]!.profile.appearance.color).toBeNull();
      expect(f.calls).toHaveLength(2);
    }
  });

  it("refreshes target revisions on explicit re-choice so a newer offline target can converge", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    f.refs[1]!.connected = false;
    const finish = sync.beginEdit(f.refs[0]!);
    f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
    await sync.saved(f.refs[0]!, { color: "#123456" }, true); finish(); await sync.flush();
    f.external(1, "color", "#BBBBBB", "2099-01-01T00:00:00.000Z");
    // Choosing while offline preserves the old target fence; it cannot authorize unseen changes.
    await sync.choose(IDENTITY, f.refs[0]!); await sync.flush();
    f.refs[1]!.connected = true; await sync.flush();
    expect(sync.view(IDENTITY).notice?.kind).toBe("newerChange");
    expect(f.calls).toEqual([]);
    await sync.choose(IDENTITY, f.refs[0]!); await sync.flush();
    expect(f.refs[1]!.profile.appearance.color).toBe("#123456");
    expect(sync.view(IDENTITY).conflict).toBe(false);
    expect(sync.view(IDENTITY).notice?.kind).toBe("synced");
  });

  it("automatically converges competing same-field edits using the observed target version", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    f.external(0, "color", "#AA0000", "2031-01-01T00:00:00.000Z");
    f.external(1, "color", "#0000BB", "2032-01-01T00:00:00.000Z");
    await sync.flush();
    expect(f.refs.map((ref) => ref.profile.appearance.color)).toEqual(["#0000BB", "#0000BB"]);
    expect(sync.view(IDENTITY).conflict).toBe(false);
    expect(f.calls).toEqual([{ host: "a", field: "color", value: "#0000BB" }]);
  });

  it("still protects a target change made after the automatic observation round", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    const fresh = f.transport.fresh; const entered = deferred<void>(); const gate = deferred<ProfileItem>(); let blocked = false;
    f.transport.fresh = async (ref) => { if (ref.hostId === "a" && !blocked) { blocked = true; entered.resolve(); return gate.promise; } return fresh(ref); };
    f.external(0, "color", "#AA0000", "2031-01-01T00:00:00.000Z");
    const running = sync.flush(); await entered.promise;
    f.external(1, "color", "#0000BB", "2032-01-01T00:00:00.000Z");
    gate.resolve(structuredClone(f.refs[0]!.profile)); await running;
    expect(f.refs[1]!.profile.appearance.color).toBe("#0000BB");
    expect(f.calls).toEqual([]);
    expect(sync.view(IDENTITY).notice?.kind).toBe("newerChange");
  });

  it("retains value-guarded undo if a sent request loses its reply after keepSeparate", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    const write = f.transport.write; const entered = deferred<void>(); const gate = deferred<void>(); let first = true;
    f.transport.write = async (...args) => {
      const next = await write(...args);
      if (first) { first = false; entered.resolve(); await gate.promise; throw Error("reply lost"); }
      return next;
    };
    f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
    const running = sync.flush(); await entered.promise;
    sync.keepSeparate(IDENTITY); gate.resolve(); await running;
    expect(f.calls).toHaveLength(1);
    expect(sync.view(IDENTITY).notice?.undo).toBe(true);
    await sync.undo(IDENTITY); await sync.flush();
    expect(f.refs[1]!.profile.appearance.color).toBeNull();
    expect(f.calls).toHaveLength(2);
  });

  it("does not enqueue an explicit selection cancelled while its target refresh is pending", async () => {
    const f = fixture(); f.external(1, "color", "#ABCDEF", "2031-01-01T00:00:00.000Z");
    const sync = f.engine(); await sync.flush();
    const fresh = f.transport.fresh; const entered = deferred<void>(); const gate = deferred<ProfileItem>();
    f.transport.fresh = async (ref) => { if (ref.hostId === "b") { entered.resolve(); return gate.promise; } return fresh(ref); };
    const choosing = sync.choose(IDENTITY, f.refs[0]!); await entered.promise;
    sync.keepSeparate(IDENTITY); gate.resolve(structuredClone(f.refs[1]!.profile));
    await choosing; await sync.flush(); expect(f.calls).toEqual([]);
  });

  it("fences adapter reads against a replaced connection, including a read-to-write epoch change", async () => {
    connection.epoch = 0;
    const f = fixture(); const gate = deferred<ProfileItem>();
    const api = { getProfile: vi.fn(() => gate.promise), profileImage: vi.fn(), patchProfile: vi.fn(), putProfileImage: vi.fn() };
    vi.mocked(apiFor).mockReturnValue(api as never);
    const reading = profileAppearanceTransport.fresh(f.refs[0]!);
    connection.epoch++; gate.resolve(structuredClone(f.refs[0]!.profile));
    await expect(reading).rejects.toThrow("connection");
    api.getProfile.mockResolvedValue(structuredClone(f.refs[0]!.profile));
    const profile = await profileAppearanceTransport.fresh(f.refs[0]!);
    connection.epoch++;
    await expect(profileAppearanceTransport.write({ ...f.refs[0]!, profile }, "color", "#123456")).rejects.toThrow();
    await expect(profileAppearanceTransport.image({ ...f.refs[0]!, profile }, "avatar")).rejects.toThrow();
    expect(api.patchProfile).not.toHaveBeenCalled(); expect(api.profileImage).not.toHaveBeenCalled();
  });

  it("rechecks field versions and operation/connection fences after adapter preflight before mutation", async () => {
    for (const changed of ["revision", "operation", "connection"] as const) {
      connection.epoch = 0;
      const f = fixture(); const gate = deferred<ProfileItem>();
      const api = { getProfile: vi.fn(() => gate.promise), patchProfile: vi.fn(), putProfileImage: vi.fn() };
      vi.mocked(apiFor).mockReturnValue(api as never);
      let current = true;
      const writing = profileAppearanceTransport.write(f.refs[0]!, "color", "#123456", () => current);
      if (changed === "revision") f.external(0, "color", "#BBBBBB", "2099-01-01T00:00:00.000Z");
      else if (changed === "connection") connection.epoch++;
      else current = false;
      gate.resolve(structuredClone(f.refs[0]!.profile));
      await expect(writing).rejects.toThrow();
      expect(api.patchProfile).not.toHaveBeenCalled(); expect(api.putProfileImage).not.toHaveBeenCalled();
    }
  });

  it("returns a sent adapter write's receipt after cancellation so the worker can compensate", async () => {
    connection.epoch = 0;
    const f = fixture(); const before = structuredClone(f.refs[0]!.profile);
    f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
    const after = structuredClone(f.refs[0]!.profile); const sent = deferred<void>(); const gate = deferred<ProfileItem>();
    const api = { getProfile: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after), patchProfile: vi.fn(() => { sent.resolve(); return gate.promise; }) };
    vi.mocked(apiFor).mockReturnValue(api as never);
    let current = true;
    const writing = profileAppearanceTransport.write({ ...f.refs[0]!, profile: before }, "color", "#123456", () => current);
    await sent.promise; current = false; gate.resolve(after);
    await expect(writing).resolves.toEqual(after);
    expect(api.patchProfile).toHaveBeenCalledTimes(1);
  });

  it("uses the PATCH receipt for undo even when a later read sees another owner edit", async () => {
    for (const cancelled of [false, true]) {
      connection.epoch = 0;
      const f = fixture(); const sync = f.engine(); await sync.flush();
      const sent = deferred<void>(); const gate = deferred<void>();
      const api = {
        getProfile: vi.fn(async () => structuredClone(f.refs[1]!.profile)),
        patchProfile: vi.fn(async () => {
          f.external(1, "color", "#123456", "2040-01-01T00:00:00.000Z");
          const receipt = structuredClone(f.refs[1]!.profile);
          f.external(1, "color", "#0000BB", "2041-01-01T00:00:00.000Z");
          sent.resolve(); if (cancelled) await gate.promise;
          return receipt;
        }),
      };
      vi.mocked(apiFor).mockReturnValue(api as never);
      f.transport.write = profileAppearanceTransport.write;
      f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
      const running = sync.flush(); await sent.promise;
      if (cancelled) { sync.keepSeparate(IDENTITY); gate.resolve(); }
      await running;
      expect(sync.view(IDENTITY).notice?.undo).toBe(true);
      await sync.undo(IDENTITY); await sync.flush();
      expect(f.refs[1]!.profile.appearance.color).toBe("#0000BB");
      expect(api.patchProfile).toHaveBeenCalledTimes(1);
      expect(sync.view(IDENTITY).notice?.kind).toBe("newerChange");
    }
  });

  it("rejects an image revision superseded after PUT instead of claiming it as its receipt", async () => {
    for (const field of ["avatar", "introPortrait"] as const) for (const value of [PNG, null]) {
      connection.epoch = 0;
      const f = fixture(); const before = structuredClone(f.refs[0]!.profile);
      f.external(0, field, PNG2, "2041-01-01T00:00:00.000Z");
      const api = {
        getProfile: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(structuredClone(f.refs[0]!.profile)),
        putProfileImage: vi.fn().mockResolvedValue({ etag: value === null ? null : "own-image" }),
      };
      vi.mocked(apiFor).mockReturnValue(api as never);
      await expect(profileAppearanceTransport.write({ ...f.refs[0]!, profile: before }, field, value)).rejects.toMatchObject({ kind: "newerChange" });
      expect(api.putProfileImage).toHaveBeenCalledTimes(1);
    }
  });

  it("allows only appearance fields, inline validated images, and canonical scalar values", () => {
    expect(cleanAppearanceChanges({ name: "never", apiKey: "secret", accountLink: "manual", providerCategory: "other", model: "never", color: "#aBcDeF", avatarThemes: ["birds", "sea"], introGreeting: " hi ", avatar: "https://example.com/image", introPortrait: PNG })).toEqual({ color: "#ABCDEF", avatarThemes: ["birds", "sea"], introGreeting: "hi", introPortrait: PNG });
    expect(cleanAppearanceChanges({ color: "red", avatar: "data:text/html;base64,QQ==", avatarThemes: [], introGreeting: "a\u0001" })).toEqual({});
  });

  it("requires an owner source choice on first association even when one clock is newer", async () => {
    const f = fixture();
    f.external(1, "color", "#ABCDEF", "2099-01-01T00:00:00.000Z");
    const sync = f.engine();
    await sync.flush();
    expect(f.calls).toEqual([]);
    expect(sync.view(IDENTITY).conflict).toBe(true);
    await sync.choose(IDENTITY, f.refs[1]!);
    await sync.flush();
    expect(f.refs[0]!.profile.appearance.color).toBe("#ABCDEF");
    expect(f.calls.every((call) => call.host === "a" && LOOK_FIELDS.includes(call.field))).toBe(true);
    expect(f.refs[0]!.profile.name).toBe("Different name a");
  });

  it("syncs later changes using per-field clocks and never replays a replication clock backwards", async () => {
    const f = fixture(); const sync = f.engine();
    await sync.flush();
    f.external(1, "color", "#ABCDEF", "2031-01-01T00:00:00.000Z");
    await sync.flush();
    expect(f.refs[0]!.profile.appearance.color).toBe("#ABCDEF");
    // A copied destination has a 2040 clock, but is unchanged since the baseline.
    f.external(1, "color", "#123456", "2032-01-01T00:00:00.000Z");
    await sync.flush();
    expect(f.refs[0]!.profile.appearance.color).toBe("#123456");
    expect(f.calls).toHaveLength(2);
  });

  it("keeps different fields from concurrent hosts and asks on ambiguous equal clocks", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
    f.external(1, "introGreeting", "hello", "2032-01-01T00:00:00.000Z");
    await sync.flush();
    expect(f.refs.map((r) => r.profile.appearance.color)).toEqual(["#123456", "#123456"]);
    expect(f.refs.map((r) => r.profile.appearance.introGreeting)).toEqual(["hello", "hello"]);
    f.external(0, "color", "#AAAAAA", "2050-01-01T00:00:00.000Z");
    f.external(1, "color", "#BBBBBB", "2050-01-01T00:00:00.000Z");
    const count = f.calls.length; await sync.flush();
    expect(sync.view(IDENTITY).conflict).toBe(true);
    expect(f.calls).toHaveLength(count);
  });

  it("persists offline image/deletion work and resumes it after reloading and reconnecting", async () => {
    const f = fixture(); let sync = f.engine(); await sync.flush();
    f.refs[1]!.connected = false;
    const end = sync.beginEdit(f.refs[0]!);
    f.external(0, "avatar", PNG, "2031-01-01T00:00:00.000Z");
    await sync.saved(f.refs[0]!, { avatar: PNG }, true); end(); await sync.flush();
    expect(sync.view(IDENTITY).notice?.kind).toBe("pending");
    expect(f.data.get(PROFILE_LINK_APPEARANCE_STORAGE)).toContain(PNG);
    sync = f.engine(); f.refs[1]!.connected = true; await sync.flush();
    expect(f.images.get("b:avatar")).toBe(PNG);
    f.refs[1]!.connected = false;
    const release = sync.beginEdit(f.refs[0]!);
    f.external(0, "avatar", null, "2051-01-01T00:00:00.000Z");
    await sync.saved(f.refs[0]!, { avatar: null }, true); release(); await sync.flush();
    sync = f.engine(); f.refs[1]!.connected = true; await sync.flush();
    expect(f.refs[1]!.profile.avatarEtag).toBeNull();
    expect(f.images.has("b:avatar")).toBe(false);
  });

  it("does not overwrite a target's newer offline edit or a changed account or restricted host", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    f.refs[1]!.connected = false;
    const end = sync.beginEdit(f.refs[0]!);
    f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
    await sync.saved(f.refs[0]!, { color: "#123456" }, true); end(); await sync.flush();
    f.external(1, "color", "#BBBBBB", "2099-01-01T00:00:00.000Z");
    f.refs[1]!.connected = true; await sync.flush();
    expect(f.refs[1]!.profile.appearance.color).toBe("#BBBBBB");
    expect(sync.view(IDENTITY).notice?.kind).toBe("newerChange");
    expect(f.calls).toEqual([]);
    f.refs[1]!.profile.link = { ...f.refs[1]!.profile.link!, accountKey: "BBBBBBBBBBBBBBBBBBBBBB" };
    f.denied.add("b"); await sync.flush(); expect(f.calls).toEqual([]);
    f.denied.delete("b"); await sync.flush(); expect(f.calls).toEqual([]);
  });

  it("unchecking sync accepts a local change without background fanout", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    const end = sync.beginEdit(f.refs[0]!);
    f.external(0, "introGreeting", "local only", "2031-01-01T00:00:00.000Z");
    await sync.saved(f.refs[0]!, { introGreeting: "local only" }, false); end(); await sync.flush();
    expect(f.refs[1]!.profile.appearance.introGreeting).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it("undo restores only copied values, can wait offline, and never overwrites a later edit", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    f.external(0, "introPortrait", PNG2, "2031-01-01T00:00:00.000Z"); await sync.flush();
    expect(f.images.get("b:introPortrait")).toBe(PNG2);
    f.refs[1]!.connected = false; await sync.undo(IDENTITY); await sync.flush();
    expect(sync.view(IDENTITY).notice?.kind).toBe("pending");
    f.refs[1]!.connected = true; await sync.flush();
    expect(f.refs[1]!.profile.introPortraitEtag).toBeNull();
    expect(f.images.get("a:introPortrait")).toBe(PNG2);
    await sync.choose(IDENTITY, f.refs[0]!); await sync.flush();
    f.external(1, "introPortrait", PNG, "2099-01-01T00:00:00.000Z");
    await sync.undo(IDENTITY); await sync.flush();
    expect(f.images.get("b:introPortrait")).toBe(PNG);
    expect(sync.view(IDENTITY).notice?.kind).toBe("newerChange");
  });

  it("surfaces corrupt/full persistence instead of claiming durable offline success", async () => {
    const f = fixture(); f.data.set(PROFILE_LINK_APPEARANCE_STORAGE, "{broken");
    const corrupt = f.engine(); await corrupt.flush();
    expect(corrupt.view(IDENTITY).notice?.kind).toBe("storageError");
    expect(f.data.get(PROFILE_LINK_APPEARANCE_STORAGE)).toBe("{broken");
    f.data.clear();
    const full = new ProfileLinkAppearanceSync(f.transport, { getItem: () => null, setItem: () => { throw Error("full"); } });
    await full.flush(); expect(full.view(IDENTITY).notice?.kind).toBe("storageError");
  });

  it("can safely undo a committed request whose reply was lost, including across offline reload", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    const write = f.transport.write;
    let fail = true;
    f.transport.write = async (...args) => {
      const next = await write(...args);
      if (fail) { fail = false; throw Error("reply lost after server commit"); }
      return next;
    };
    f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z"); await sync.flush();
    expect(f.refs[1]!.profile.appearance.color).toBe("#123456");
    expect(sync.view(IDENTITY).notice?.kind).toBe("error");
    f.refs[1]!.connected = false;
    await sync.undo(IDENTITY); await sync.flush();
    const reloaded = f.engine();
    f.refs[1]!.connected = true;
    await reloaded.flush();
    expect(f.refs[1]!.profile.appearance.color).toBeNull();
    expect(f.refs[0]!.profile.appearance.color).toBe("#123456");
  });
});

describe("linked profile avatarStyle (design 047)", () => {
  const PORTRAIT = { kind: "portrait" as const, portraitThemes: ["pack-b/zeta", "pack-a/alpha"] };
  const style = (f: ReturnType<typeof fixture>, index: number) => f.refs[index]!.profile.appearance.avatarStyle ?? null;

  it("validates the full style shape exactly, keeps portrait order and canonicalises emoji order", () => {
    expect(cleanAppearanceChanges({ avatarStyle: PORTRAIT })).toEqual({ avatarStyle: PORTRAIT });
    expect(cleanAppearanceChanges({ avatarStyle: { kind: "emoji", emojiThemes: ["sea", "birds"] } })).toEqual({ avatarStyle: { kind: "emoji", emojiThemes: ["birds", "sea"] } });
    expect(cleanAppearanceChanges({ avatarStyle: { kind: "emoji", emojiThemes: null } })).toEqual({ avatarStyle: { kind: "emoji", emojiThemes: null } });
    expect(cleanAppearanceChanges({ avatarStyle: { kind: "letter" } })).toEqual({ avatarStyle: { kind: "letter" } });
    expect(cleanAppearanceChanges({ avatarStyle: null })).toEqual({ avatarStyle: null });
    for (const bad of [
      { kind: "letter", extra: 1 }, { kind: "future" }, { kind: "portrait", portraitThemes: [] }, { kind: "portrait", portraitThemes: ["Pack/x"] },
      { kind: "portrait", portraitThemes: ["a/b/c"] }, { kind: "portrait", portraitThemes: ["https://x/y"] }, { kind: "portrait", portraitThemes: ["a/b", "a/b"] },
      { kind: "portrait", portraitThemes: Array.from({ length: 129 }, (_, i) => `p/t${i}`) }, { kind: "emoji", emojiThemes: [] }, { kind: "emoji" }, "letter", ["letter"],
    ]) expect(cleanAppearanceChanges({ avatarStyle: bad }), JSON.stringify(bad)).toEqual({});
  });

  it("syncs a later style change between two capable hosts as its own field", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    f.external(0, "avatarStyle", PORTRAIT, "2031-01-01T00:00:00.000Z");
    await sync.flush();
    expect(style(f, 1)).toEqual(PORTRAIT);
    expect(f.calls).toEqual([{ host: "b", field: "avatarStyle", value: PORTRAIT }]);
    expect(f.refs[1]!.profile.appearance.color).toBeNull();
    // an explicit clear (null value, durable clock) also syncs
    f.external(1, "avatarStyle", null, "2032-01-01T00:00:00.000Z"); await sync.flush();
    expect(style(f, 0)).toBeNull();
    expect(sync.view(IDENTITY).conflict).toBe(false);
  });

  it("never sends avatarStyle to a host without the capability, while other fields still sync", async () => {
    const f = fixture(); f.styled.delete("b");
    f.external(0, "avatarStyle", PORTRAIT, "2030-01-01T00:00:00.000Z");
    const sync = f.engine(); await sync.flush();
    // a differing style on an incapable host is not a first-association conflict
    expect(sync.view(IDENTITY).conflict).toBe(false);
    f.external(0, "avatarStyle", { kind: "letter" }, "2031-01-01T00:00:00.000Z");
    f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
    await sync.flush();
    const end = sync.beginEdit(f.refs[0]!);
    f.external(0, "avatarStyle", { kind: "emoji", emojiThemes: null }, "2032-01-01T00:00:00.000Z");
    await sync.saved(f.refs[0]!, { avatarStyle: { kind: "emoji", emojiThemes: null } }, true); end(); await sync.flush();
    expect(f.calls).toEqual([{ host: "b", field: "color", value: "#123456" }]);
    expect(style(f, 1)).toBeNull();
    expect(sync.view(IDENTITY).notice?.kind).not.toBe("pending");
    // an explicit source choice from the capable host still skips the old host's style
    await sync.choose(IDENTITY, f.refs[0]!); await sync.flush();
    expect(f.calls.some((call) => call.field === "avatarStyle")).toBe(false);
    expect(sync.view(IDENTITY).conflict).toBe(false);
  });

  it("an incapable source never carries avatarStyle into a save or a choice", async () => {
    const f = fixture(); f.styled.delete("a");
    const sync = f.engine(); await sync.flush();
    f.external(1, "avatarStyle", PORTRAIT, "2031-01-01T00:00:00.000Z"); await sync.flush();
    expect(f.calls).toEqual([]);
    const end = sync.beginEdit(f.refs[0]!);
    await sync.saved(f.refs[0]!, { avatarStyle: { kind: "letter" } }, true); end(); await sync.flush();
    await sync.choose(IDENTITY, f.refs[0]!); await sync.flush();
    expect(f.calls).toEqual([]);
    expect(style(f, 1)).toEqual(PORTRAIT);
  });

  it("adopts the style once a host gains the capability and asks when the styles then differ", async () => {
    const f = fixture(); f.styled.delete("b");
    const sync = f.engine(); await sync.flush();
    f.external(0, "avatarStyle", PORTRAIT, "2031-01-01T00:00:00.000Z"); await sync.flush();
    f.styled.add("b"); await sync.flush();
    expect(f.calls).toEqual([]);
    expect(sync.view(IDENTITY).conflict).toBe(true);
    await sync.choose(IDENTITY, f.refs[0]!); await sync.flush();
    expect(style(f, 1)).toEqual(PORTRAIT);
    expect(f.calls).toEqual([{ host: "b", field: "avatarStyle", value: PORTRAIT }]);
  });

  it("holds a pending style write while the target lacks the capability and sends it once advertised", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    f.refs[1]!.connected = false;
    const end = sync.beginEdit(f.refs[0]!);
    f.external(0, "avatarStyle", PORTRAIT, "2031-01-01T00:00:00.000Z");
    await sync.saved(f.refs[0]!, { avatarStyle: PORTRAIT }, true); end(); await sync.flush();
    expect(sync.view(IDENTITY).notice?.kind).toBe("pending");
    f.styled.delete("b"); f.refs[1]!.connected = true;
    await f.engine().flush(); expect(f.calls).toEqual([]);
    const reloaded = f.engine(); f.styled.add("b"); await reloaded.flush();
    expect(f.calls).toEqual([{ host: "b", field: "avatarStyle", value: PORTRAIT }]);
  });

  it("never copies a style this desktop cannot validate as a clear", async () => {
    const f = fixture(); const sync = f.engine(); await sync.flush();
    f.external(1, "avatarStyle", PORTRAIT, "2031-01-01T00:00:00.000Z"); await sync.flush();
    f.external(0, "avatarStyle", { kind: "future-kind" } as unknown as LookValue, "2032-01-01T00:00:00.000Z"); await sync.flush();
    expect(style(f, 1)).toEqual(PORTRAIT);
    expect(f.calls.filter((call) => call.host === "b")).toEqual([]);
    expect(sync.view(IDENTITY).notice?.kind).toBe("error");
  });

  it("migrates a persisted baseline without avatarStyle marks instead of treating the store as corrupt", async () => {
    for (const same of [true, false]) {
      const f = fixture(); const sync = f.engine(); await sync.flush();
      f.refs[1]!.connected = false;
      const end = sync.beginEdit(f.refs[0]!);
      f.external(0, "color", "#123456", "2031-01-01T00:00:00.000Z");
      await sync.saved(f.refs[0]!, { color: "#123456" }, true); end(); await sync.flush();
      // rewrite the store as an older desktop saved it: five marks per member, no avatarStyle
      const saved = JSON.parse(f.data.get(PROFILE_LINK_APPEARANCE_STORAGE)!);
      for (const group of Object.values(saved.groups) as { members: Record<string, { marks: Record<string, unknown> }> }[]) for (const member of Object.values(group.members)) delete member.marks.avatarStyle;
      f.data.set(PROFILE_LINK_APPEARANCE_STORAGE, JSON.stringify(saved));
      if (!same) f.external(1, "avatarStyle", PORTRAIT, "2031-06-01T00:00:00.000Z");
      const reloaded = f.engine(); f.refs[1]!.connected = true; await reloaded.flush(); await reloaded.flush();
      expect(reloaded.view(IDENTITY).notice?.kind).not.toBe("storageError");
      expect(f.refs[1]!.profile.appearance.color).toBe("#123456");
      expect(f.calls.some((call) => call.field === "avatarStyle")).toBe(false);
      expect(reloaded.view(IDENTITY).conflict, `same=${same}`).toBe(!same);
      expect(JSON.parse(f.data.get(PROFILE_LINK_APPEARANCE_STORAGE)!).groups[IDENTITY].members[JSON.stringify(["a", "profile-a"])].marks.avatarStyle.token).not.toBe("?");
    }
  });

  it("the adapter PATCHes the full style and refreshes the looks cache", async () => {
    connection.epoch = 0;
    const f = fixture(); const before = structuredClone(f.refs[0]!.profile);
    f.external(0, "avatarStyle", PORTRAIT, "2031-01-01T00:00:00.000Z");
    const after = structuredClone(f.refs[0]!.profile);
    const api = { getProfile: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after), patchProfile: vi.fn(async () => after) };
    vi.mocked(apiFor).mockReturnValue(api as never);
    await expect(profileAppearanceTransport.write({ ...f.refs[0]!, profile: before }, "avatarStyle", PORTRAIT)).resolves.toEqual(after);
    expect(api.patchProfile).toHaveBeenCalledWith("profile-a", { avatarStyle: PORTRAIT });
    expect(vi.mocked(patchProfileLook)).toHaveBeenCalledWith("a", "profile-a", { appearance: { avatarStyle: PORTRAIT } });
  });
});

describe("已同步 is brief (owner 2026-10-25)", () => {
  it("a synced notice shows for SYNCED_NOTICE_MS after it was first seen; pending / errors stay", () => {
    const synced = { id: 901, kind: "synced" as const, hosts: ["remote"], undo: true };
    expect(noticeShown(synced, 1000)).toBe(true);
    expect(noticeShown(synced, 1000 + SYNCED_NOTICE_MS - 1)).toBe(true);
    expect(noticeShown(synced, 1000 + SYNCED_NOTICE_MS)).toBe(false);
    // A later sync is a new notice: shown again.
    expect(noticeShown({ ...synced, id: 902 }, 1000 + SYNCED_NOTICE_MS * 5)).toBe(true);
    for (const kind of ["pending", "error", "storageError", "newerChange"] as const) expect(noticeShown({ id: 903, kind, hosts: [], undo: true }, 10 ** 12)).toBe(true);
    expect(noticeShown(null)).toBe(false);
  });
});
