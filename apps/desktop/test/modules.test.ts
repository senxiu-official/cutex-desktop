// Built-in module registry (docs/desktop-modules.md §8): validity, i18n prefixes, import
// boundaries, and the gating snapshot of every slot under the mock's new and `?legacy` featureLists.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { MODULE_ID_RE } = await import("../src/renderer/src/modules/types");
const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { MODULE_DICTIONARIES } = await import("../src/renderer/src/modules/i18nCatalog");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");
const { MOCK_BASE_FEATURES, MOCK_NEW_FEATURES } = await import("../src/renderer/src/dev/mockFeatures");
const { SETTINGS_GROUP_ORDER } = await import("../src/renderer/src/lib/settingsNav");
const { SETTINGS_HOST_PAGES } = await import("../src/renderer/src/lib/settingsHost");
const { toolRendererFor } = await import("../src/renderer/src/lib/timelineRenderers");
const { taskToolRow } = await import("../src/renderer/src/lib/taskRows");

type SlotId = keyof typeof SLOT_SPECS;
const SRC = join(__dirname, "../src/renderer/src");
const MODULES_DIR = join(SRC, "modules");

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

async function gated(features: readonly string[] | null) {
  const host = createModuleHost({ modules: MODULES, slots: SLOT_SPECS, host: { id: "local", kind: "local", features: features && new Set(features) }, storage: memoryStorage(), services: () => stubServices(), log: () => {} });
  await host.idle();
  const label = (e: { item: { id: string }; mode: string; waiting: boolean; missing: readonly string[] }) => (e.mode === "show" ? e.item.id : `${e.item.id} (${e.mode}${e.waiting ? ", waiting" : ""}: ${e.missing.join(", ")})`);
  // In nav order: by group (the shell's order), then the slot order within a group.
  const pageEntries = SETTINGS_GROUP_ORDER.flatMap((g) => host.snapshot("settings.page").filter((e) => e.item.group === g));
  const pageOrder = pageEntries.map((e) => e.item.page);
  const sections = pageOrder.flatMap((p) => host.snapshot("settings.section").filter((e) => e.item.page === p)).map(label);
  const status = host.snapshot("conversation.status").map(label);
  const nav = host.snapshot("nav.primary");
  const navTop = nav.filter((e) => (e.item.area ?? "top") === "top").map(label);
  const navFooter = nav.filter((e) => e.item.area === "footer").map(label);
  const mainPages = host.snapshot("main.page").map(label);
  return { host, pages: pageEntries.map(label), sections, status, navTop, navFooter, mainPages };
}

const MOCK_REMOTE = ["management-client-tokens", "session-attachments", "fs-dir-browse"];

