// The owner's own icon / colour for a sidebar folder (folder menu 外观…, owner 2026-11-06): stored on the section
// (`look`), kept through local prefs and the synced layout document, and never lost by a build that predates it.
import { describe, expect, it } from "vitest";
import { FOLDER_COLORS, FOLDER_ICON_CHOICES, FOLDER_ICONS, folderLook, OLDER_FOLDER_LOOK, readFolderLookChoice } from "../src/renderer/src/lib/folderLook";
import { migrateSections, renameSection, setSectionLook, type SidebarSection } from "../src/renderer/src/lib/sidebarSections";
import { applyLayoutOp, decodeSidebar, emptySidebar, encodeSidebar, readSidebar, sidebarEdits, type LayoutHost, type SidebarDoc, type SidebarLocal } from "../src/renderer/src/lib/userLayoutModel";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import { Briefcase, Music } from "lucide-react";

const a = `ci-${"a".repeat(32)}`;
const hosts: LayoutHost[] = [{ id: "local", instanceId: a, label: "Host-A", online: true, supported: true, eligible: true }];
const section = (look?: SidebarSection["look"]): SidebarSection => ({ id: "s-1", name: "Work", collapsed: false, members: [hostKey("local", "p")], ...(look && { look }) });
const local = (s: SidebarSection): SidebarLocal => ({ sidebarSections: [s], starredProjects: [], projectOrder: [], foldedProjects: [], pinned: [], navPins: null });

describe("folder look choice", () => {
  it("uses the owner's colour and icon, each field on its own; the rest stays automatic", () => {
    const auto = folderLook("s-1");
    expect(folderLook("s-1", { color: "#8b5cf6" })).toEqual({ color: "#8B5CF6", icon: auto.icon });
    expect(folderLook("s-1", { icon: "music" })).toEqual({ color: auto.color, icon: Music });
    expect(folderLook("s-1", { color: "#D6409F", icon: "briefcase" })).toEqual({ color: "#D6409F", icon: Briefcase });
  });
  it("a custom colour is drawn (with its own ink); an invalid colour or an unknown icon is drawn automatic", () => {
    const red = folderLook("s-1", { color: "#ff0000", icon: "not-an-icon" });
    expect(red.color).toBe("#FF0000");
    expect(red.ink).toBeDefined();
    expect(red.icon).toBe(folderLook("s-1").icon);
    expect(folderLook("s-1", { color: "red" })).toEqual(folderLook("s-1"));
  });
  it("offers the folder icons and the project icons, never the 更早的项目 archive box", () => {
    for (const icon of FOLDER_ICONS) expect(FOLDER_ICON_CHOICES.map((c) => c.Icon)).toContain(icon);
    expect(FOLDER_ICON_CHOICES.length).toBeGreaterThan(FOLDER_ICONS.length);
    expect(FOLDER_ICON_CHOICES.map((c) => c.Icon)).not.toContain(OLDER_FOLDER_LOOK.icon);
    expect(new Set(FOLDER_ICON_CHOICES.map((c) => c.id)).size).toBe(FOLDER_ICON_CHOICES.length);
  });
  it("reads only short strings; nothing chosen is undefined", () => {
    expect(readFolderLookChoice({ color: "#0D9488", icon: 3 })).toEqual({ color: "#0D9488" });
    expect(readFolderLookChoice({ icon: "x".repeat(40) })).toBeUndefined();
    expect(readFolderLookChoice({})).toBeUndefined();
    expect(readFolderLookChoice("teal")).toBeUndefined();
  });
});

describe("folder look in local prefs", () => {
  it("is set, kept by other edits and removed again by 恢复自动", () => {
    const set = setSectionLook([section()], "s-1", { color: FOLDER_COLORS[2], icon: "flag" });
    expect(set[0]!.look).toEqual({ color: FOLDER_COLORS[2], icon: "flag" });
    expect(renameSection(set, "s-1", "Home")[0]!.look).toEqual(set[0]!.look);
    const back = setSectionLook(set, "s-1", null);
    expect(back[0]).toEqual(section());
    expect("look" in back[0]!).toBe(false);
  });
  it("survives a reload; folders saved before it load unchanged; a newer build's unknown icon is kept", () => {
    const stored = JSON.parse(JSON.stringify([section({ color: "#0EA5E9", icon: "from-a-newer-build" })]));
    expect(migrateSections(stored)[0]!.look).toEqual({ color: "#0EA5E9", icon: "from-a-newer-build" });
    const old = [{ id: "s-1", name: "Work", collapsed: true, members: [hostKey("local", "p")] }];
    expect(migrateSections(old)).toEqual(old);
    expect(migrateSections([{ ...old[0], look: "teal" }])).toEqual(old);
  });
});

describe("folder look in the synced layout", () => {
  it("round trips through the portable document", () => {
    const s = section({ color: "#F76B15", icon: "box" });
    const doc = encodeSidebar(local(s), hosts, "local");
    expect(doc.sections[0]!.look).toEqual({ color: "#F76B15", icon: "box" });
    expect(decodeSidebar(readSidebar(JSON.parse(JSON.stringify(doc))), hosts).sidebarSections[0]).toEqual(s);
  });
  it("a choice, a change and 恢复自动 replay as edits on the latest document", () => {
    const before = encodeSidebar(local(section()), hosts, "local");
    const chosen = encodeSidebar(local(section({ icon: "tag" })), hosts, "local");
    const ops = sidebarEdits(before, chosen, 10);
    expect(ops).toEqual([{ kind: "sectionField", id: "s-1", field: "look", value: { icon: "tag" }, t: 10 }]);
    const remote = ops.reduce(applyLayoutOp, before);
    expect(remote.sections[0]!.look).toEqual({ icon: "tag" });
    const reset = sidebarEdits(chosen, before, 11);
    expect(reset).toEqual([{ kind: "sectionField", id: "s-1", field: "look", value: null, t: 11 }]);
    const back = reset.reduce(applyLayoutOp, remote);
    expect("look" in back.sections[0]!).toBe(false);
  });
  it("a new folder carries its look in its create edit", () => {
    const after = encodeSidebar(local(section({ color: "#64748B" })), hosts, "local");
    const replayed = sidebarEdits(emptySidebar(), after, 5).reduce(applyLayoutOp, emptySidebar());
    expect(replayed.sections[0]).toMatchObject({ id: "s-1", look: { color: "#64748B" } });
  });
  it("an older build's edits (rename, fold, move) keep the look another device chose", () => {
    const remote: SidebarDoc = encodeSidebar(local(section({ color: "#A87956", icon: "shapes" })), hosts, "local");
    // An older build drops `look` when it decodes, then diffs and replays its own edits on the latest document.
    const strip = (d: SidebarDoc): SidebarDoc => ({ ...d, sections: d.sections.map(({ look: _l, ...s }) => s) });
    const seen = strip(remote);
    const renamed = { ...seen, sections: seen.sections.map((s) => ({ ...s, name: "Home", collapsed: true })) };
    const next = sidebarEdits(seen, renamed, 20).reduce(applyLayoutOp, remote);
    expect(next.sections[0]).toMatchObject({ name: "Home", collapsed: true, look: { color: "#A87956", icon: "shapes" } });
  });
});
