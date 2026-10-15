import { describe, expect, it } from "vitest";
import type { MenuAction, MenuEntry } from "../src/renderer/src/lib/contextMenu";
import { notifyHidden, notifyLook, notifyMenu, notifyTooltip, type NotifyState } from "../src/renderer/src/lib/notifyControl";

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key);
const st = (over: Partial<NotifyState> = {}): NotifyState => ({ agent: "normal", projectMuted: false, groupName: "kks", ...over });
const actions = (log: string[]) => ({ setAgent: (l: string) => log.push(`agent:${l}`), toggleProject: () => log.push("toggle"), check: "✓", muteIcon: "m", unmuteIcon: "u" });
const rows = (entries: MenuEntry[]) => entries.filter((e): e is MenuAction => !!e && e !== "separator");

describe("title bar notification control", () => {
  it("hides only when neither setting is available", () => {
    expect(notifyHidden(st({ agent: null, projectMuted: null }))).toBe(true);
    expect(notifyHidden(st({ agent: null }))).toBe(false);
    expect(notifyHidden(st({ projectMuted: null }))).toBe(false);
  });

  it("icon: either silence wins, then important, else on", () => {
    expect(notifyLook(st())).toBe("on");
    expect(notifyLook(st({ agent: "important" }))).toBe("important");
    expect(notifyLook(st({ agent: "off" }))).toBe("off");
    expect(notifyLook(st({ agent: "important", projectMuted: true }))).toBe("off");
    expect(notifyLook(st({ agent: null, projectMuted: false }))).toBe("on");
  });

  it("tooltip names both settings; independent group wording", () => {
    expect(notifyTooltip(st({ projectMuted: true }), t as never)).toBe("notify.control\nnotify.tipAgent(notify.lvl.normal)\nnotify.tipProject(kks,notify.tipMuted)\nnotify.tipClick");
    expect(notifyTooltip(st({ groupName: null, projectMuted: null }), t as never)).toBe("notify.control\nnotify.tipAgent(notify.lvl.normal)\nnotify.tipClick");
    expect(notifyTooltip(st({ groupName: null, agent: null }), t as never)).toContain("notify.tipIndependent(notify.tipNotMuted)");
  });

  it("menu: three levels with the current one checked, then the group mute", () => {
    const log: string[] = [];
    const menu = notifyMenu(st({ agent: "important" }), t as never, actions(log));
    const r = rows(menu);
    const levels = r.filter((x) => x.label.startsWith("notify.lvl."));
    expect(levels.map((x) => [x.label, x.icon])).toEqual([
      ["notify.lvl.off", undefined],
      ["notify.lvl.normal", undefined],
      ["notify.lvl.important", "✓"],
    ]);
    levels[0]!.onSelect();
    expect(menu).toContain("separator");
    const mute = r.find((x) => x.label.startsWith("notify.muteProject"))!;
    expect(mute.label).toBe("notify.muteProject(kks)");
    mute.onSelect();
    expect(log).toEqual(["agent:off", "toggle"]);
  });

  it("menu: unmute wording, independent group, no agent section without a level", () => {
    const r = rows(notifyMenu(st({ agent: null, projectMuted: true, groupName: null }), t as never, actions([])));
    expect(r.some((x) => x.label.startsWith("notify.lvl."))).toBe(false);
    expect(r[0]!.label).toBe("notify.unmuteIndependent");
    expect(r[0]!.icon).toBe("u");
    expect(rows(notifyMenu(st({ projectMuted: null }), t as never, actions([]))).some((x) => x.label.includes("mute"))).toBe(false);
  });
});
