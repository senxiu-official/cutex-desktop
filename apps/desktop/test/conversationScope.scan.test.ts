// The conversation subtree reads its agent / host / capabilities / sidebar from the conversation scope
// (lib/conversationScope, docs/research/panes-20261019.md §3 step 1a), never from the store's global
// selection, and passes its agent to every store action that would otherwise default to
// `get().selectedId`. Otherwise a second conversation pane would act on the wrong agent (§8 risk:
// "漏改会发错智能体"). Text scan (regex, comments stripped): approximate on purpose, with an allowlist.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../src/renderer/src");

/**
 * The conversation subtree: what <Conversation> renders (directly, or through the timeline / status /
 * overlay / gutter / turn-attachment slots), plus the hooks only they use. Directories count whole.
 * A file listed here may still be rendered elsewhere (the side agent page, side cards): there the
 * scope hooks fall back to the global selection (lib/conversationScope).
 */
export const CONVERSATION_SUBTREE: readonly string[] = [
  // the conversation column
  "components/Conversation.tsx",
  "components/Timeline.tsx",
  "components/Composer.tsx",
  "components/ComposerPanels.tsx",
  "components/ComposerTools.tsx",
  "components/ModelPicker.tsx",
  "components/QueuePanel.tsx",
  "components/InteractionDock.tsx",
  "components/StatusBar.tsx",
  "components/PendingOwnerNotes.tsx",
  "components/NeedsYouStrip.tsx",
  "components/ArchivedBanner.tsx",
  "components/AccessNotices.tsx",
  "components/GoalBar.tsx",
  "components/gutter",
  // timeline rows
  "components/Markdown.tsx",
  "components/PlainToolRow.tsx",
  "components/MessageActions.tsx",
  "components/Parties.tsx",
  "components/WorkGroup.tsx",
  "components/TurnSummary.tsx",
  "components/BusMessage.tsx",
  "components/SystemAvatar.tsx",
  "components/SafetyBlockCard.tsx",
  "components/CutexLink.tsx",
  "components/ClaudeCodeSourcesNote.tsx",
  "components/OwnerNotifyCard.tsx",
  "components/PendingMessagesSection.tsx",
  "components/DelegationCard.tsx",
  "components/DelegationQueue.tsx",
  "components/AdmissionRows.tsx",
  "components/PlanCard.tsx",
  // module outlets inside the conversation
  "modules/ConversationOverlays.tsx",
  "modules/TimelineOutlet.tsx",
  "modules/TimelineIntroView.tsx",
  "modules/timelineItemsView.ts",
  "modules/TurnAttachments.tsx",
  // module parts rendered there (timeline tools, status items, overlays)
  "modules/plan",
  "modules/safety-grants",
  "modules/goal/GoalStatus.tsx",
  "modules/approvals/ApprovalToolRow.tsx",
  "modules/approvals/BrowserClaimOverlay.tsx",
  "modules/artifacts/ToolRow.tsx",
  "modules/notes/NoteFloat.tsx",
  "modules/delegations/DelegationStatus.tsx",
  // composer parts, status items and gutters calling the agent's host (panes step 2)
  "components/ClaudeRulesChip.tsx",
  "components/LiveSandboxExtras.tsx",
  "modules/background-terminals/TerminalsStatus.tsx",
  "modules/subagents/useSubagentsStatus.tsx",
  "modules/thread-search/SearchGutter.tsx",
  // hooks of the subtree
  "lib/windowsSandboxView.ts",
  "lib/observedModelView.ts",
  "lib/structuralGateView.ts",
  "lib/gutterItems.ts",
  "lib/statusItemsView.ts",
  "lib/turnSummaryView.ts",
  "lib/delegationsView.ts",
  "lib/viewHost.ts",
  "lib/hostHome.ts",
];

/** Known exceptions: file + the offending text it may keep, and why. (Step 1c gave viewRow its host: none left.) */
const ALLOW: readonly { file: string; match: string; reason: string }[] = [];

/**
 * Store actions about one agent (store.ts), with the argument position of its HOST (0-based; panes
 * step 2: per-agent state and actions are keyed by host + id). A call in the subtree must pass at least
 * `index + 1` arguments (the agent's session id and its host); `submit` must pass `{ sessionId, hostId }`
 * in its options, `loadOlder` / `revertTo` `{ hostId }` in theirs.
 */