describe("module registry", () => {
  it("ids are valid and unique; dependencies exist and have no cycle; every module activates", async () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODULES) {
      expect(MODULE_ID_RE.test(m.id), m.id).toBe(true);
      for (const dependency of m.requires?.modules ?? []) expect(ids, `${m.id} → ${dependency}`).toContain(dependency);
    }
    // A dependency cycle would leave its modules inactive below.
    const { host } = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    for (const [id, status] of host.statuses()) expect([id, status.state.kind]).toEqual([id, MODULES.find((m) => m.id === id)?.defaultEnabled === false ? "disabled" : "active"]);
  });

  it("items carry their module prefix and are unique per slot", () => {
    for (const slot of Object.keys(SLOT_SPECS) as SlotId[]) {
      const seen = new Set<string>();
      for (const m of MODULES) {
        for (const item of m.contributes?.[slot] ?? []) {
          expect(item.id.startsWith(`${m.id}.`), item.id).toBe(true);
          expect(seen.has(item.id), item.id).toBe(false);
          seen.add(item.id);
        }
      }
    }
  });

  it("settings pages: unique deep-link names, known groups, notices have titles", () => {
    const pages = MODULES.flatMap((m) => m.contributes?.["settings.page"] ?? []);
    expect(new Set(pages.map((p) => p.page)).size).toBe(pages.length);
    for (const p of pages) {
      expect(SETTINGS_GROUP_ORDER).toContain(p.group);
    }
    expect(pages.filter((p) => p.group === "app").every((p) => p.source === "local" || p.source === null)).toBe(true);
    // Every page that edits a host (or its codex config) gets the host picker and follows it.
    for (const p of pages) if (p.source === "host" || p.source === "codex") expect(SETTINGS_HOST_PAGES.has(p.page), p.id).toBe(true);
    const sections = MODULES.flatMap((m) => m.contributes?.["settings.section"] ?? []);
    for (const s of sections) {
      if (s.unavailable === "notice") expect(s.titleKey, s.id).toBeTruthy();
      expect(pages.some((p) => p.page === s.page), s.id).toBe(true);
    }
  });

  it("status items: unique order, titles in both locales, a Bar wherever the default place uses the bar", () => {
    const items = MODULES.flatMap((m) => m.contributes?.["conversation.status"] ?? []);
    expect(new Set(items.map((i) => i.order)).size).toBe(items.length);
    for (const i of items) {
      expect(zhCN[i.titleKey], i.id).toBeTruthy();
      expect(en[i.titleKey], i.id).toBeTruthy();
      if (i.defaultPlace === "bar" || i.defaultPlace === "both") expect(i.Bar, i.id).toBeTruthy();
      expect(SLOT_SPECS["conversation.status"].placement!.values).toContain(i.defaultPlace);
    }
  });

  it("nav entries: titles in both locales, targets / active pages are known pages; pages are unique", () => {
    const pages = MODULES.flatMap((m) => m.contributes?.["main.page"] ?? []);
    const ids = new Set(pages.map((p) => p.id));
    expect(ids.size).toBe(pages.length);
    for (const n of MODULES.flatMap((m) => m.contributes?.["nav.primary"] ?? [])) {
      expect(zhCN[n.titleKey], n.id).toBeTruthy();
      expect(en[n.titleKey], n.id).toBeTruthy();
      if ("page" in n.target) expect(ids.has(n.target.page), n.id).toBe(true);
      for (const a of n.activePages ?? []) expect(ids.has(a), `${n.id} → ${a}`).toBe(true);
      expect(["top", "footer"]).toContain(n.area ?? "top");
    }
  });

  it("every literal page link (openPage / to / target / activePages) names a registered main.page", () => {
    const ids = new Set<string>(MODULES.flatMap((m) => m.contributes?.["main.page"] ?? []).map((p) => p.id));
    const all = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? all(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
    let links = 0;
    for (const file of all(SRC)) {
      const code = readFileSync(file, "utf8");
      for (const m of code.matchAll(/openPage\(\s*"([^"]+)"|\bpage: "([a-z][a-z0-9-]*\.[A-Za-z0-9-]+)"|PAGE: ItemId = "([^"]+)"/g)) {
        const id = m[1] ?? m[2] ?? m[3]!;
        links++;
        expect(ids.has(id), `${relative(SRC, file)} links ${id}`).toBe(true);
      }
    }
    expect(links).toBeGreaterThan(10);
  });

  it("timeline renderers: unique schemas and deterministic new/legacy/waiting contributions", async () => {
    const received = MODULES.flatMap((m) => m.contributes?.["timeline.received"] ?? []);
    const schemas = received.flatMap((r) => r.schemas);
    expect(new Set(schemas).size).toBe(schemas.length);
    const current = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    expect(current.host.snapshot("timeline.received").map((e) => e.item.id)).toEqual(["task-service.received", "conversation.delegationAsk", "conversation.delegationResults"]);
    // v1.7: the artifact publish card (order 150) needs cutex `artifacts` (a new feature).
    expect(current.host.snapshot("timeline.tool").map((e) => e.item.id)).toEqual(["delegations.tool", "browser.tool", "artifacts.tool", "task-service.tool", "conversation.agentTools", "subagents.tool"]);
    for (const features of [[...MOCK_REMOTE, ...MOCK_BASE_FEATURES], null]) {
      const { host } = await gated(features);
      // Delegation ASK / results render by schema regardless of agent-asks (baseline, O6).
      expect(host.snapshot("timeline.received").map((e) => e.item.id)).toEqual(["task-service.received", "conversation.delegationAsk", "conversation.delegationResults"]);
      expect(host.snapshot("timeline.tool").map((e) => e.item.id)).toEqual(["browser.tool", "task-service.tool", "conversation.agentTools", "subagents.tool"]);
    }
    await current.host.setEnabled("delegations", false);
    await current.host.setEnabled("task-service", false);
    await current.host.setEnabled("subagents", false);
    await current.host.setEnabled("artifacts", false);
    expect(current.host.snapshot("timeline.received").map((e) => e.item.id)).toEqual(["conversation.delegationAsk", "conversation.delegationResults"]);
    // The core (required) cutex agent-tool line stays: the baseline formatted these rows unconditionally.
    await current.host.setEnabled("browser", false);
    expect(current.host.snapshot("timeline.tool").map((e) => e.item.id)).toEqual(["conversation.agentTools"]);
    expect(SLOT_SPECS["timeline.received"].unavailable).toBe("hide");
    expect(SLOT_SPECS["timeline.tool"].unavailable).toBe("hide");
  });

  it("code-block actions (v1.14, §22): ▶ 运行 from the terminal module, only with the host's terminal capability", async () => {
    const current = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    expect(current.host.snapshot("timeline.codeBlockAction").map((e) => [e.moduleId, e.item.id, e.mode])).toEqual([["terminal", "terminal.runCode", "show"]]);
    // Non-owner connections (no `terminal`) and capabilities still loading: no button at all (hide).
    expect((await gated([...MOCK_REMOTE])).host.snapshot("timeline.codeBlockAction")).toEqual([]);
    expect((await gated(null)).host.snapshot("timeline.codeBlockAction")).toEqual([]);
    await current.host.setEnabled("terminal", false);
    expect(current.host.snapshot("timeline.codeBlockAction")).toEqual([]);
    expect(SLOT_SPECS["timeline.codeBlockAction"].unavailable).toBe("hide");
  });

  it("cutex agent-tool lines keep the baseline taskToolRow format without agent-asks; only the delegate call is the gated card (M2)", async () => {
    const call = (tool: string, args: Record<string, unknown>) => ({ id: tool, type: "mcpToolCall", server: "cutex", tool, status: "completed", arguments: args });
    const lines = [
      call("agent_tell", { to: "Kimi", text: "fyi" }),
      call("alarm_set", { to: "Kimi", message: "check CI", at: "12:00" }),
      call("set_alarm", { to: "Kimi", message: "check CI" }),
      call("agent_create", { name: "worker" }),
      call("agent_archive", { agent: "cutex.worker" }),
      call("cutex_agent_management", { operation: "create", spec: { name: "worker" } }),
      call("read_overlength_content", { id: "doc-1" }),
      call("document_read", { document_id: "doc-1" }),
      call("delegation_wait", { delegations: ["d-1"] }),
      call("ask_close", { ask: "a-1", outcome: "stop" }),
      call("agent_reply", { ask: "a-1", text: "halfway" }),
    ];
    const delegate = { ...call("agent_delegate", { target: "Kimi", text: "Review" }), result: { structuredContent: { ok: true, delegation_id: "d-1" } } };
    const legacy = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES]);
    const waiting = await gated(null);
    const off = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    await off.host.setEnabled("delegations", false);
    for (const { host } of [legacy, waiting, off]) {
      const tools = host.snapshot("timeline.tool");
      for (const item of [...lines, delegate]) {
        expect(toolRendererFor(item, tools)?.item.id, item.tool).toBe("conversation.agentTools");
        expect(taskToolRow(item), item.tool).not.toBeNull();
      }
    }
    const current = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    const tools = current.host.snapshot("timeline.tool");
    for (const item of lines) expect(toolRendererFor(item, tools)?.item.id, item.tool).toBe("conversation.agentTools");
    expect(toolRendererFor(delegate, tools)?.item).toMatchObject({ id: "delegations.tool" });
    expect(toolRendererFor(delegate, tools)?.item.standalone?.(delegate)).toBe(true);
  });

  it("the core modules are locked", () => {
    expect(MODULES.filter((m) => m.required).map((m) => m.id)).toEqual(["shell", "conversation", "connection", "agent-config", "notifications"]);
  });
});

