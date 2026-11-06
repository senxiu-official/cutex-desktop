// Design 040 §2.1 (owner 2026-11-05): where it matters the app draws its own tooltip (`data-tip`, lib/tips) instead of
// the OS tooltip of a native `title` — the window's title bar, the tray, the Rails, the status row, the composer's
// footer, the conversation header, and every button that opens a panel (`aria-haspopup`: an OS tooltip would cover
// the panel it opened), and the sidebar (agent rows, project rows, folds, folder rows: their tips go beside the
// sidebar). This blocks new native titles there only; the ~1,300 minor titles elsewhere stay.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src/renderer/src");

/** The listed areas: no native `title` on an element here. */
export const TIP_AREAS = [
  // Title bar
  "components/TitleBar.tsx",
  "components/side/TitleBarLaunchers.tsx",
  "components/HostSwitcher.tsx",
  "components/HostMark.tsx",
  "components/ShowDesktopButton.tsx",
  "components/side/NarrowChip.tsx",
  "components/RestoreBanner.tsx",
  // Tray
  "components/ChipTray.tsx",
  "components/NeedsYou.tsx",
  "components/BackgroundOperations.tsx",
  "modules/home/Dock.tsx",
  "modules/home/TrayNoteEditor.tsx",
  // Rails
  "components/side/ShelfRail.tsx",
  "components/side/WorkspaceRail.tsx",
  // Status row
  "components/StatusChip.tsx",
  "components/StatusBar.tsx",
  "components/AgentStatus.tsx",
  "modules/goal/GoalStatus.tsx",
  "modules/plan/PlanStatus.tsx",
  "modules/delegations/DelegationStatus.tsx",
  "modules/subagents/SubagentsStatus.tsx",
  "modules/background-terminals/TerminalsStatus.tsx",
  "modules/alarms/AlarmsStatus.tsx",
  "modules/jobs/JobStatus.tsx",
  "components/InputStatus.tsx",
  "components/QueueInsertStatus.tsx",
  "components/DeliveryStatus.tsx",
  "components/ClaudeRulesChip.tsx",
  "components/CutexRulesChip.tsx",
  // Composer footer
  "components/Composer.tsx",
  "components/ComposerTools.tsx",
  "components/ComposerPanels.tsx",
  "components/Menu.tsx",
  // Conversation header
  "components/ConversationHeader.tsx",
  // Sidebar (roster rows, project rows, folds, folder rows; the window-bar entries)
  "components/Sidebar.tsx",
  "components/AgentRows.tsx",
  "components/SidebarNowAll.tsx",
  "components/SidebarPeek.tsx",
  "components/SidebarNav.tsx",
];

/** Components that pass `title` on to their element (so `title=` on them is a native title). */
const FORWARDS_TITLE = new Set(["Tag", "EffectButton"]);

/** Every JSX opening tag in `code`: its name, attribute text and line. Skips `{…}` and strings inside the tag. */
export function openingTags(code: string): { name: string; attrs: string; line: number }[] {
  const out: { name: string; attrs: string; line: number }[] = [];
  const re = /<([A-Za-z][\w.]*)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length, depth = 0, quote = "";
    for (; i < code.length; i++) {
      const c = code[i]!;
      if (quote) {
        if (c === quote && code[i - 1] !== "\\") quote = "";
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
      else if (c === "<" && depth === 0) break; // a generic / comparison, not a tag
    }
    out.push({ name: m[1]!, attrs: code.slice(m.index + m[0].length, i), line: code.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** The attribute text with its `{…}` expressions blanked, so a `title=` inside a nested element or string is not seen. */
function topLevel(attrs: string): string {
  let out = "", depth = 0;
  for (const c of attrs) {
    if (c === "{") depth++;
    if (depth === 0) out += c;
    if (c === "}") depth--;
  }
  return out;
}

const nativeTitle = (name: string, attrs: string) => /(?:^|\s)title=/.test(topLevel(attrs)) && (/^[a-z]/.test(name) || FORWARDS_TITLE.has(name));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) ? [p] : [];
  });
}

describe("native titles (design 040 §2.1)", () => {
  it("none in the listed areas: they use data-tip", () => {
    const found: string[] = [];
    for (const rel of TIP_AREAS) {
      for (const tag of openingTags(readFileSync(join(SRC, rel), "utf8"))) if (nativeTitle(tag.name, tag.attrs)) found.push(`${rel}:${tag.line} <${tag.name}>`);
    }
    expect(found, "use data-tip (lib/tips); how-to text goes into an InfoMark").toEqual([]);
  });

  it("none on a button that opens a panel (aria-haspopup), anywhere", () => {
    const found: string[] = [];
    for (const path of files(SRC)) {
      const rel = relative(SRC, path).replace(/\\/g, "/");
      if (rel.startsWith("dev/")) continue;
      for (const tag of openingTags(readFileSync(path, "utf8"))) if (/aria-haspopup/.test(topLevel(tag.attrs)) && nativeTitle(tag.name, tag.attrs)) found.push(`${rel}:${tag.line} <${tag.name}>`);
    }
    expect(found, "an OS tooltip would cover the panel the button opened: use data-tip").toEqual([]);
  });

  it("the scanner sees titles on elements, not on component props or inside expressions", () => {
    const tags = openingTags(`<div title="a" /><Panel title="b" /><span data-tip={x ? "title=" : y} /><Tag title={t("x")}>`);
    expect(tags.map((t) => nativeTitle(t.name, t.attrs))).toEqual([true, false, false, true]);
  });

  it("the listed area files exist", () => {
    for (const rel of TIP_AREAS) expect(() => statSync(join(SRC, rel)), rel).not.toThrow();
  });
});
