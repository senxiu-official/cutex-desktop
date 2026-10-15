import { describe, expect, it } from "vitest";
import { parseRef, turnRef } from "../src/renderer/src/lib/refs";
import { addBookmark, EMPTY_BOOKMARKS, homeBookmarks, readBookmarks, scopeBookmark, type BookmarkScope } from "../src/renderer/src/modules/bookmarks/model";
const at = "2026-10-11T01:00:00Z";
const add = (id: string, session: string, scope?: BookmarkScope, hostId = "local") => addBookmark(EMPTY_BOOKMARKS, turnRef({ hostId, sessionId: session, turnId: id, at }), parseRef, id, at, scope).records[0]!;

describe("bookmark home visibility is explicit, not inferred from project membership", () => {
  it("includes own session and explicitly chosen project, but not siblings/other projects/hosts", () => {
    const records = [
      add("own", "current"),
      add("auto", "sibling", { sessionId: "sibling", projectId: "p", projectExplicit: false }),
      add("chosen", "sibling", { sessionId: "sibling", projectId: "p", projectExplicit: true }),
      add("other-project", "sibling", { projectId: "other", projectExplicit: true }),
      add("other-host", "current", { projectId: "p", projectExplicit: true }, "remote"),
      add("old-sibling", "sibling"),
    ];
    expect(homeBookmarks(records, "local", "current", "p").map(r => r.id)).toEqual(["own", "chosen"]);
    expect(homeBookmarks(records, "local", "current").map(r => r.id)).toEqual(["own"]);
    expect(records).toHaveLength(6); // filtering never deletes the View all records
  });
  it("roundtrips inferred location separately from the explicit checkbox", () => {
    const record = add("one", "sibling", { sessionId: "sibling", projectId: "p", projectExplicit: false });
    const doc = { ...EMPTY_BOOKMARKS, records: [record] };
    expect(readBookmarks(doc, parseRef).document).toEqual(doc);
    const pinned = scopeBookmark(doc, "one", { ...record.scope, projectExplicit: true });
    expect(homeBookmarks(pinned.records, "local", "current", "p")).toHaveLength(1);
    const unpinned = scopeBookmark(pinned, "one", { ...record.scope, projectExplicit: false });
    expect(homeBookmarks(unpinned.records, "local", "current", "p")).toHaveLength(0);
    expect(homeBookmarks(unpinned.records, "local", "sibling", "p")).toHaveLength(1);
    expect(unpinned.records[0]?.scope?.projectId).toBe("p");
  });
  it("migrates legacy records without inventing explicit project intent", () => {
    const old = { version: 2, records: [add("one", "sibling")] };
    const parsed = readBookmarks(old, parseRef);
    expect(parsed.migrated).toBe(true); expect(parsed.document.version).toBe(3);
    expect(parsed.document.records).toEqual(old.records);
    expect(homeBookmarks(parsed.document.records, "local", "current", "p")).toHaveLength(0);
  });
  it("rejects malformed explicit project metadata without dropping original storage", () => {
    for (const scope of [{ projectExplicit: true }, { projectId: "p", projectExplicit: "true" }, { sessionId: 7 }]) {
      expect(readBookmarks({ version: 3, records: [{ ...add("one", "s"), scope }] }, parseRef).error).toBe("invalid-storage");
    }
  });
  it("also scopes non-turn references to their capture session", () => {
    const record = addBookmark(EMPTY_BOOKMARKS, { hostId: "local", kind: "terminal.pty", key: "pty:1", title: "Terminal", params: { ptyId: "1" } }, parseRef, "one", at, { sessionId: "s", projectId: "p", projectExplicit: false }).records[0]!;
    expect(homeBookmarks([record], "local", "s", "p")).toHaveLength(1);
    expect(homeBookmarks([record], "local", "other", "p")).toHaveLength(0);
  });
});
