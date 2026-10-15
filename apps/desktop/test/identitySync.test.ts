// users-self-profile, desktop side: what 「你」 publishes to a host (planIdentityPublish), the avatar
// upload / ETag helpers (cutex's ETag: SHA-256 prefix of the bytes).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { avatarEtag, base64Bytes, splitDataUrl } from "../src/renderer/src/lib/identityAvatar";
import { planIdentityPublish, publishedName, recordPublished, syncIssue, syncSummary } from "../src/renderer/src/lib/identityPublish";

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
