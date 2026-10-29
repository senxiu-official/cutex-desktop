// users-self-profile, desktop side: what 「你」 publishes to a host (planIdentityPublish), the avatar
// upload / ETag helpers (cutex's ETag: SHA-256 prefix of the bytes).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { avatarEtag, base64Bytes, splitDataUrl } from "../src/renderer/src/lib/identityAvatar";
import { planIdentityPublish, planIdentityRound, publishedName, recordPublished, syncIssue, syncSummary } from "../src/renderer/src/lib/identityPublish";

const FEATURES = new Set(["users", "users-self-profile"]);
const access = (displayName: string | null = null, avatarEtag: string | null = null) => ({ pending: false, displayName, avatarEtag });
const prefs = (name: string, picture: string | null, nameAt: number | null = 10, pictureAt: number | null = 10) => ({ name, picture, nameAt, pictureAt });
const A = "aaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbb";

describe("planIdentityPublish", () => {
  it("sends nothing to an older cutex, a pending device, or before any edit on this desktop", () => {
    expect(planIdentityPublish({ features: new Set(["users"]), access: access(), prefs: prefs("J", null), published: undefined, avatar: null })).toEqual({ state: "unsupported" });
    expect(planIdentityPublish({ features: FEATURES, access: { pending: true }, prefs: prefs("J", null), published: undefined, avatar: null })).toEqual({ state: "pending" });
    expect(planIdentityPublish({ features: FEATURES, access: null, prefs: prefs("J", null), published: undefined, avatar: null })).toEqual({ state: "pending" });
    expect(planIdentityPublish({ features: FEATURES, access: access("Other", B), prefs: prefs("", null, null, null), published: undefined, avatar: null })).toEqual({ state: "local" });
  });

  it("fills a host field that is still empty even without an edit stamp (identity set before the host supported it)", () => {
    expect(planIdentityPublish({ features: FEATURES, access: access(), prefs: prefs("林木", "data:x", null, null), published: undefined, avatar: { etag: A } })).toEqual({ state: "syncing", patch: { displayName: "林木", avatar: "upload" } });
    // Only the empty one; a value the host already has is left alone.
    expect(planIdentityPublish({ features: FEATURES, access: access("Other", null), prefs: prefs("林木", "data:x", null, null), published: undefined, avatar: { etag: A } })).toEqual({ state: "syncing", patch: { avatar: "upload" } });
    // Once filled: synced, nothing more sent.
    expect(planIdentityPublish({ features: FEATURES, access: access("林木", A), prefs: prefs("林木", "data:x", null, null), published: undefined, avatar: { etag: A } })).toEqual({ state: "synced" });
  });

  it("sends only the fields edited here that differ from the host's view", () => {
    expect(planIdentityPublish({ features: FEATURES, access: access(), prefs: prefs(" Alex ", "data:x"), published: undefined, avatar: { etag: A } })).toEqual({ state: "syncing", patch: { displayName: "Alex", avatar: "upload" } });
    expect(planIdentityPublish({ features: FEATURES, access: access("Alex", A), prefs: prefs("Alex", "data:x"), published: undefined, avatar: { etag: A } })).toEqual({ state: "synced" });
    // A removed picture / emptied name clear the host's.
    expect(planIdentityPublish({ features: FEATURES, access: access("Alex", A), prefs: prefs("", null), published: undefined, avatar: null })).toEqual({ state: "syncing", patch: { displayName: null, avatar: null } });
    // Only the name was edited on this desktop: the picture published from another one stays.
    expect(planIdentityPublish({ features: FEATURES, access: access("Mia", B), prefs: prefs("米娅", null, 10, null), published: undefined, avatar: null })).toEqual({ state: "syncing", patch: { displayName: "米娅" } });
  });

  it("publishes an edit once; a later change from another desktop is not overwritten", () => {
    const published = recordPublished(prefs("Alex", "data:x"), undefined, { displayName: "Alex", avatarEtag: A });
    expect(published).toEqual({ nameAt: 10, name: "Alex", pictureAt: 10, etag: A });
    expect(planIdentityPublish({ features: FEATURES, access: access("Alex", A), prefs: prefs("Alex", "data:x"), published, avatar: { etag: A } })).toEqual({ state: "synced" });
    expect(planIdentityPublish({ features: FEATURES, access: access("A. Lee", B), prefs: prefs("Alex", "data:x"), published, avatar: { etag: A } })).toEqual({ state: "changedElsewhere" });
    // A new edit here wins again (only that field).
    expect(planIdentityPublish({ features: FEATURES, access: access("A. Lee", B), prefs: prefs("Alex", "data:x", 11, 10), published, avatar: { etag: A } })).toEqual({ state: "syncing", patch: { displayName: "Alex" } });
    // Recording keeps a field's stamp until it is edited again.
    expect(recordPublished(prefs("x", null, 11, 10), published, { displayName: "x", avatarEtag: B })).toEqual({ nameAt: 11, name: "x", pictureAt: 10, etag: A });
  });

  it("publishes a typed name only", () => {
    expect(publishedName({ name: "  " })).toBeNull();
    expect(publishedName({ name: " J " })).toBe("J");
  });
});

