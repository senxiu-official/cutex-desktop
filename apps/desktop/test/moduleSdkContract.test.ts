// Compile-time checks are also included by tsconfig.web.json. These protect the stable
// baseline's page/timeline shapes when the engine and renderer evolve separately.
import { expect, expectTypeOf, it } from "vitest";
import { SLOT_SPECS } from "../src/renderer/src/modules/slots";
import type * as SDK from "@cutex-desktop/plugin-sdk";
import type { MessageKey } from "../src/renderer/src/i18n";
import type { AppModule, AppModuleContext, AppModuleHost, ModuleServices, SideBodyProps, SlotMap } from "../src/renderer/src/modules/slots";
import type { HostInput, ModuleContext, ModuleDefinition, ModuleHost, PageParams } from "../src/renderer/src/modules/types";

it("uses the SDK as the one definition of neutral contracts", () => {
  expectTypeOf<HostInput>().toEqualTypeOf<SDK.ModuleHostTarget>();
  expectTypeOf<PageParams>().toEqualTypeOf<SDK.PageParams>();
  expectTypeOf<AppModule>().toEqualTypeOf<SDK.ModuleDefinition<SlotMap, ModuleServices, MessageKey>>();
  expectTypeOf<AppModuleContext>().toEqualTypeOf<SDK.ModuleContext<SlotMap, ModuleServices, MessageKey>>();
  expectTypeOf<AppModuleHost>().toEqualTypeOf<SDK.ModuleHost<SlotMap, ModuleServices, MessageKey>>();
  expectTypeOf<ModuleDefinition<SlotMap>>().toEqualTypeOf<SDK.ModuleDefinition<SlotMap>>();
  expectTypeOf<ModuleContext<SlotMap>>().toEqualTypeOf<SDK.ModuleContext<SlotMap>>();
  expectTypeOf<ModuleHost<SlotMap>>().toEqualTypeOf<SDK.ModuleHost<SlotMap>>();
});

// v1.15 (§12.1): a module names the optional cutex component its pages need; the engine does not gate on it.
export const componentRequiresProbe: AppModule = { id: "probe", titleKey: "jobs.title", requires: { capabilities: ["job-service"], component: "job-service" } };
// @ts-expect-error A component is one name, not a list.
export const componentRequiresListProbe: AppModule = { id: "probe", titleKey: "jobs.title", requires: { component: ["job-service"] } };

// v1.16 (§23): a signed pack's entry exports the range, an ordinary definition and its own messages.
export const packEntryProbe: SDK.ModulePackEntry<SlotMap, ModuleServices, MessageKey> = { moduleApi: "^1.16", module: componentRequiresProbe, messages: { en: { "probe.title": "Probe" } } };
// @ts-expect-error A pack entry must say which MODULE_API_VERSION range it was built for.
export const packEntryNoRangeProbe: SDK.ModulePackEntry<SlotMap, ModuleServices, MessageKey> = { module: componentRequiresProbe };
it("v1.16 pack ranges: ^ / ~ / comparator sets, and which side must update", async () => {
  const { moduleApiSatisfies, moduleApiVerdict, MODULE_API_VERSION, MODULE_PACK_HOST_GLOBAL } = await import("@cutex-desktop/plugin-sdk");
  expect(MODULE_API_VERSION).toBe("1.16");
  expect(MODULE_PACK_HOST_GLOBAL).toBe("__CUTEX_MODULE_HOST__");
  expect(moduleApiSatisfies(`^${MODULE_API_VERSION}`, MODULE_API_VERSION)).toBe(true);
  expect(moduleApiVerdict("^1.17", MODULE_API_VERSION)).toBe("needsNewerApp");
  expect(moduleApiVerdict("~1.15", MODULE_API_VERSION)).toBe("needsNewerModule");
});