describe("module i18n", () => {
  it("every dictionary uses its prefix, has en for every key, and no key is defined twice", () => {
    const counts = new Map<string, number>();
    for (const [prefix, dict] of Object.entries(MODULE_DICTIONARIES)) {
      expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.zhCN).sort());
      for (const key of Object.keys(dict.zhCN)) {
        expect(key.startsWith(`${prefix}.`), key).toBe(true);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (const [key, n] of counts) expect(n, key).toBe(1);
    // A module key must not shadow (or be shadowed by) a key written in the base catalogs.
    const base = readFileSync(join(SRC, "i18n/zh-CN.ts"), "utf8") + readFileSync(join(SRC, "i18n/en.ts"), "utf8");
    for (const key of counts.keys()) expect(base.includes(`"${key}":`), key).toBe(false);
  });

  it("the glob collected every module directory's i18n.ts, and each one merges its keys into MessageKey", () => {
    const dirs = readdirSync(MODULES_DIR).filter((n) => statSync(join(MODULES_DIR, n)).isDirectory());
    const withI18n = dirs.filter((d) => statSync(join(MODULES_DIR, d)).isDirectory() && readdirSync(join(MODULES_DIR, d)).includes("i18n.ts"));
    expect(withI18n.sort()).toEqual(dirs.sort());
    expect(Object.keys(MODULE_DICTIONARIES).sort()).toEqual(["modules", ...dirs].sort());
    for (const m of MODULES) expect(MODULE_DICTIONARIES[m.id], m.id).toBeTruthy();
    for (const d of dirs) {
      const code = readFileSync(join(MODULES_DIR, d, "i18n.ts"), "utf8");
      expect(code, d).toMatch(/declare module "\.\.\/i18nCatalog" \{\s*interface ModuleMessages extends Messages \{\}\s*\}\s*type Messages = typeof zhCN;/);
    }
    // Every module key reached the merged catalogs.
    for (const dict of Object.values(MODULE_DICTIONARIES)) {
      for (const key of Object.keys(dict.zhCN)) {
        expect((zhCN as Record<string, string>)[key], key).toBe(dict.zhCN[key]);
        expect((en as Record<string, string>)[key], key).toBe(dict.en[key]);
      }
    }
  });

  it("module titles resolve in both locales", () => {
    for (const m of MODULES) {
      expect(zhCN[m.titleKey]).toBeTruthy();
      expect(en[m.titleKey]).toBeTruthy();
    }
  });
});