describe("planIdentityRound (every connected host; owner 2026-10-20)", () => {
  const OLD = new Set(["users"]);
  const hosts = [
    { hostId: "remote", features: FEATURES },
    { hostId: "hachimi", features: FEATURES },
    { hostId: "friend", features: FEATURES },
    { hostId: "newcomer", features: FEATURES },
    { hostId: "old", features: OLD },
  ];
  const access = {
    remote: { pending: false, displayName: null, avatarEtag: null }, // owner
    hachimi: { pending: false, displayName: null, avatarEtag: null }, // owner
    friend: { pending: false, displayName: "x", avatarEtag: null }, // bound user
    newcomer: { pending: true }, // pending device
    old: { pending: false },
  };

  it("publishes an edit to every host where this connection is the owner or a bound user, not only the focus host", () => {
    const plans = planIdentityRound({ hosts, access, prefs: prefs("林青", null, 10, null), published: {}, avatar: null });
    expect(plans.remote).toEqual({ state: "syncing", patch: { displayName: "林青" } });
    expect(plans.hachimi).toEqual({ state: "syncing", patch: { displayName: "林青" } });
    expect(plans.friend).toEqual({ state: "syncing", patch: { displayName: "林青" } });
    // Pending devices and older cutex: nothing.
    expect(plans.newcomer).toEqual({ state: "pending" });
    expect(plans.old).toEqual({ state: "unsupported" });
    // Not known yet (capabilities not read): treated as pending, nothing sent.
    expect(planIdentityRound({ hosts: [{ hostId: "x", features: FEATURES }], access: {}, prefs: prefs("林青", null, 10, null), published: {}, avatar: null }).x).toEqual({ state: "pending" });
  });

  it("a host connected later gets the pending edit once; published hosts are not sent it again", () => {
    const edit = prefs("林青", null, 10, null);
    const published = { remote: recordPublished(edit, undefined, { displayName: "林青", avatarEtag: null }) };
    const after = { ...access, remote: { pending: false, displayName: "林青", avatarEtag: null } };
    const plans = planIdentityRound({ hosts: hosts.slice(0, 2), access: after, prefs: edit, published, avatar: null });
    expect(plans.remote).toEqual({ state: "synced" });
    expect(plans.hachimi).toEqual({ state: "syncing", patch: { displayName: "林青" } });
    // Once hachimi has it too: nothing more.
    const both = { ...published, hachimi: recordPublished(edit, undefined, { displayName: "林青", avatarEtag: null }) };
    const synced = planIdentityRound({ hosts: hosts.slice(0, 2), access: { ...after, hachimi: { pending: false, displayName: "林青", avatarEtag: null } }, prefs: edit, published: both, avatar: null });
    expect(synced).toEqual({ remote: { state: "synced" }, hachimi: { state: "synced" } });
  });

  it("a desktop without its own name fills empty hosts with the one your other hosts have, never the OS name", () => {
    const fresh = prefs("", null, null, null); // "" = the OS account name, shown only
    const withNames = { remote: { pending: false, displayName: "林青", avatarEtag: A }, hachimi: { pending: false, displayName: null, avatarEtag: null } };
    const plans = planIdentityRound({ hosts: hosts.slice(0, 2), access: withNames, prefs: fresh, published: {}, avatar: null, adopted: { name: "林青", avatar: { etag: A } } });
    expect(plans.hachimi).toEqual({ state: "syncing", patch: { displayName: "林青", avatar: "upload" } });
    expect(plans.remote).toEqual({ state: "local" });
    // Nothing adopted: nothing sent (the OS name is never published).
    expect(planIdentityRound({ hosts: hosts.slice(1, 2), access: withNames, prefs: fresh, published: {}, avatar: null, adopted: { name: null, avatar: null } }).hachimi).toEqual({ state: "local" });
    expect(planIdentityRound({ hosts: hosts.slice(1, 2), access: withNames, prefs: fresh, published: {}, avatar: null }).hachimi).toEqual({ state: "local" });
    // Never over a value the host has, nor to a pending / older host.
    expect(planIdentityRound({ hosts: hosts.slice(2), access, prefs: fresh, published: {}, avatar: null, adopted: { name: "林青", avatar: null } })).toEqual({ friend: { state: "local" }, newcomer: { state: "pending" }, old: { state: "unsupported" } });
    // A name cleared on this desktop (an edit) is not refilled from other hosts.
    expect(planIdentityRound({ hosts: hosts.slice(1, 2), access: withNames, prefs: prefs("", null, 10, 10), published: {}, avatar: null, adopted: { name: "林青", avatar: { etag: A } } }).hachimi).toEqual({ state: "synced" });
  });
});