function compileContract(ctx: AppModuleContext) {
  ctx.contribute("main.page", { id: "probe.page", Page: () => null, useTitle: () => [] });
  ctx.contribute("timeline.received", { id: "probe.received", schemas: ["probe.v1"], Row: () => null });
  ctx.contribute("timeline.tool", { id: "probe.tool", match: () => true, Row: () => null });
  ctx.services.ui.openPage("probe.page", { mode: "compact" });
  ctx.services.ui.closePage();
  // @ts-expect-error Page params remain string-only, even though the host is slot-generic.
  ctx.services.ui.openPage("probe.page", { count: 4 });
  // @ts-expect-error A page must provide its breadcrumb hook.
  ctx.contribute("main.page", { id: "probe.page", Page: () => null });
  // @ts-expect-error A received renderer dispatches by schemas, not a tool predicate.
  ctx.contribute("timeline.received", { id: "probe.received", match: () => true, Row: () => null });
  // @ts-expect-error Slot names are the application's exact closed map.
  ctx.contribute("arbitrary.slot", { id: "probe.item" });
  // @ts-expect-error SDK generics must preserve the application's exact translation keys.
  ctx.t("nonexistent-sdk-translation");
  // v1.2: fixed surface ids only; overlays report their space.
  ctx.contribute("conversation.statusSurface", { id: "probe.surface", surface: "capsule", intents: ["view"] });
  // @ts-expect-error No arbitrary status surface ids (no general layout system).
  ctx.contribute("conversation.statusSurface", { id: "probe.surface", surface: "sidebar", intents: ["view"] });
  ctx.contribute("conversation.overlay", { id: "probe.overlay", Overlay: ({ reserve }) => (reserve({ anchor: "top", overColumn: true }), null) });
  // v1.4 (§18): right-side components with declared placement.
  const side = {
    id: "probe.side",
    titleKey: "side.column",
    icon: () => null,
    instances: "multi",
    defaultBinding: "agent",
    placement: { home: "workspace", prefer: [{ containing: "probe.other" }, { group: "workspace" }, "active"], otherwise: "active-page", order: 300, share: 0.3 },
    parseParams: (p: SDK.Json) => (typeof p === "string" ? { path: p } : null),
    dedupeKey: (p: { path: string }) => p.path,
    init: (p: { path: string }) => ({ path: p.path }),
    useTab: ({ instance }: { instance: { state: { path: string } } }) => ({ title: instance.state.path }),
    Body: () => null,
  } as const;
  ctx.contribute("side.component", side);
  ctx.services.side.open("probe.side", "a.ts", { target: "maximised", pin: true });
  ctx.services.side.reveal({ instanceId: "i1" });
  // v1.9 (§18.13): a keepAlive "hidden" component holds its instance mounted while something live needs it.
  const HoldingBody = ({ keepMounted, held }: SideBodyProps<{ path: string }>) => {
    const accepted: boolean = keepMounted(true);
    const isHeld: boolean = held;
    void [accepted, isHeld, keepMounted(false)];
    // @ts-expect-error keepMounted takes hold / release, not a predicate.
    keepMounted(() => true);
    return null;
  };
  ctx.contribute("side.component", { ...side, keepAlive: "hidden", Body: HoldingBody });
  expectTypeOf<SideBodyProps<null>["keepMounted"]>().toEqualTypeOf<(hold: boolean) => boolean>();
  expectTypeOf<SideBodyProps<null>["held"]>().toEqualTypeOf<boolean>();
  // v1.11 (§18.2): a preview promotes itself to a kept tab once it holds work.
  expectTypeOf<SideBodyProps<null>["keep"]>().toEqualTypeOf<() => void>();
  // v1.10 (§18.14): a background card created and held in one call; the locator only drops that pre-hold.
  const bg = ctx.services.side.openHeld("probe.side", "a.ts", { binding: { kind: "agent", hostId: "local", sessionId: "s2" }, hostEpoch: "e1" });
  if (bg.status === "opened") {
    const released: boolean = ctx.services.side.releaseHold(bg.hold, { discard: true });
    void [released, ctx.services.side.releaseHold(bg.hold)];
  } else if (bg.status === "unavailable") {
    const code: "hold-limit" | "not-holdable" | "scope-invalid" | "scope-unsupported" | "module-off" | "host-offline" | "unknown-kind" | "capability" | "agent-feature" | "bad-params" | "no-agent" = bg.reason;
    void code;
  }
  // v1.11 (§18.3): launchers pin to the title bar by default or never; multi kinds may give new-instance params.
  ctx.contribute("side.component", { ...side, launcher: { order: 100, pin: "default", params: () => "a.ts", newParams: () => "b.ts" } });
  ctx.contribute("side.component", { ...side, launcher: { order: 100, pin: "never", params: () => null } });
  ctx.contribute("side.component", { ...side, launcher: { order: 100, params: () => "a.ts" } });
  // @ts-expect-error Pinning is "default" or "never" (omitted = not pinned until the owner pins it).
  ctx.contribute("side.component", { ...side, launcher: { order: 100, pin: "always", params: () => null } });
  // @ts-expect-error v1.11 replaced the app-internal launcher.button with launcher.pin.
  ctx.contribute("side.component", { ...side, launcher: { order: 100, button: true, params: () => null } });
  // v1.11 (§18.8): a background open keeps the card's shown tab (Ctrl/⌘ + click).
  ctx.services.side.open("probe.side", "b.ts", { pin: true, background: true });
  // @ts-expect-error openHeld never reveals or focuses: those options do not exist on it.
  ctx.services.side.openHeld("probe.side", "a.ts", { reveal: true });
  // @ts-expect-error A plain open has no hold option (v1.10 uses openHeld).
  ctx.services.side.open("probe.side", "a.ts", { hold: true });
  void ctx.services.side.close("i1");
  ctx.services.side.closePeek();
  ctx.services.side.list("probe.side");
  void ctx.services.timeline.focusTurn("local", "s1", "t1");
  void ctx.services.refs.open({ hostId: "local", kind: "turn", key: "k", title: "t", params: {} }, { how: "peek" });
  ctx.services.refs.parse({});
  ctx.services.refs.here();
  // @ts-expect-error A side component must declare its placement.
  ctx.contribute("side.component", { ...side, placement: undefined });
  // @ts-expect-error A side component must have a Body.
  ctx.contribute("side.component", { ...side, Body: undefined });
  // @ts-expect-error Params from other modules are validated: parseParams is required.
  ctx.contribute("side.component", { ...side, parseParams: undefined });
  // @ts-expect-error The right side has no "left" fallback (the gutter is §19).
  ctx.contribute("side.component", { ...side, placement: { home: "workspace", otherwise: "left" } });
  // @ts-expect-error v3 removed placement.stack (one kind per card).
  ctx.contribute("side.component", { ...side, placement: { home: "workspace", stack: "own" } });
  // v1.4 (§19): two sides and refs (declared; hosts pending).
  ctx.contribute("conversation.gutter", { id: "probe.gutter", side: "left", order: 1, titleKey: "side.column", icon: () => null, Body: () => null, dockMinWidth: 320 });
  // v1.8: stable top entry (full-width/narrow layouts keep it out of the composer).
  ctx.contribute("conversation.gutter", { id: "probe.top", side: "left", anchor: "top", order: 1, titleKey: "side.column", icon: () => null });
  // @ts-expect-error Only top and composer are supported trigger anchors.
  ctx.contribute("conversation.gutter", { id: "probe.top", side: "left", anchor: "bottom", order: 1, titleKey: "side.column", icon: () => null });
  // @ts-expect-error Gutters are left / right only.
  ctx.contribute("conversation.gutter", { id: "probe.gutter", side: "top", order: 1, titleKey: "side.column", icon: () => null });
  ctx.contribute("timeline.turnAttachment", { id: "probe.attach", margin: { side: "right", minWidth: 200 }, Attachment: () => null });
  ctx.contribute("ref.action", { id: "probe.action", kinds: ["turn"], icon: () => null, titleKey: "side.column", run: () => {} });
  // @ts-expect-error A ref action must run.
  ctx.contribute("ref.action", { id: "probe.action", icon: () => null, titleKey: "side.column" });
  ctx.contribute("ref.target", { id: "probe.target", kind: "probe.note", role: "content", open: () => ({ status: "opened", where: "card" }) });
  // @ts-expect-error A ref target names its kind.
  ctx.contribute("ref.target", { id: "probe.target", role: "content", open: () => ({ status: "opened", where: "card" }) });
  // v1.7 (§19.6): `cutex:<kind>/<key>` link chips and image thumbnails come from the kind's provider.
  ctx.contribute("ref.target", {
    id: "probe.target",
    kind: "probe.note",
    role: "content",
    open: () => ({ status: "opened", where: "card" }),
    useLink: (ref) => ({ tooltip: ref.title, badge: "v2", tone: "warn", icon: () => null }),
    thumbnail: async (_ref, maxBytes) => ({ mime: "image/png", encoding: "base64", content: "", size: Math.min(1, maxBytes), truncated: false }),
  });
  // @ts-expect-error A chip's tone is one of the three.
  ctx.contribute("ref.target", { id: "probe.target", kind: "probe.note", role: "content", open: () => ({ status: "opened", where: "card" }), useLink: () => ({ tone: "loud" }) });
  // StatusItem v1.4 fields: an icon and the right-side component adapter.
  ctx.contribute("conversation.status", { id: "probe.status", titleKey: "side.column", defaultPlace: "capsule", useStatus: () => null, Body: () => null, icon: () => null, side: { order: 650 } });
  // v1.6 (§20): an action beside a module-owned profile field.
  ctx.contribute("profile.fieldAction", { id: "probe.fieldAction", field: "claudeAccount", Action: ({ pick }) => (void pick("ca-probe"), null) });
  // @ts-expect-error Only fields of both the profile PATCH and the create body.
  ctx.contribute("profile.fieldAction", { id: "probe.fieldAction", field: "apiKey", Action: () => null });
  // v1.12 (§21): a tab of the 项目 page, with an optional count phrase for the overview.
  ctx.contribute("project.tab", { id: "probe.projectTab", tab: "probe", order: 350, titleKey: "side.column", Body: ({ hostId, projectId }) => (hostId && projectId ? null : null), useSummary: ({ projectId }) => projectId });
  // @ts-expect-error A project tab needs its deep-link name.
  ctx.contribute("project.tab", { id: "probe.projectTab", order: 350, titleKey: "side.column", Body: () => null });
  // v1.13 (§19.3): the session's opening above its first turn (read-only props, one per session).
  ctx.contribute("timeline.intro", { id: "probe.intro", order: 100, when: (p) => !!p.agentName, render: (p) => (p.sessionId ? null : null) });
  // @ts-expect-error An intro item must render.
  ctx.contribute("timeline.intro", { id: "probe.intro", render: undefined });
  // v1.14 (§22): an action in a reply's code-block toolbar, picked per block by a pure match.
  ctx.contribute("timeline.codeBlockAction", { id: "probe.codeRun", order: 100, match: ({ language, platform, hostId }) => language === "bash" && platform !== "windows" && !!hostId, Action: ({ code, sessionId, incomplete }) => (code && sessionId && !incomplete ? null : null) });
  // @ts-expect-error A code-block action needs its match.
  ctx.contribute("timeline.codeBlockAction", { id: "probe.codeRun", Action: () => null });
  // @ts-expect-error The platform is the host list's HostPlatform, not a Node platform name.
  ctx.contribute("timeline.codeBlockAction", { id: "probe.codeRun", match: ({ platform }) => platform === "win32", Action: () => null });
}