const HOST_ARG: Readonly<Record<string, number>> = {
  loadCollabModes: 1,
  clearGoal: 1,
  stopBackgroundTerminals: 1,
  compact: 1,
  queueYield: 1,
  interruptAndSendSteers: 1,
  resumePaused: 1,
  restorePaused: 1,
  discardPaused: 1,
  interrupt: 1,
  pauseAsks: 1,
  resumeAsks: 1,
  dismissPlan: 1,
  restorePlan: 1,
  completeTimeline: 1,
  reloadSession: 1,
  setCollabMode: 2,
  setGoal: 2,
  replaceGoal: 2,
  startReview: 2,
  updateSettings: 2,
  resendSteer: 2,
  dismissSteer: 2,
  queueRemove: 2,
  queueTakeForEdit: 2,
  queueSendNow: 2,
  loadModels: 2,
  retrySend: 2,
  editSend: 2,
  discardSend: 2,
  setBackgroundItems: 2,
  forkSession: 2,
  respond: 3,
  queueMove: 3,
  interruptAndSend: 3,
  editAndResend: 3,
  insertIntoComposer: 4,
  sessionAction: 3,
  /** store.ts `interruptWithFeedback(t, sessionId?, hostId?)`. */
  interruptWithFeedback: 2,
  /** `signal(target, arg, agent)` / `notify(text, tone, agent)`: meant for this conversation, not whichever is focused. */
  signal: 2,
  notify: 2,
};

/** Actions whose options object must name the agent: the keys it must contain. */
const OPTS_ARG: Readonly<Record<string, readonly string[]>> = {
  submit: ["sessionId", "hostId"],
  loadOlder: ["hostId"],
  revertTo: ["hostId"],
};

const files = (rel: string): string[] => {
  const path = join(SRC, rel);
  if (!statSync(path).isDirectory()) return [rel];
  return readdirSync(path).flatMap((name) => files(`${rel}/${name}`)).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
};

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The argument count of the call whose "(" is at `open` (top-level commas; a trailing comma ignored). */
function argCount(code: string, open: number): number {
  let depth = 0;
  let args = 0;
  let content = false;
  for (let i = open; i < code.length; i++) {
    const c = code[i]!;
    if ("([{".includes(c)) {
      depth++;
      if (depth > 1) content = true;
      continue;
    }
    if (")]}".includes(c)) {
      depth--;
      if (depth === 0) return content ? args + 1 : args;
      continue;
    }
    if (depth === 1 && c === ",") {
      args++;
      content = false;
      continue;
    }
    if (depth >= 1 && !/\s/.test(c)) content = true;
  }
  return -1;
}

const callText = (code: string, open: number): string => {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
};