describe("module import boundaries", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
  const moduleDirs = readdirSync(MODULES_DIR).filter((n) => statSync(join(MODULES_DIR, n)).isDirectory());
  const imports = (file: string) => [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);

  it("a module does not import another module's directory", () => {
    for (const dir of moduleDirs) {
      for (const file of files(join(MODULES_DIR, dir))) {
        for (const spec of imports(file)) {
          const other = moduleDirs.find((d) => d !== dir && (spec.startsWith(`../${d}/`) || spec === `../${d}`));
          expect(other, `${relative(SRC, file)} imports ${spec}`).toBeUndefined();
        }
      }
    }
  });

  it("the status shell (capsule, status row, placement table) names no feature (迁完, §9)", () => {
    // v1.2: the capsule moved into its module (modules/status-capsule) and still names no status feature.
    for (const rel of ["modules/status-capsule/StatusCapsule.tsx", "components/StatusBar.tsx", "components/settings/StatusPlaceTable.tsx", "lib/statusItems.ts", "lib/statusSurfaces.ts", "lib/statusItemsView.ts", "modules/ConversationOverlays.tsx"]) {
      const code = readFileSync(join(SRC, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code.match(/goal|plan\b|plan\.|terminal|subagent|delegation|\bjobs?\b|features\.has|_FEATURE/gi), rel).toBeNull();
    }
  });

  it("the page / nav shell (App, Sidebar, PageTitle) names no feature (迁完, §9 step 3)", () => {
    for (const rel of ["App.tsx", "components/Sidebar.tsx", "components/PageTitle.tsx"]) {
      const code = readFileSync(join(SRC, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\/.*$/gm, "");
      expect(
        code.match(/features\.has|_FEATURE|\bopen(Tasks|Jobs|Projects|Services|Approvals|NewAgent|Task)\b|closeSettings|view\.kind === "(?!conversation|page)|delegation|approval|\bservices?\.(?!ui)|\bjobs?\b|\btasks?\b|pendingChat|newAgent|newChat|quickChat|SettingsNav|\bSettings\b|(Projects|Tasks|Jobs|Services|Approvals|NewAgent|TaskDetail)Page|PendingChat/g),
        rel,
      ).toBeNull();
    }
  });

  it("the right-side shell (components/side, lib/side*) names no feature (v1.4, §18)", () => {
    // lib/sideKinds.ts + lib/sideOpen.ts are the documented core openers of well-known components
    // (file links, git chip, sub-agent chips): they name component ids on purpose, nothing else may.
    const sideFiles = [
      ...readdirSync(join(SRC, "components/side")).map((n) => `components/side/${n}`),
      ...readdirSync(join(SRC, "lib"))
        .filter((n) => /^side[A-Z].*\.tsx?$/.test(n) && n !== "sideKinds.ts" && n !== "sideOpen.ts")
        .map((n) => `lib/${n}`),
      "lib/useSideShortcuts.ts",
      "components/settings/SidesSettings.tsx",
      // §19 hosts: the gutters, the reference card, refs, jump-and-back.
      ...readdirSync(join(SRC, "components/gutter")).map((n) => `components/gutter/${n}`),
      ...["gutterLayout.ts", "gutterStore.ts", "gutterItems.ts", "peekStore.ts", "peekBody.ts", "peekTarget.ts", "marginStack.ts", "escChain.ts", "escLayers.ts", "jump.ts", "returnPoint.ts", "turnFetch.ts", "refServices.ts"].map((n) => `lib/${n}`),
    ];
    expect(sideFiles.length).toBeGreaterThan(25);
    for (const rel of sideFiles) {
      const code = readFileSync(join(SRC, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code.match(/goal|\bplan\b|terminal|subagent|delegation|\bjobs?\b|features\.has|_FEATURE\b|_COMPONENT\b|workspace\.|diff\.view/gi), rel).toBeNull();
    }
  });

  it("title-bar launchers (v1.11, §18.3): side chat, terminal and the browser (on by default since 2026-10-15) pinned by default; nothing of the browser once its module is off", async () => {
    const all = [...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES];
    const pinnedNow = (host: Awaited<ReturnType<typeof gated>>["host"]) =>
      host
        .snapshot("side.component")
        .filter((e) => e.mode === "show" && e.item.launcher?.pin === "default")
        .map((e) => e.item.id)
        .sort();
    const { host } = await gated(all);
    expect(pinnedNow(host)).toEqual(["browser.tab", "side-chat.chat", "terminal.pty"]);
    await host.setEnabled("browser", false);
    await host.idle();
    expect(pinnedNow(host)).toEqual(["side-chat.chat", "terminal.pty"]);
    // Without the capabilities their modules need, nothing of theirs is offered (the browser module
    // has no capability gate; its agent features check browser-relay-v1 themselves).
    expect(pinnedNow((await gated([])).host)).toEqual(["browser.tab"]);
    // No component asks for the old app-internal title-bar button any more.
    for (const m of MODULES) for (const item of (m.contributes?.["side.component"] ?? []) as readonly { id: string; launcher?: object }[]) expect(item.launcher && "button" in item.launcher, item.id).toBeFalsy();
  });

  it("keepMounted (v1.9, §18.13) / openHeld (v1.10, §18.14) are only called by modules with a keepAlive \"hidden\" component", () => {
    // The shell refuses a hold from any other component (lib/sideKeep applyHold / admitHold); this keeps callers honest.
    const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const callers = moduleDirs.flatMap((d) => files(join(MODULES_DIR, d))).filter((f) => /\b(?:keepMounted|openHeld)\(/.test(strip(readFileSync(f, "utf8"))));
    for (const file of callers) {
      const dir = relative(MODULES_DIR, file).split(/[\\/]/)[0]!;
      const code = files(join(MODULES_DIR, dir)).map((f) => readFileSync(f, "utf8")).join("\n");
      expect(code.includes('keepAlive: "hidden"'), file).toBe(true);
    }
    // The shell files that build SideBodyProps provide the hook.
    for (const rel of ["lib/sideBody.ts", "lib/peekBody.ts"]) expect(readFileSync(join(SRC, rel), "utf8"), rel).toMatch(/keepMounted:/);
  });

  it("the cutex: link host (Markdown, lib/cutexLinks, components/CutexLink) names no module or kind (v1.7, §19.6)", () => {
    for (const rel of ["components/Markdown.tsx", "components/CutexLink.tsx", "lib/cutexLinks.ts"]) {
      const code = readFileSync(join(SRC, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code.match(/artifact|modules\/(?!app|react|slots)|_COMPONENT\b/gi), rel).toBeNull();
    }
  });

  it("side components: ids unique next to the status categories' (status:<id>), placements valid", async () => {
    for (const features of [[...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES], [...MOCK_BASE_FEATURES]]) {
      const { host } = await gated(features);
      const side = host.snapshot("side.component");
      const ids = [...side.map((e) => e.item.id), ...host.snapshot("conversation.status").map((e) => `status:${e.item.id}`)];
      expect(new Set(ids).size).toBe(ids.length);
      for (const e of side) {
        expect(e.item.placement.home, e.item.id).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(e.item.id.startsWith(`${e.moduleId}.`), e.item.id).toBe(true);
        expect(zhCN[e.item.titleKey as keyof typeof zhCN], e.item.titleKey).toBeTruthy();
      }
    }
    const { host } = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    expect(
      host
        .snapshot("side.component")
        .map((e) => `${e.item.id} (${e.mode})`)
        .sort(),
    ).toEqual(["artifacts.library (show)", "artifacts.view (show)", "bookmarks.list (show)", "browser.tab (show)", "conversation.turnPeek (show)", "delegations.detail (show)", "diff.view (show)", "notes.list (show)", "notes.note (show)", "side-chat.chat (show)", "subagents.thread (show)", "terminal.pty (show)", "workspace.changes (show)", "workspace.files (show)", "workspace.preview (show)"]);
    // A referable component (toRef) needs an id refs accept as a kind (lowercase, §19.6).
    const referable = host.snapshot("side.component").filter((e) => e.item.toRef);
    expect(referable.length).toBeGreaterThan(0);
    // (The core turn reference is the exception: its refs are `turn` refs, lib/refServices.ts instanceRef.)
    for (const e of referable) if (e.item.id !== "conversation.turnPeek") expect(e.item.id, e.item.id).toMatch(/^[a-z][a-z0-9.:-]{0,99}$/);
  });

  it("received/tool outlets and work-group rendering dispatch without feature-specific branches", () => {
    for (const rel of ["modules/TimelineOutlet.tsx", "modules/TimelineRowFallback.tsx", "modules/timelineFallback.ts", "modules/timelineItemsView.ts", "lib/receivedRows.ts", "lib/timelineRenderers.ts", "components/WorkGroup.tsx"]) {
      const code = readFileSync(join(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code.match(/features\.has|_FEATURE\b|delegation|taskToolRow|taskDeliveryRow|collabAgentToolCall|CollabRow|TaskToolRow/g), rel).toBeNull();
    }
  });

  it("shell code reaches modules only through the host files (no modules/<id>/, no registry)", () => {
    const shellFiles = files(SRC).filter((f) => !f.startsWith(MODULES_DIR) && !f.endsWith("main.tsx"));
    for (const file of shellFiles) {
      for (const spec of imports(file)) {
        if (!spec.includes("modules/")) continue;
        const target = spec.replace(/^.*modules\//, "");
        // The fixed v1 contract has no plan/checklist slot. This one facade keeps its single
        // module-owned implementation reachable for those existing core TimelineEntry kinds.
        if (relative(SRC, file).replaceAll("\\", "/") === "components/PlanCard.tsx" && target === "plan/PlanCard") continue;
        expect(target.includes("/") || target === "registry", `${relative(SRC, file)} imports ${spec}`).toBe(false);
      }
    }
  });
});

describe("module gating snapshot (mock featureLists)", () => {
  // = the target nav of docs/research/settings-design-review-20261009.md §2 (batch 1, 2026-10-09):
  // 应用 · 连接 · Agent · 工具 · 数据 · 系统.
  const ALL_PAGES = [
    "shell.general",
    "shell.appearance",
    "conversation.settings",
    "shell.sidebar",
    "shell.sides",
    "shell.status",
    "notifications.settings",
    "shell.me",
    "connection.hosts",
    "shell.users",
    "remote-access.page",
    "peers.page",
    "agent-config.profiles",
    "agent-config.defaults",
    "agent-config.instructions",
    "agent-config.collab",
    "shell.runtime",
    "browser.settings",
    "codex-config.plugins",
    "codex-config.mcp",
    "codex-config.skills",
    "codex-config.hooks",
    "usage.settings",
    "archive.settings",
    "shell.modules",
    "shell.shortcuts",
    "backend-upgrade.page",
    "updater.page",
    "shell.about",
  ];
  // 互联 (module peers) is its own page right after 接入 (settings audit 2026-10-15) and needs peers-v2. 用户 is
  // the shell's; its management is the users module's section. NCI 远程作业 (module nci) is off by default.
  // 后端更新 (backend-upgrade, in 系统 right before 更新与诊断 since 2026-10-15) needs its capability.
  const BASE_PAGES = ALL_PAGES.filter((p) => p !== "backend-upgrade.page" && p !== "peers.page");

  // Status categories (step 2): 目标 / 计划 / 后台终端 / 子 agent / 委托 / 作业, in this order.
  const BASE_STATUS = ["goal.status", "plan.status", "background-terminals.status", "subagents.status"];

  // Sidebar entries (step 3), top list in order; the footer has ⚙ 设置.
  const ALL_NAV = ["quick-chats.nav", "agent-config.newAgent", "projects.nav", "services.nav", "delegations.nav", "jobs.nav", "approvals.nav"];
  const ALL_MAIN = ["shell.settings", "agent-config.newAgent", "delegations.page", "jobs.page", "quick-chats.draft", "projects.page", "services.page", "approvals.page"];

  it("new cutex: every sidebar entry and page", async () => {
    const { navTop, navFooter, mainPages } = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    expect(navTop).toEqual(ALL_NAV);
    expect(navFooter).toEqual(["shell.settings"]);
    expect(mainPages).toEqual(ALL_MAIN);
  });

  it("?legacy: 新工作 / 委托 / 审批 greyed (never shift), 作业 hidden (host-specific); their pages gone", async () => {
    const { navTop, navFooter, mainPages } = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES]);
    expect(navTop).toEqual([
      "quick-chats.nav (disable: human-create-session)",
      "agent-config.newAgent",
      "projects.nav",
      "services.nav",
      "delegations.nav (disable: agent-asks)",
      "approvals.nav (disable: owner-approvals)",
    ]);
    expect(navFooter).toEqual(["shell.settings"]);
    expect(mainPages).toEqual(["shell.settings", "agent-config.newAgent", "projects.page", "services.page"]);
  });

  it("before capabilities load: capability entries greyed and waiting, 作业 not shown yet", async () => {
    const { navTop, mainPages } = await gated(null);
    expect(navTop).toEqual([
      "quick-chats.nav (disable, waiting: human-create-session)",
      "agent-config.newAgent (disable, waiting: human-create-agent)",
      "projects.nav",
      "services.nav (disable, waiting: services)",
      "delegations.nav (disable, waiting: agent-asks)",
      "approvals.nav (disable, waiting: owner-approvals)",
    ]);
    expect(mainPages).toEqual(["shell.settings", "agent-config.newAgent", "projects.page"]);
  });

  it("a module turned off takes its entry and page with it", async () => {
    const { host } = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    await host.setEnabled("projects", false);
    expect(host.snapshot("nav.primary").map((e) => e.item.id)).not.toContain("projects.nav");
    expect(host.snapshot("main.page").map((e) => e.item.id)).not.toContain("projects.page");
  });

  it("NCI 远程作业: default off; once on, its page under 工具 (inbound-mail), never without the capability", async () => {
    const { host } = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    expect(host.statuses().get("nci")!.state.kind).toBe("disabled");
    expect(host.snapshot("settings.page").some((e) => e.moduleId === "nci")).toBe(false);
    await host.setEnabled("nci", true);
    expect(host.snapshot("settings.page").filter((e) => e.moduleId === "nci").map((e) => [e.item.id, e.item.page, e.item.group, e.mode])).toEqual([["nci.settings", "nci", "tools", "show"]]);
    const legacy = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES]);
    await legacy.host.setEnabled("nci", true);
    expect(legacy.host.snapshot("settings.page").some((e) => e.moduleId === "nci")).toBe(false);
  });

  it("header links point at pages that exist (运行时 → 后端更新, 后端更新 ↔ 更新与诊断)", () => {
    const items = MODULES.flatMap((m) => m.contributes?.["settings.page"] ?? []);
    const linked = items.filter((i) => i.headerLink).map((i) => [i.page, i.headerLink!.page]);
    expect(linked.sort()).toEqual([["backend", "updates"], ["runtime", "backend"], ["updates", "backend"]]);
    for (const [, target] of linked) expect(items.some((i) => i.page === target)).toBe(true);
  });

  it("new cutex: every page and section", async () => {
    const { pages, sections, status } = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    // Claude 账户 is a section of Profile, not a page (owner 2026-10-10): the same pages as ?legacy.
    expect(pages).toEqual(ALL_PAGES);
    // 更新与诊断 on 通用; the capsule's own settings on 状态显示 (v1.2); 远程访问's three sections; Claude 账户 after the
    // Profile list (claude-accounts); on 协作 轮换主管 (owner-rotation), 服务 (services-persistent-approval), 消息投递
    // and the 高级 card (消息总线 + 卡住的消息 with agent-bus-stuck-messages) last — page order is by `order`.
    expect(sections).toEqual(["notes.settings", "side-chat.settings", "artifacts.settings", "bookmarks.settings", "status-capsule.settings", "owner-notify.settings", "users.manage", "remote-access.listen", "remote-access.cors", "remote-access.pairing", "claude-accounts.accounts", "projects.rotation.settings", "services.persistApproval.settings", "agent-bus.delivery", "agent-bus.advanced", "runtime-packages.settings", "runtimes.installed"]);
    expect(status).toEqual([...BASE_STATUS, "delegations.status", "jobs.status", "alarms.status"]);
  });

  it("?legacy: same pages but 跨主机; owner-notify / runtime packages / CORS hidden; listen + pairing + installed runtimes say 需要升级; no 委托 / 作业", async () => {
    const { host, pages, sections, status } = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES]);
    expect(pages).toEqual(BASE_PAGES);
    expect(sections).toEqual(["bookmarks.settings", "status-capsule.settings", "remote-access.listen (notice: listen-settings)", "remote-access.pairing (notice: device-pairing)", "agent-bus.delivery", "agent-bus.advanced", "runtimes.installed (notice: runtimes-view)"]);
    expect(status).toEqual(BASE_STATUS);
    expect(host.statuses().get("owner-notify")!.state).toEqual({ kind: "unavailable", missing: { capabilities: ["owner-messages"], modules: [], hostKind: false, waiting: false } });
    expect(host.statuses().get("runtime-packages")!.state.kind).toBe("unavailable");
    expect(host.statuses().get("claude-accounts")!.state).toMatchObject({ kind: "unavailable", missing: { capabilities: ["claude-accounts"] } });
    expect(host.statuses().get("delegations")!.state).toMatchObject({ kind: "unavailable", missing: { capabilities: ["agent-asks"] } });
    expect(host.statuses().get("jobs")!.state).toMatchObject({ kind: "unavailable", missing: { capabilities: ["job-service"] } });
  });

  it("before capabilities load: capability modules wait, notices are flagged waiting", async () => {
    const { host, pages, sections, status } = await gated(null);
    expect(pages).toEqual(BASE_PAGES);
    expect(sections).toEqual(["bookmarks.settings", "status-capsule.settings", "remote-access.listen (notice, waiting: listen-settings)", "remote-access.pairing (notice, waiting: device-pairing)", "agent-bus.delivery", "agent-bus.advanced", "runtimes.installed (notice, waiting: runtimes-view)"]);
    expect(status).toEqual(BASE_STATUS);
    expect(host.statuses().get("owner-notify")!.state).toMatchObject({ kind: "unavailable", missing: { waiting: true } });
  });

  it("status placement: defaults (目标 in the bar, the rest in the capsule) and a module turned off leaves the slot", async () => {
    const { host } = await gated([...MOCK_REMOTE, ...MOCK_BASE_FEATURES, ...MOCK_NEW_FEATURES]);
    expect(host.snapshot("conversation.status").map((e) => `${e.item.id}:${host.placement("conversation.status", e.item)}`)).toEqual([
      "goal.status:bar",
      "plan.status:capsule",
      "background-terminals.status:capsule",
      "subagents.status:capsule",
      "delegations.status:capsule",
      "jobs.status:capsule",
      "alarms.status:capsule",
    ]);
    await host.setEnabled("plan", false);
    expect(host.snapshot("conversation.status").map((e) => e.item.id)).not.toContain("plan.status");
  });
});