void compileContract;


it("pins the declared slot defaults and placement choices", () => {
  expect(Object.fromEntries(Object.entries(SLOT_SPECS).map(([slot, spec]) => [slot, {
    unavailable: spec.unavailable,
    ...(spec.placement ? { placement: { values: spec.placement.values, default: spec.placement.default({ id: "probe.item", defaultPlace: "bar" } as SDK.SlotItemBase) } } : {}),
  }]))).toEqual({
    "settings.page": { unavailable: "hide" },
    "settings.section": { unavailable: "hide" },
    // Renderer-internal (not in the SDK): 在主界面调整 panels.
    "customize.region": { unavailable: "hide" },
    "conversation.status": { unavailable: "hide", placement: { values: ["bar", "capsule", "both", "off"], default: "bar" } },
    // v1.2 (§16): status surface providers and the trusted conversation overlay.
    "conversation.statusSurface": { unavailable: "hide" },
    "conversation.overlay": { unavailable: "hide" },
    "nav.primary": { unavailable: "disable" },
    "main.page": { unavailable: "hide" },
    "timeline.received": { unavailable: "hide" },
    "timeline.tool": { unavailable: "hide" },
    // v1.3 (§17): device-side notification methods.
    "notify.method": { unavailable: "hide" },
    // v1.4 (§18, §19): the right side, the two gutters, turn attachments, refs.
    "side.component": { unavailable: "hide" },
    "conversation.gutter": { unavailable: "hide" },
    "timeline.turnAttachment": { unavailable: "hide" },
    "ref.action": { unavailable: "hide" },
    "ref.target": { unavailable: "hide" },
    // v1.6 (§20): actions beside module-owned profile fields.
    "profile.fieldAction": { unavailable: "hide" },
    // v1.12 (§21): tabs of the 项目 page.
    "project.tab": { unavailable: "hide" },
    // v1.13 (§19.3): the session's opening above its first turn.
    "timeline.intro": { unavailable: "hide" },
    // v1.14 (§22): actions in a reply's code-block toolbar.
    "timeline.codeBlockAction": { unavailable: "hide" },
  });
});