/** Offences of one file's (comment-stripped) code. */
export function scanConversationFile(code: string): string[] {
  const out: string[] = [];
  const global = [
    { re: /(?:\.|\?\.)selected(?:Id|Host)\b/g, what: "reads the global selection (s.selectedId / selectedHost)" },
    { re: /\{[^{}]*\bselected(?:Id|Host)\b[^{}]*\}\s*=\s*(?:useApp|app|s\b|get)/g, what: "destructures the global selection" },
    { re: /\bagentHost\b/g, what: "uses agentHost (useConvHost / convHostOf)" },
    { re: /\bselectedFeatures\b/g, what: "uses selectedFeatures (useConvFeatures / convFeaturesOf)" },
    { re: /\bselectedSidebar\b/g, what: "uses selectedSidebar (useConvSidebar / convSidebarOf)" },
    // panes step 2: a bare id means the host of its latest view — wrong while the same id is open on two hosts
    { re: /\bsessionApi\(/g, what: "uses sessionApi (convApi / hostApi with the conversation's host)" },
    { re: /\bsessionViewOf\(/g, what: "uses sessionViewOf (convViewOf / viewOf with the host)" },
    { re: /\bviewHostOf\(/g, what: "uses viewHostOf (convViewHostOf / useConvViewHost)" },
  ];
  for (const { re, what } of global) for (const m of code.matchAll(re)) out.push(`${what}: ${m[0]}`);
  // Store actions: called as a member (`useApp.getState().x(`, `app.x(`) or through a local bound
  // from the store (`const x = useApp((s) => s.x)`), or the store's interruptWithFeedback.
  const bound = new Map<string, string>();
  for (const m of code.matchAll(/const (\w+) = useApp\(\(s\) => s\.(\w+)\)/g)) if (m[2]! in HOST_ARG || m[2]! in OPTS_ARG) bound.set(m[1]!, m[2]!);
  for (const m of code.matchAll(/(\.|\b)(\w+)\(/g)) {
    const name = m[2]!;
    const member = m[1] === ".";
    const action = member ? (name in HOST_ARG || name in OPTS_ARG ? name : null) : (bound.get(name) ?? (name === "interruptWithFeedback" ? name : null));
    if (!action) continue;
    // Skip declarations (`function x(`, `x(sessionId) {` in object literals) — only calls count.
    const before = code.slice(Math.max(0, m.index! - 12), m.index!);
    if (/(?:function|async)\s*$/.test(before)) continue;
    const open = m.index! + m[0].length - 1;
    const text = callText(code, open);
    const after = code.slice(open + text.length, open + text.length + 3);
    if (/^\s*\{/.test(after) || /^\s*=>/.test(after)) continue;
    if (action in HOST_ARG) {
      const n = argCount(code, open);
      if (n < HOST_ARG[action]! + 1) out.push(`calls ${action} without the conversation's agent and host: ${name}${text.slice(0, 80)}`);
    } else {
      const missing = OPTS_ARG[action]!.filter((k) => !new RegExp(`\\b${k}\\b`).test(text));
      if (missing.length) out.push(`calls ${action} without { ${missing.join(", ")} }: ${name}${text.slice(0, 80)}`);
    }
  }
  return out;
}

describe("conversation scope (panes steps 1a, 2)", () => {
  const all = CONVERSATION_SUBTREE.flatMap(files);

  it("the subtree list names existing files", () => {
    for (const rel of CONVERSATION_SUBTREE) expect(existsSync(join(SRC, rel)), rel).toBe(true);
    expect(all.length).toBeGreaterThan(50);
  });

  it("no file in the conversation subtree reads the global selection or calls a store action without its agent", () => {
    const offences: string[] = [];
    for (const rel of all) {
      const allowed = ALLOW.filter((a) => a.file === rel);
      for (const o of scanConversationFile(strip(readFileSync(join(SRC, rel), "utf8")))) {
        if (allowed.some((a) => o.includes(a.match))) continue;
        offences.push(`${rel}: ${o}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("every allowlist entry is still needed (and says why)", () => {
    for (const a of ALLOW) {
      expect(a.reason.length, a.file).toBeGreaterThan(20);
      const hits = scanConversationFile(strip(readFileSync(join(SRC, a.file), "utf8")));
      expect(hits.some((o) => o.includes(a.match)), `${a.file}: ${a.match} no longer needed`).toBe(true);
    }
  });

  it("the scan catches what it is meant to catch", () => {
    const bad = [
      "const id = useApp((s) => s.selectedId);",
      "const { selectedId } = useApp.getState();",
      "const host = useApp(agentHost);",
      "const f = useApp(selectedFeatures);",
      "const sb = useApp((s) => selectedSidebar(s));",
      "void useApp.getState().compact();",
      "void useApp.getState().updateSettings({ model });",
      "const respond = useApp((s) => s.respond);\nrespond(request.id, reply);",
      "void useApp.getState().submit(text, \"auto\");",
      "void interruptWithFeedback(t);",
      // panes step 2: the agent's host too
      "void useApp.getState().compact(sessionId);",
      "const respond = useApp((s) => s.respond);\nrespond(request.id, reply, sessionId);",
      "void useApp.getState().submit(text, \"auto\", [], { sessionId });",
      "void interruptWithFeedback(t, sessionId);",
      "useApp.getState().notify(t(\"x\"));",
      "useApp.getState().signal(\"goal\", \"edit\");",
      "void useApp.getState().loadOlder(sessionId);",
      "useApp.getState().retrySend(sessionId, entry.id);",
      "void sessionApi(sessionId).fsSearch(q);",
      "const v = sessionViewOf(state, sessionId);",
    ];
    for (const code of bad) expect(scanConversationFile(code), code).not.toEqual([]);
    const good = [
      "const id = useConvSession();",
      "void useApp.getState().compact(sessionId, hostId);",
      "void useApp.getState().updateSettings({ model }, sessionId, hostId);",
      "const respond = useApp((s) => s.respond);\nrespond(request.id, reply, sessionId, hostId);",
      "void useApp.getState().submit(text, \"auto\", [], { sessionId, hostId });",
      "void interruptWithFeedback(t, sessionId, hostId);",
      "useApp.getState().notify(t(\"x\"), \"info\", agent);",
      "useApp.getState().signal(\"goal\", \"edit\", agent);",
      "void useApp.getState().loadOlder(sessionId, { hostId });",
      "useApp.getState().retrySend(sessionId, entry.id, hostId);",
      "const selectedId = useConvSession();",
    ];
    for (const code of good) expect(scanConversationFile(code), code).toEqual([]);
  });
});

/** Every renderer file but the store, recursively. */
const allFiles = (rel = ""): string[] =>
  readdirSync(join(SRC, rel), { withFileTypes: true }).flatMap((e) => {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return allFiles(path);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [path] : [];
  });

/** Direct reads of the store's view map (`s.sessions[id]`, `state.sessions.x`, `getState().sessions[…]`). */
export function scanViewReads(code: string): string[] {
  return [...code.matchAll(/\b(?:s|st|state|app|current|previous|get\(\)|getState\(\))\.sessions(?:\?\.)?(?:\[|\.\w)/g)].map((m) => m[0]);
}

describe("agent views are read by host + id (panes step 1c)", () => {
  it("no renderer file but the store indexes the view map: they use viewOf / convViewOf / sessionViewOf (lib/viewKey keys)", () => {
    const offences: string[] = [];
    for (const rel of allFiles()) {
      if (rel === "store.ts") continue;
      for (const hit of scanViewReads(strip(readFileSync(join(SRC, rel), "utf8")))) offences.push(`${rel}: ${hit}`);
    }
    expect(offences).toEqual([]);
  });

  it("the scan catches what it is meant to catch", () => {
    for (const code of ["useApp((s) => s.sessions[id])", "useApp.getState().sessions[id]", "state.sessions?.[id]", "app.sessions.a1"]) expect(scanViewReads(code), code).not.toEqual([]);
    for (const code of ["useApp((s) => viewOf(s, hostId, id))", "useApp((s) => s.sessions)", "a.sessions.active", "r.sessions?.length"]) expect(scanViewReads(code), code).toEqual([]);
  });
});

/** Direct reads of a per-agent map of the store by key (`s.outbox[id]`, `getState().pendingSteers[…]`): keyed by host + id since panes step 2. */
export function scanAgentStateReads(code: string): string[] {
  return [...code.matchAll(/\b(?:s|st|state|app|current|previous|get\(\)|getState\(\))\.(?:outbox|queueHidden|pendingSteers|backgroundItems|collabModes|models|queueHandoff)(?:\?\.)?\[/g)].map((m) => m[0]);
}

describe("per-agent state is read by host + id (panes step 2)", () => {
  it("no renderer file but the store indexes a per-agent map: they use agentState(map, hostId, sessionId)", () => {
    const offences: string[] = [];
    for (const rel of allFiles()) {
      if (rel === "store.ts") continue;
      for (const hit of scanAgentStateReads(strip(readFileSync(join(SRC, rel), "utf8")))) offences.push(`${rel}: ${hit}`);
    }
    expect(offences).toEqual([]);
  });

  it("the scan catches what it is meant to catch", () => {
    for (const code of ["useApp((s) => s.outbox[sessionId])", "useApp.getState().pendingSteers[id]", "s.queueHandoff?.[id]", "s.models[sessionId]"]) expect(scanAgentStateReads(code), code).not.toEqual([]);
    for (const code of ["useApp((s) => agentState(s.outbox, hostId, sessionId))", "prices.models[name]", "useApp((s) => s.outbox)"]) expect(scanAgentStateReads(code), code).toEqual([]);
  });
});