describe("syncSummary (the line under 「你」)", () => {
  const hostName = (id: string) => id.toUpperCase();
  const named = { name: "Sam Yang", picture: null };
  const empty = { name: "", picture: null };
  const st = (state: string, error?: string) => ({ state, ...(error ? { error } : {}) }) as never;
  it("counts synced hosts; nothing without a connected host", () => {
    expect(syncSummary({ statuses: {}, prefs: named, access: {}, hostName })).toBeNull();
    expect(syncSummary({ statuses: { a: st("synced"), b: st("changedElsewhere") }, prefs: named, access: {}, hostName })).toEqual({ key: "me.access.sync.synced", vars: { n: 2 } });
  });
  it("names the first failed host, with or without synced ones", () => {
    expect(syncSummary({ statuses: { a: st("synced"), b: st("failed", "boom") }, prefs: named, access: {}, hostName })).toEqual({ key: "me.access.sync.syncedFailed", vars: { n: 1, host: "B" }, error: "boom" });
    expect(syncSummary({ statuses: { b: st("failed") }, prefs: named, access: {}, hostName })).toMatchObject({ key: "me.access.sync.failed", vars: { host: "B" } });
  });
  it("reads `local` as “same as elsewhere” where the host has a name / picture, else “no name yet”", () => {
    expect(syncSummary({ statuses: { a: st("local") }, prefs: empty, access: { a: { displayName: "Sam Yang", avatarEtag: null } }, hostName })).toEqual({ key: "me.access.sync.sameElsewhere" });
    expect(syncSummary({ statuses: { a: st("local") }, prefs: named, access: { a: { avatarEtag: "0123456789abcdef" } }, hostName })).toEqual({ key: "me.access.sync.sameElsewhere" });
    expect(syncSummary({ statuses: { a: st("local") }, prefs: empty, access: { a: { displayName: null, avatarEtag: null } }, hostName })).toEqual({ key: "me.access.sync.noName" });
    expect(syncSummary({ statuses: { a: st("synced"), b: st("local") }, prefs: named, access: { b: { displayName: "Sam" } }, hostName })).toEqual({ key: "me.access.sync.synced", vars: { n: 2 } });
  });
  it("older hosts only: kept here; pending hosts are the row's business", () => {
    expect(syncSummary({ statuses: { a: st("unsupported"), b: st("pending") }, prefs: named, access: {}, hostName })).toEqual({ key: "me.access.sync.localOnly" });
    expect(syncSummary({ statuses: { b: st("pending") }, prefs: named, access: {}, hostName })).toBeNull();
    expect(syncSummary({ statuses: { a: st("syncing"), b: st("unsupported") }, prefs: named, access: {}, hostName })).toEqual({ key: "me.access.sync.syncing" });
  });
  it("host rows show exceptions only", () => {
    expect(syncIssue(st("synced"))).toBeNull();
    expect(syncIssue(st("local"))).toBeNull();
    expect(syncIssue(st("pending"))).toBeNull();
    expect(syncIssue(undefined)).toBeNull();
    expect(syncIssue(st("failed", "x"))).toEqual({ key: "me.access.issue.syncFailed", tone: "danger", error: "x" });
    expect(syncIssue(st("unsupported"))?.key).toBe("me.access.issue.unsupported");
  });
});

describe("avatar helpers", () => {
  it("splits image data URLs and counts their bytes", () => {
    expect(splitDataUrl("data:image/webp;base64,AAAA")).toEqual({ contentType: "image/webp", data: "AAAA" });
    expect(splitDataUrl("data:image/gif;base64,AAAA")).toBeNull();
    expect(splitDataUrl("data:image/svg+xml;utf8,<svg/>")).toBeNull();
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AA==")).toBe(1);
  });

  it("computes cutex's ETag: hex of the first 8 bytes of SHA-256", async () => {
    const bytes = Buffer.from("not really a png");
    const expected = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    expect(await avatarEtag({ contentType: "image/png", data: bytes.toString("base64") })).toBe(expected);
  });
});
