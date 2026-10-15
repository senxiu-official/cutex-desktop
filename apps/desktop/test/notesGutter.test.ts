import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Note } from "../src/shared/notes";
import { conversationNotes } from "../src/renderer/src/modules/notes/gutter";

const note = (id: string, patch: Partial<Note> = {}): Note => ({
  id, title: id, body: "Body", scope: { kind: "session", id: "other" }, pins: [], anchor: null,
  anchorState: "ok", anchorStateAt: null, revision: 1, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", ...patch,
});

describe("Notes conversation entry", () => {
  it("keeps this session's notes but does not promote implicit project members", () => {
    const own = note("own", { scope: { kind: "session", id: "current" } });
    const inherited = note("same-project");
    const projectPin = note("selected", { pins: [{ kind: "project", id: "p" }] });
    const projectOwned = note("project-owned", { scope: { kind: "project", id: "p" } });
    const otherProject = note("elsewhere", { pins: [{ kind: "project", id: "q" }] });
    const hostPin = note("host-only", { pins: [{ kind: "host" }] });
    expect(conversationNotes([own, inherited, projectPin, projectOwned, otherProject, hostPin], "current", "p"))
      .toEqual({ current: [own], project: [projectPin, projectOwned] });
  });

  it("honors anchors and explicit session pins, de-duplicating project results", () => {
    const anchor = note("anchor", { scope: { kind: "project", id: "p" }, anchor: { sessionId: "current", turnId: "t" } });
    const sessionPin = note("session-pin", { pins: [{ kind: "session", id: "current" }, { kind: "project", id: "p" }] });
    expect(conversationNotes([anchor, sessionPin, anchor, sessionPin], "current", "p"))
      .toEqual({ current: [anchor, sessionPin], project: [] });
  });

  it("hides other sessions again when their explicit project pin is removed", () => {
    const marked = note("selected", { pins: [{ kind: "project", id: "p" }] });
    expect(conversationNotes([marked], "current", "p").project).toEqual([marked]);
    expect(conversationNotes([{ ...marked, pins: [] }], "current", "p").project).toEqual([]);
    expect(conversationNotes([marked], "current").project).toEqual([]);
  });

  it("uses the left container for entry, detail, and All navigation with no footer shortcut", () => {
    const source = (file: string) => readFileSync(new URL(`../src/renderer/src/modules/notes/${file}`, import.meta.url), "utf8");
    expect(source("index.ts")).toContain('"conversation.gutter": [{ id: "notes.gutter", side: "left", anchor: "top"');
    expect(source("index.ts")).not.toContain('"nav.primary"');
    const gutter = source("NotesGutter.tsx");
    expect(gutter).toContain("<NotesListBody");
    expect(gutter).toContain("<NoteDetail");
    expect(gutter).not.toContain("services.side.open");
    expect(gutter).not.toContain("services.refs.open");
    expect(gutter).toContain("key={JSON.stringify([props.hostId, props.sessionId])}");
  });
});
