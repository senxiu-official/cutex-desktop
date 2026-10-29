// Full onboarding runs once for every 0.2 user. Snapshot known preferences at open;
// concepts stay visible while their already-configured choice cards are omitted.
export type FlowSection = "setup" | "basics" | "new" | "finish";

export type FlowStepId =
  // setup: one decision group per card
  | "language"
  | "theme"
  | "zoom"
  | "perf"
  | "terms"
  | "portraits"
  | "portraitThemes"
  | "sidebar"
  | "layout"
  // basics: what Cutex is
  | "intro"
  | "window"
  | "project"
  // what's in 0.2
  | "groups"
  | "pages"
  | "look"
  | "more"
  // last, first run without a Profile: its button ends the flow and opens the form
  | "profile";

export interface FlowStep {
  id: FlowStepId;
  section: FlowSection;
}

/** full: the whole flow (first run, and once for everyone at 0.2.0). whatsNew: only what 0.2 brought. */
export type FlowMode = "full" | "whatsNew";

// Product choices follow their concept. Look includes the portrait-style choice.
const FULL: readonly FlowStepId[] = ["language", "intro", "theme", "zoom", "perf", "terms", "project", "window", "sidebar", "groups", "layout", "pages", "look"];
export const NEW_IN_02: ReadonlySet<FlowStepId> = new Set(["groups", "pages", "look"]);
const NEW_ALONE: readonly FlowStepId[] = ["groups", "layout", "pages", "look", "sidebar", "more"];

/** Snapshot on opening, so an answer never removes the active card. */
export function configuredFlowSteps(storage: Pick<Storage, "getItem"> = localStorage): FlowStepId[] {
  const read = (key: string): Record<string, unknown> => {
    try { const value: unknown = JSON.parse(storage.getItem(key) ?? "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; }
  };
  const done = read("cutex-desktop.onboarding").doneRevision;
  if (typeof done !== "number" || done <= 0) return [];
  const ui = read("cutex-desktop.ui");
  const out: FlowStepId[] = ["language", "terms"];
  if (storage.getItem("cutex-desktop.theme")) out.push("theme");
  if (typeof read("cutex-desktop.appearance").zoom === "number") out.push("zoom");
  if (ui.perfMode === "save" || ui.perfMode === "smooth") out.push("perf");
  if (ui.sidebarLayout === "roster" || ui.sidebarLayout === "now-all") out.push("sidebar");
  if (typeof read("cutex-desktop.tray").allowThreeColumns === "boolean") out.push("layout");
  if (Array.isArray(ui.portraitPacks)) out.push("portraitThemes", "portraits");
  return out;
}

export function flowSteps(mode: FlowMode, opts: { noProfile?: boolean; portraitThemes?: boolean; configured?: readonly FlowStepId[] } = {}): FlowStep[] {
  const ids = mode === "whatsNew" ? NEW_ALONE : FULL;
  const configured = new Set(opts.configured ?? []);
  return [...ids.flatMap((id): FlowStepId[] => [id, ...(id === "look" && opts.portraitThemes && !configured.has("portraits") ? ["portraitThemes" as const] : [])]), ...(mode === "full" && opts.noProfile ? ["profile" as const] : [])]
    .filter((id) => !configured.has(id))
    .map((id) => ({ id, section: id === "profile" ? "finish" : mode === "whatsNew" ? "new" : "basics" }));
}

/** The sections of `steps` in order, with where each starts and how many steps it has (the progress indicator). */
export function flowSections(steps: readonly FlowStep[]): { section: FlowSection; start: number; count: number }[] {
  const out: { section: FlowSection; start: number; count: number }[] = [];
  steps.forEach((s, i) => {
    const last = out[out.length - 1];
    if (last?.section === s.section) last.count++;
    else out.push({ section: s.section, start: i, count: 1 });
  });
  return out;
}
