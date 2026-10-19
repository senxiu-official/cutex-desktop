// Slot map of this app (docs/desktop-modules.md §3.2). Slots join `SlotMap` in the migration step
// that moves their area (step 1: settings.page / settings.section; step 2: conversation.status;
// step 3: nav.primary / main.page; step 4, declared ahead: timeline.received / timeline.tool;
// contract 1.2: conversation.statusSurface / conversation.overlay, §16; contract 1.3: notify.method, §17;
// contract 1.4: side.component §18, two sides + refs §19 — conversation.gutter / timeline.turnAttachment /
// ref.action / ref.target; their hosts landed with P1a: docs/desktop-modules.md §19; contract 1.6:
// profile.fieldAction, §20; contract 1.7: `cutex:<kind>/<key>` links + RefTargetItem.useLink / thumbnail, §19.6;
// contract 1.8: GutterItem.anchor, §19.3; contract 1.9: SideBodyProps.keepMounted / held, §18.13; contract 1.12:
// project.tab, §21; contract 1.13: timeline.intro, §19.3; contract 1.14: timeline.codeBlockAction, §22).
// Item component types live here; types.ts / host.ts stay React-free.
import type { ComponentType, ReactNode } from "react";
import type { MessageKey } from "../i18n";
import type { AgentFeature } from "../lib/agentFeatures";
import type { SettingsAgents, SettingsGroupId, SettingsSource } from "../lib/settingsNav";
import type { ExternalMessage, RawItem } from "../lib/timeline";
import type { DeviceMethod, NotificationLevel } from "../../../shared/notificationLevels";
import type { DaemonApi, ProfileCreateRequest, ProfilePatch } from "../../../shared/ipc";
import type { HostPlatform } from "../../../shared/hosts";
import type { SettingsTab } from "../store";
import type { CustomizeRegion, CustomizeSide } from "../lib/customize";
import type { ItemId, Json, ModuleContext, ModuleDefinition, ModuleHost, PageParams, SlotEntry, SlotItemBase, SlotSpec } from "./types";

export type { PageParams } from "./types";

export type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; // lucide

export interface SettingsPageItem extends SlotItemBase {
  // default unavailable "hide"
  page: SettingsTab; // stable deep-link name = openSettings(page); unique across modules
  group: SettingsGroupId; // the shell fixes the group order (lib/settingsNav.ts)
  icon: Icon;
  titleKey: MessageKey; // nav label + breadcrumb
  source: SettingsSource | null; // page-header source tag; null = sections tag themselves
  hintKey?: MessageKey; // what the page is for, one line above the scope chips
  /** Second scope chip: do agents feel this page (lib/settingsNav SettingsAgents)? Unset = not reviewed yet, no chip. */
  agents?: SettingsAgents;
  /** A live preview beside the page when the column is wide, after it when narrow (components/Page PageBody). */
  Aside?: ComponentType;
  /** A link at the end of the page header to a related page (运行时 → 后端更新); shown only while that page is. */
  headerLink?: { page: SettingsTab; labelKey: MessageKey };
  /** A way back above the page header (主机 → ‹ 所有设备); shown only while that page is. */
  backLink?: { page: SettingsTab; labelKey: MessageKey };
  /**
   * A host page that can show every host at once (用量): the header picker adds 「全部主机」 while two or
   * more online hosts report `capability`; the page reads the hosts with lib/settingsHost
   * `useAllHostsTarget()` (null = one host, the target host). Remembered per device (module pref `hosts.all`).
   */
  allHosts?: { capability: string };
  useBadge?(): { dot?: boolean; text?: string } | null; // e.g. 关于's red dot
  Page: ComponentType;
  /** Settings search (optional): page-wide words that should find the page itself. */
  keywords?: readonly MessageKey[];
  /**
   * Settings search (optional): the cards the Page component renders itself, in page order. Each one
   * renders with `id={settingsAnchorId(anchor)}` (lib/settingsNav.ts) so a result can scroll to it.
   */
  sections?: readonly SettingsSearchSection[];
  /**
   * An app page with a host part (components/SettingsHostFrame SettingsHostPart, on the Settings
   * target host): its `settings.section` items render in that part, so they follow that host and its owner.
   */
  hostPart?: boolean;
}

/**
 * A searchable card rendered inside a settings page component (settings search, desktop-modules.md
 * §3.2). Only declared text is indexed: row labels inside the card go into `keywords`.
 */
export interface SettingsSearchSection {
  anchor: string; // unique on its page; the card's DOM id is settingsAnchorId(anchor)
  titleKey: MessageKey; // the card title (result: page › title)
  keywords?: readonly MessageKey[]; // row labels / hints inside the card
  requires?: { capabilities?: readonly string[] }; // the card only renders with these cutex capabilities
  hiddenWith?: { capabilities?: readonly string[] }; // the card is not rendered when the host has any of these (left out of search)
  /**
   * Who the card renders for on a host page (lib/settingsGate): "owner" = the host owner's connection
   * only, "member" = only another (assigned, not pending) user's connection; unset = everyone who sees the page.
   */
  access?: "owner" | "member";
  /** On an app page with `hostPart`: the card sits in that part (Settings target host, owner only). */
  part?: "host";
}

/**
 * 在主界面调整 (docs/research/rfc-in-place-settings-20261018.md): a region of the main window whose local
 * settings open in a panel beside it (components/CustomizeHost). Renderer-internal, beside `settings.page`;
 * not in the plugin SDK. `settingsPage`: 全部设置 → and that page's header button 在主界面调整.
 */
export interface CustomizeRegionItem extends SlotItemBase {
  // default unavailable "hide"
  region: CustomizeRegion;
  titleKey: MessageKey; // the panel title, e.g. 调整左侧栏
  settingsPage: SettingsTab;
  /** Which side of the region the panel sits on (lib/customize placeCustomizePanel); the region element is `[data-customize-region="<region>"]`. */
  side: CustomizeSide;
  /** The panel's width when there is room (px; default CUSTOMIZE_PANEL_W). */
  width?: number;
  /** Shows the region when the panel opens on it while it is hidden (closing the panel leaves it shown). */
  reveal?(): void;
  /** The panel body: the same cards as the settings page, under <CompactSettings>. */
  Panel: ComponentType;
}

export interface SettingsSectionItem extends SlotItemBase {
  // default unavailable "hide"
  page: SettingsTab; // target page; the page places <SettingsSections page="…" />
  titleKey?: MessageKey; // required with unavailable "notice": title + 需要升级 cutex (缺 X); also the search result title
  /** Settings search (optional): row labels / hints inside the section; searchable only with `titleKey`. */
  keywords?: readonly MessageKey[];
  /**
   * Settings search (optional): cards the Section component renders inside itself (each with its own
   * anchor). Searched in place of the item itself while it shows; a notice item stays one result.
   */
  sections?: readonly SettingsSearchSection[];
  Section: ComponentType;
}

/** Items that live in an agent's context (status categories, later timeline renderers, …). */
export interface SessionItemBase extends SlotItemBase {
  agentFeature?: AgentFeature; // lib/agentFeatures.ts; hidden only when the agent says it lacks it (lacks())
}

/** Where a status category shows: the status row above the input, the floating capsule, both, nowhere. */
export type StatusPlace = "bar" | "capsule" | "both" | "off";
export const STATUS_PLACES: readonly StatusPlace[] = ["bar", "capsule", "both", "off"];

/** One collapsed-capsule line (also a folded section's header tail, without `trailing`). */
export interface StatusLine {
  icon: ReactNode;
  text: ReactNode;
  title: string; // tooltip
  trailing?: ReactNode; // +N, budget ring, done/total
}

/**
 * v1.2: the fixed status surfaces (docs/desktop-modules.md §16). "bar" = the status row above the
 * input (shell, core); "capsule" = the floating capsule (module `status-capsule`, can be turned off).
 * A saved StatusPlace maps to a set of them: bar → {bar}, capsule → {capsule}, both → {bar, capsule},
 * off → {}.
 */
export type StatusSurfaceId = "bar" | "capsule";
export const STATUS_SURFACES: readonly StatusSurfaceId[] = ["bar", "capsule"];

/** What a reveal asks for: just show the item, or open it for editing (goal edit / replace). */
export type RevealIntent = "view" | "edit";

/** Why a requested surface is not part of the effective placement (§16.3). */
export type SurfaceUnavailableReason = "unsupported" | "absent" | "disabled" | "unavailable" | "not-ready" | "failed";
export interface SurfaceUnavailable {
  surface: StatusSurfaceId;
  reason: SurfaceUnavailableReason;
}

/** Outcome of `reveal` (§16.4): never "opened" without something visible. */
export type RevealResult =
  | { status: "opened"; surface: StatusSurfaceId }
  | { status: "unavailable"; unavailable: readonly SurfaceUnavailable[] }
  | { status: "stale" };

export interface StatusBarProps {
  sessionId: string;
  /** The item's effective placement includes the status row: render the chip. Otherwise render only what requests open. */
  inline: boolean;
  /**
   * v1.2: shows the item for a request (slash command, chip elsewhere). The shell picks the surface
   * from the effective placement (the capsule only for "view"); when that is the status row — or no
   * surface shows the item — it calls `openBarPanel` (the Bar's own popover). Never pokes another
   * module's DOM. Returns "stale" if the host / agent changed since this Bar rendered.
   */
  reveal(intent: RevealIntent, openBarPanel?: () => void): RevealResult;
  /** @deprecated v1.1 (adapter-derived from the effective placement): "capsule" only when the capsule alone shows it. Use `reveal`. */
  home: "bar" | "capsule";
  /** @deprecated v1.1: = `reveal("view")` without a bar panel. */
  showInCapsule(): void;
}

export interface StatusItem<D = unknown> extends SessionItemBase {
  // default unavailable "hide"
  titleKey: MessageKey; // section header + the row in Settings → 状态显示 + the capsule … menu
  defaultPlace: StatusPlace; // "bar" / "both" need a Bar; its surfaces must be a subset of the supported ones
  /**
   * v1.2: the surfaces this item can show on. "bar" needs `Bar`; "capsule" uses useStatus / Body.
   * Omitted (v1.1 items): derived — "bar" when it has a Bar, plus "capsule". Checked at registration.
   */
  supportedSurfaces?: readonly StatusSurfaceId[];
  /**
   * The category's data and collapsed line; null = not present (not shown). Called only where the
   * item is placed in the capsule, in the capsule's component (fixed order per item set).
   * `pulse`: bumped on a live change — briefly highlights the collapsed capsule (never opens it).
   */
  useStatus(sessionId: string): { data: D; line: StatusLine; pulse?: number } | null;
  Meta?: ComponentType<{ sessionId: string; data: D }>; // section header right of the title
  Body: ComponentType<{ sessionId: string; data: D }>;
  /**
   * The status row's part. Mounted while the item is available for the agent, whatever its placement
   * (it also takes the requests for an item shown nowhere); draws its chip only when `inline`.
   */
  Bar?: ComponentType<StatusBarProps>;
  barSide?: "start" | "end"; // status row side; default "end" (start = the growing left part)
  /** v1.4: the card handle / page-button icon when the shell shows this category on the right side (§18.9). */
  icon?: Icon;
  /** v1.4: false = never on the right side; omitted = `{ home: "workspace", order: 600 }` (§18.9). */
  side?: false | Partial<SidePlacement>;
}

/**
 * v1.2 `conversation.statusSurface`: a provider of one fixed status surface. One registered provider
 * per surface (a duplicate is rejected before registration, even while the first one is turned off);
 * only static `contributes` items count. The shell provides "bar"; `status-capsule` provides "capsule".
 */
export interface StatusSurfaceItem extends SlotItemBase {
  // default unavailable "hide"
  surface: StatusSurfaceId;
  /** Reveal intents this surface can serve (the capsule: view only; the bar: view and edit). */
  intents: readonly RevealIntent[];
  /**
   * Opens an item on this surface for the agent. "not-ready" = the view is not mounted (the caller
   * may retry; nothing is queued). The bar has none: its panels belong to the items' Bars.
   */
  reveal?(target: { sessionId: string; itemId: string }): "opened" | "not-ready";
}

/** Space an overlay reserves in the conversation (only what the capsule needs today). */
export interface OverlayLayout {
  /** The timeline edge it floats at. */
  anchor: "top" | "bottom";
  /** Over the reading column (the column gets an inset) rather than beside it at the window edge. */
  overColumn: boolean;
  /** v1.4: the side it floats on, so the gutters can avoid it (§19). Omitted = unknown. */
  side?: "left" | "right";
}

/**
 * v1.2 `conversation.overlay` (trusted, built-in only): a view floating over the timeline. Mounted
 * per agent while its module is on; it reports the space it needs through `reserve` (null = none)
 * and must release it on unmount. The conversation never names a contributor.
 */
export interface ConversationOverlayItem extends SessionItemBase {
  // default unavailable "hide"
  Overlay: ComponentType<{ sessionId: string; reserve(layout: OverlayLayout | null): void }>;
}

/** Where a page link goes: a `main.page` item id + its (in-memory) params. */
export interface PageTarget {
  page: ItemId;
  params?: PageParams;
}

/** Where a sidebar entry sits: the list above the agents, or the footer row (设置). */
export type NavArea = "top" | "footer";

export interface NavItem extends SlotItemBase {
  // default unavailable "disable": the nav does not shift when capabilities load (§13.2);
  // entries only some hosts have (作业) say "hide".
  icon: Icon;
  titleKey: MessageKey;
  area?: NavArea; // default "top"
  /** Plain manifest/user content; built-in labels continue to use titleKey. */
  title?: string;
  target: PageTarget | { run(): void | Promise<void> };
  activePages?: readonly ItemId[]; // highlighted while one of these pages is open; default = target.page
  useTitleKey?(): MessageKey | null; // a live label (正在创建…); null = titleKey
  useBadge?(): { text?: string; dot?: boolean; title?: string; attention?: boolean } | null; // 「⚠ N」, red dot
  Menu?: ComponentType; // drop-down beside the entry (快速对话 → profile); only while available
}

/** One breadcrumb of a page's title (the title bar); the last one is the page name. */
export interface PageCrumb {
  text: string;
  to?: PageTarget; // clickable (not on the last crumb)
  lead?: ReactNode; // before the text (project badge, task tag)
  trail?: ReactNode; // after the text (project id)
}

export interface PageItem extends SlotItemBase {
  // default unavailable "hide": an open page whose module stops shows 「模块已关闭」
  Page: ComponentType<{ params: PageParams }>;
  useTitle(params: PageParams): readonly PageCrumb[];
  /** Replaces the app sidebar and its title-bar column (设置's nav); the page then gets a close button. */
  Aside?: ComponentType<{ params: PageParams }>;
  /**
   * v1.4 (§19): opt-in, called at capture AND reopen; keeps only safe navigation params (drops
   * one-shot actions); null = this page cannot be referenced.
   */
  refParams?(params: PageParams): PageParams | null;
}

/**
 * `timeline.received` (step 4; pre-declared, no contributors yet — docs/desktop-modules.md §3.5):
 * the row for a received external input (timeline `received` entry, cute-codex ExternalInput),
 * dispatched by its view schema (`ExternalMessage.schema`, e.g. "cutex.delegation-ask.v1",
 * "cutex.task-assignment.v1"). One renderer per schema (registry test). No available renderer for
 * the schema (module off, capability or agent feature missing, unknown schema) → the core's plain
 * agent-message row ("cutex.agent-message.v1"), so nothing received is ever hidden. Replaces
 * lib/receivedRows.ts `SCHEMA_KIND` and the switch in Timeline.tsx.
 */
export interface ReceivedRenderer extends SessionItemBase {
  // default unavailable "hide" (= falls back to the core row)
  schemas: readonly string[];
  /** `readOnly`: history / archived agents — no reply or action buttons. */
  Row: ComponentType<{ message: ExternalMessage; sessionId: string; readOnly: boolean }>;
}

/**
 * `timeline.tool` (step 4; pre-declared, no contributors yet — docs/desktop-modules.md §3.5): the
 * row for a tool-call entry (timeline `tool` entry: commandExecution, mcpToolCall, dynamicToolCall,
 * collab / subagent calls, agent_delegate, …), chosen by tool: the first available renderer in slot
 * order whose `match` accepts the item wins; none → the core PlainToolRow. Replaces the branches in
 * WorkGroup.tsx / Timeline.tsx and lib/workGroups.ts `isStandalone`.
 */
export interface ToolRenderer extends SessionItemBase {
  // default unavailable "hide" (= the core PlainToolRow)
  /** Pure and cheap (runs for every tool entry): usually item.type plus the tool / server name. */
  match(item: RawItem): boolean;
  Row: ComponentType<{ item: RawItem; sessionId: string }>;
  /** A standalone card: ends the work group instead of folding into it (delegation cards). */
  standalone?(item: RawItem): boolean;
  /** The turn's live line while the item runs (lib/turnActivity.ts TOOL_ACTIVITY); null = the default. */
  activity?(item: RawItem): MessageKey | null;
}

/** Whether a device method can run here: "needsPermission" = the OS / browser has to allow it first. */
export type NotifyMethodAvailability = "ok" | "unsupported" | "needsPermission";

/** One delivery to a device method (the notifications module decided it from the host's tables). */
export interface NotifyDelivery {
  /** Stable per occurrence: replaces an earlier notification with the same key; click routing. */
  key: string;
  /** The registered event that decided the level (cutex registry id), "" for a test. */
  event: string;
  /** That event's title in the UI language (registry text), "" when unknown. */
  eventTitle: string;
  level: NotificationLevel;
  title: string;
  body: string;
  /** The agent it is about (cutexSessionId), if any. */
  agentId: string | null;
  agentName: string | null;
  /** Big alert: ring with it (sound and big alert both on). */
  sound: boolean;
  /** Clicked / 打开: show what it is about. */
  onClick?(): void;
}

/**
 * `notify.method` (contract 1.3, docs/desktop-modules.md §17): a device-side delivery method of the
 * host's level → method table. `method` is the cutex method id it executes (`desktop`, `sound`,
 * `bigAlert`); one item per method. Server-side methods (webhook, ntfy, …) are cutex adapters, not
 * slot items. The notifications module calls `deliver` only after the host decided the method, the
 * device did not turn it off, and `available()` is "ok".
 */
export interface NotifyMethodItem extends SlotItemBase {
  // default unavailable "hide"
  method: DeviceMethod;
  titleKey: MessageKey;
  /** Cheap and synchronous (read on every delivery and render). */
  available(): NotifyMethodAvailability;
  /** Asks the OS / browser (only when available() is "needsPermission"). */
  requestPermission?(): Promise<void>;
  deliver(n: NotifyDelivery): void;
}

// ── Contract 1.4: the right side (docs/desktop-modules.md §18) ─────────────────────────────────────

/** Whose content an instance is (§18.5). hostId = the desktop host id ("local" / "ssh-…"); every binding has one (v1.5). */
export type SideBinding =
  | { kind: "follow"; hostId: string } // the selected agent while it is on that host (opened: the layout's host)
  | { kind: "agent"; hostId: string; sessionId: string }
  | { kind: "workspace"; hostId: string; key: string } // lib/workspace.ts scopeKey
  | { kind: "host"; hostId: string };

/** Where a component's instances go when opened (§18.6). Plain data, evaluated by lib/sideLayout.ts place(). */
export interface SidePlacement {
  /** The page group this component belongs to. A page created for it carries this group. */
  home: string; // "workspace" | "browser" | "chat" | "reference" | … (table in §18.6)
  /** Ordered; the first candidate that resolves to an existing page wins. Default: [{ group: home }]. */
  prefer?: readonly SidePageCandidate[];
  /** Nothing matched: a new page carrying `home` (default) or the page in view (new page when none is open). */
  otherwise?: "new-page" | "active-page";
  /** Card position inside a page, top → bottom; default 500. */
  order?: number;
  /** A new card's initial share of the page height (0.15–0.85); default: equal split. */
  share?: number;
}
export type SidePageCandidate =
  | { group: string } // first page (button order) carrying this group
  | { containing: ItemId } // first page holding a card of that component (any binding)
  | "active"; // the page in view, when the column is open

/** Flat, validated string params (same rule as PageParams): no nested JSON, no functions. */
export type RefParams = Readonly<Record<string, string>>;

export interface SideTabInfo {
  title: string;
  tooltip?: string;
  busy?: boolean; // green pulse on this card's icon in the page button
  attention?: number; // red count on this card's icon (pending approvals …)
  unread?: boolean; // accent dot when there is no attention
}
export interface SideInstanceInfo<S> {
  id: string;
  kind: ItemId;
  binding: SideBinding;
  state: S;
  pinned: boolean;
}
export interface SideTabProps<S> {
  instance: SideInstanceInfo<S>;
  /** The binding resolved (§18.5): the bound agent / host, or the selected agent for follow. */
  hostId: string | null;
  sessionId: string | null;
}
export interface SideBodyProps<S> extends SideTabProps<S> {
  /** Persisted (debounced) and kept across remounts; small JSON (≤ 4 KiB, §18.11). */
  setState(next: S): void;
  visible: boolean; // on screen now
  active: boolean; // the focused card's active tab
  mode: "normal" | "maximised" | "fullscreen";
  where: "card" | "peek"; // peek = the left-gutter reference card (read-only use, §19)
  /** Bumped by services.side.reveal (§19): focus your main input when it changes. */
  revealed: number;
  close(): void;
  /** Open another component (same rules as services.side.open); defaults opts.page to this page. */
  open: SideOpen;
  /**
   * v1.9 (§18.13): keep this instance mounted while it holds something live (true) / let it go (false).
   * Only for keepAlive "hidden" components; a held instance is outside the off-screen LRU, stays
   * mounted (hidden) when its binding is not visible or the view scope switches host, and unmounts
   * only on release, tab close, module stop, host removed / new epoch, app exit. Returns whether
   * the instance is held after the call: false for keepMounted(true) = refused (not "hidden", the
   * window's limit `sideKeepMounted` is reached, or a reference card). Ask again after a refusal.
   */
  keepMounted(hold: boolean): boolean;
  /** v1.9: held now (reactive; the shell may drop a hold on host removal / new epoch). */
  held: boolean;
  /**
   * v1.11: promote this instance from a transient preview to a kept tab (pinned), like double-clicking its tab. Idempotent.
   * Call it when the owner starts editing / the state becomes worth keeping, so the next open does not replace it.
   * No-op for reference cards and for a held instance of another view scope.
   */
  keep(): void;
}

/**
 * v1.4 `side.component`: a kind of right-side content (§18). Entry id = component id. Instances are
 * placed by `placement`, carry a binding and a small persisted `state`; the shell draws the card,
 * its tabs and the page button, the module only the Body.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- S / P default to Json; items of a slot mix them
export interface SideComponentItem<S extends Json = any, P extends Json = any> extends SessionItemBase {
  // default unavailable "hide": a component whose module stops → its instances go dormant (kept, not shown)
  titleKey: MessageKey; // launcher / empty state / page-name fallback
  icon: Icon; // card handle + the page button's icon for this card
  instances: "singleton" | "multi"; // singleton: one per binding (e.g. one per agent)
  defaultBinding: SideBinding["kind"]; // filled from the selected agent / its host at open
  placement: SidePlacement;
  transient?: boolean; // preview semantics: replaces the unpinned instance
  keepAlive?: "unmount" | "hidden"; // default "unmount"; "hidden" = LRU-limited live instances (browser); v1.9: + SideBodyProps.keepMounted
  persist?: boolean; // default true; false = not restored after restart
  stateVersion?: number; // default 1
  minHeight?: number; // px, default 120
  /** Two sides (§19): may show as the left-gutter reference card (target "peek"). */
  peekable?: boolean;
  /** Validates open params coming from other modules (they cannot import this module's types). null = refuse. */
  parseParams(params: Json): P | null;
  /** Same key under the same binding → reuse that instance. Omitted: singleton → constant, multi → never. */
  dedupeKey?(params: P): string;
  /** Open params → initial state; also called with the new params when an existing instance is reused. */
  init(params: P, previous: S | null): S;
  /** Persisted state from an older run (possibly older stateVersion) → state, or null to drop the tab. */
  restore?(raw: Json, version: number): S | null;
  /** A pointer to this instance (§19): ref kind = this component id; key = its dedupe key. null = not referable. */
  toRef?(state: S): { key: string; title: string; params: RefParams; snippet?: string } | null;
  /** Reopen params from a stored ref (refs.open / reveal of a closed instance). Omitted = parseParams. */
  fromRef?(params: RefParams): P | null;
  /** Tab / card title and the badges the page button shows. Hook, called in the tab's own component. */
  useTab(props: SideTabProps<S>): SideTabInfo;
  Body: ComponentType<SideBodyProps<S>>;
  /** Extra buttons in the card header while this tab is active (＋ new terminal, 源码 / 渲染, reload …). */
  Actions?: ComponentType<SideBodyProps<S>>;
  /** Browser-style card header (§18.4, multi only): the tab row shows even with one tab, and a ＋ after
   *  the last tab opens `launcher.newParams ?? launcher.params` as a new tab of this card (same binding).
   *  Omitted: the tab row appears only with ≥ 2 tabs (a single instance shows its title). */
  tabRow?: "always";
  /** Called on close (tab ×, card ×, page close). Terminal: kills the PTY here. false = keep open. */
  onClose?(instance: SideInstanceInfo<S>): boolean | Promise<boolean>;
  /** Bulk closes only (card ×, 关闭页, 关闭其他): a one-line warning shown by their in-place click-twice confirm, or null. */
  closeConfirm?(instance: SideInstanceInfo<S>): string | null;
  /** ＋ menus / launcher page / title-bar launcher bar (§18.3). null params = not offered now. */
  launcher?: SideLauncher;
}

/**
 * v1.11: how a component shows in the launchers (the title bar's launcher bar, its ＋ menu, the empty column / launcher page).
 * `pin`: "default" = pinned to the title bar unless the owner unpins it (per device); "never" = never in the title bar (＋ menu only);
 * omitted = not pinned until the owner pins it. `newParams` (multi only): params of a new instance (⌥ / middle click, 「新…」); omitted = `params()`.
 */
export interface SideLauncher {
  order: number;
  pin?: "default" | "never";
  params(): Json | null;
  newParams?(): Json | null;
}

export interface SideOpenOptions {
  /** "page" (default): place() into the right side. "peek": the left-gutter reference card when it fits,
   *  else the right side. "maximised" / "fullscreen": place() then maximise / fullscreen that card. */
  target?: "page" | "peek" | "maximised" | "fullscreen";
  page?: string; // explicit target page (from SideBodyProps.open / a previous result)
  binding?: SideBinding; // default: the component's defaultBinding, filled from the selected agent
  focus?: boolean; // default false (true for launchers / shortcuts / ＋)
  reveal?: boolean; // default true for user actions: opens the column, switches page, expands the card
  pin?: boolean; // transient components: open pinned
  /** v1.11: open (or reuse) the tab in the background — like a browser's Ctrl/⌘+click: the card keeps showing its current tab,
   *  no reveal (column, page, collapse unchanged), no focus; the card / page button flashes. Wins over `reveal` / `focus`. */
  background?: boolean;
}
export type SideOpenResult =
  | { status: "opened"; instanceId: string; where: "card" | "peek"; pageId: string | null; reused: boolean }
  | { status: "unavailable"; reason: "unknown-kind" | "module-off" | "capability" | "agent-feature" | "bad-params" | "no-agent" | "host-offline" }
  | { status: "stale" }; // scope / selected agent changed between render and call
export type SideOpen = (kind: ItemId, params?: Json, opts?: SideOpenOptions) => SideOpenResult;

/**
 * v1.10 (§18.14) services.side.openHeld: open in the background and take the first keep-mounted hold in
 * one atomic call. Never reveals, focuses, switches page / view scope / host / selected agent or restores
 * the window; always a right-side card (opened pinned, never a transient replace).
 */
export interface SideOpenHeldOptions {
  page?: string; // explicit target page; default: place() as for open()
  binding?: SideBinding; // default: the component's defaultBinding, filled from the selected agent
  /** The bound host's connection epoch the caller's request belongs to; another epoch now → "stale". */
  hostEpoch?: string;
}
/**
 * v1.10: the pre-hold an openHeld() took. Opaque: pass it back to services.side.releaseHold. It can only
 * drop that pre-hold (and discard the card that openHeld created); it grants nothing else.
 */
export interface SideHoldLocator {
  readonly scope: string;
  readonly instanceId: string;
  readonly token: string;
}
export type SideOpenHeldRefusal =
  | Extract<SideOpenResult, { status: "unavailable" }>["reason"] // "module-off" / "capability" = the component's module is stopped / gated
  | "not-holdable" // the component is not keepAlive "hidden"
  | "hold-limit" // sideKeepMounted holds already taken in this window (the same count as keepMounted(true))
  | "scope-invalid" // the binding's host is unknown, or its agent is not on that host's sidebar
  | "scope-unsupported"; // the binding's host is not in the loaded view scope (no implicit scope switch)
export type SideOpenHeldResult =
  | { status: "opened"; instanceId: string; pageId: string | null; reused: boolean; hold: SideHoldLocator }
  | { status: "unavailable"; reason: SideOpenHeldRefusal }
  | { status: "stale" }; // view scope changed, or the host epoch ≠ hostEpoch
/** v1.10 releaseHold options. discard: also close the card when that openHeld created it (pending open timed out / cancelled). */
export interface SideReleaseHoldOptions {
  discard?: boolean;
}

// ── Contract 1.17: panes (docs/desktop-modules.md §24) ─────────────────────────────────────────────

/**
 * v1.17 what a pane kind's instances are bound to (§24.2): one agent ("agent", e.g. a conversation),
 * a host ("host"), whatever the focused conversation shows ("follow": file tree, changes, status
 * categories, an agent's previews / diffs / side chats / workspace terminals) or nothing ("none": pages).
 */
export type PaneKindBinding = "agent" | "host" | "follow" | "none";

/** v1.17: a pane tab's title and badges — the tab, a chip (step 4) and the window title use it. */
export interface PaneTitle extends SideTabInfo {
  icon?: Icon;
}

/**
 * v1.17 `pane.kind` (§24): a kind of pane content; entry id = kind id. A superset of `side.component`
 * (§18.2): instances `single` / `multi`, a binding, params / state as there, a title hook, Body /
 * Actions with SideBodyProps. Each `side.component` and each `main.page` (without an Aside) also derives
 * a kind (§24.4); `core.conversation` is the shell's own. Contributed kinds open in the tool area
 * (right-most column, ≤ 3 panes, then tabs) through services.panes.open / services.side.open.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- S / P default to Json; items of a slot mix them
export interface PaneKindItem<S extends Json = any, P extends Json = any> extends SessionItemBase {
  // default unavailable "hide": a kind whose module stops → its instances go dormant (kept, not shown)
  titleKey: MessageKey;
  icon: Icon;
  instances: "single" | "multi";
  binding: PaneKindBinding;
  parseParams(params: Json): P | null;
  /** Same key under the same binding → reuse that instance. Omitted: single → constant, multi → never. */
  dedupeKey?(params: P): string;
  init(params: P, previous: S | null): S;
  /** Persisted state (≤ 4 KiB) from an older run → state, or null to drop the tab. */
  restore?(raw: Json, version: number): S | null;
  stateVersion?: number; // default 1
  persist?: boolean; // default true
  useTitle(props: SideTabProps<S>): PaneTitle;
  Body: ComponentType<SideBodyProps<S>>;
  Actions?: ComponentType<SideBodyProps<S>>;
  /** Default 280 × 120 px (§24.5): a column is never narrower, a pane never lower. */
  minSize?: { w: number; h: number };
  /** May be tiled (default true). */
  tile?: boolean;
  /** "left": docked at the window's left edge, outside the tiling (only the agent list). Default null. */
  dock?: "left" | null;
  /** May pop out into a window of its own (step 6; default false). */
  popOut?: boolean;
  keepAlive?: "unmount" | "hidden";
  onClose?(instance: SideInstanceInfo<S>): boolean | Promise<boolean>;
  closeConfirm?(instance: SideInstanceInfo<S>): string | null;
  toRef?(state: S): { key: string; title: string; params: RefParams; snippet?: string } | null;
  fromRef?(params: RefParams): P | null;
  launcher?: SideLauncher;
}

/** v1.17 services.panes.open options (§24.5). */
export interface PaneOpenOptions {
  /** Beside the focused pane (conversations: a new column; Ctrl/⌘ + click) rather than in it. */
  beside?: boolean;
  /** Give the pane the keyboard focus (default false; conversations: true). */
  focus?: boolean;
  /** Open without taking the view (like Ctrl/⌘ + click): no reveal, no focus; the pane flashes. Wins over `focus`. */
  background?: boolean;
}
export type PaneOpenResult =
  | { status: "opened"; kind: string; paneId: string | null; instanceId: string | null }
  | { status: "unavailable"; reason: Extract<SideOpenResult, { status: "unavailable" }>["reason"] }
  | { status: "stale" };

// ── Contract 1.4: two sides and refs (docs/desktop-modules.md §19) ─────────────────────────────────

/** A stored pointer (bookmarks, note sources, links). Plain JSON, data only — never instructions or authority. */
export interface CutexRef {
  hostId: string; // desktop host id ("local" / "ssh-…")
  kind: string; // /^[a-z][a-z0-9.:-]{0,99}$/ (":" for status:<id>) — a component ref's kind = the component id
  key: string; // identity within (hostId, kind) — equal keys = the same target (dedupe)
  title: string; // ≤ 200 chars, shown in lists
  params: RefParams; // ≤ 32 flat string fields, names /^[A-Za-z][A-Za-z0-9_-]{0,63}$/, each ≤ 8000 chars
  snapshot?: RefSnapshot; // what to show when the target is gone / offline
}
export interface RefSnapshot {
  icon?: string; // lucide name at capture (fallback when the module is gone)
  agentName?: string; // turn / agent refs
  snippet?: string; // ≤ 500 chars of the turn / note text, plain text
  at: string; // ISO capture time
}

/** §19: show a live instance (or what a component ref points at); reopen it if it was closed. */
export type SideRevealTarget = { instanceId: string } | { ref: CutexRef };
export type SideRevealResult =
  | { status: "revealed" | "reopened"; instanceId: string; pageId: string }
  | { status: "unavailable"; reason: "gone" | "module-off" | "capability" | "host-offline" | "bad-ref" }
  | { status: "stale" };

export type RefOpenResult =
  | { status: "opened"; where: "peek" | "card" | "page" | "timeline" | "selected" }
  | { status: "unavailable"; reason: "gone" | "reverted" | "module-off" | "capability" | "host-offline" | "host-changed" | "bad-ref" }
  | { status: "stale" };

export type FocusTurnResult =
  | { status: "focused" }
  | { status: "not-found"; reason: "reverted" | "too-old" | "unknown" }
  | { status: "host-offline" }
  | { status: "stale" };

/** v1.4 `conversation.gutter`: an item in the whitespace beside the reading column (§19.2–§19.3; host components/gutter/GutterHost.tsx). */
export interface GutterItem extends SessionItemBase {
  // default unavailable "hide"
  side: "left" | "right";
  order: number; // composer triggers stack upward; top triggers run across their corner
  /** v1.8: top stays at the conversation corner even without whitespace; omitted = composer-level behaviour. */
  anchor?: "top" | "composer";
  titleKey: MessageKey;
  icon: Icon;
  /** Opens Body as a popover (below a top trigger, otherwise above; docked when allowed, wide enough and turned on). */
  Trigger?: ComponentType<GutterTriggerProps>;
  Body?: ComponentType<GutterBodyProps>;
  /** Docking allowed when the gutter is at least this wide (px). Omitted = popover only. */
  dockMinWidth?: number;
}
export interface GutterTriggerProps {
  hostId: string;
  sessionId: string;
  open: boolean;
  toggle(): void;
  where: "gutter" | "composer";
}
export interface GutterBodyProps {
  hostId: string;
  sessionId: string;
  width: number;
  /** true: a docked list standing in the gutter (the owner turned 常驻 on and the gutter is wide enough); false: a popover by the trigger. */
  docked: boolean;
  /**
   * Put the list away; what that means depends on `docked`:
   * - popover (`docked: false`): closes it, like a click outside or Esc, and focus goes back to the trigger;
   * - docked (`docked: true`): folds the list away until the owner shows it again from the trigger (which then reads
   *   「暂时收起 / 展开」). The Body unmounts, so its own state is lost; the fold is memory-only (gone on restart),
   *   is per item id (not per agent or host) and does not touch the 常驻 setting. Focus does not move. A docked list has no Esc.
   *
   * Call it when the owner is done with the list: your own close button, or a pick that consumes the popover (open something
   * elsewhere, then close). Do NOT call it after an ordinary pick or action in a docked list (`if (!docked) close()`): a docked
   * list is meant to stay, and folding it makes it vanish from under the owner's pointer. Never from render or an effect.
   */
  close(): void;
}

/**
 * v1.4 `timeline.turnAttachment` (§19.3; outlet modules/TurnAttachments.tsx): module content shown with one turn — not native
 * items, not model context, not mounted in read-only timelines. Content only; actions go to `ref.action`.
 */
export interface TurnAttachmentItem extends SessionItemBase {
  // default unavailable "hide"
  order?: number;
  /** Show in this side's gutter when it is at least minWidth px wide; otherwise (or omitted) inline at the end of the turn. */
  margin?: { side: "left" | "right"; minWidth: number };
  Attachment: ComponentType<TurnAttachmentProps>;
}
export interface TurnAttachmentProps {
  hostId: string;
  sessionId: string;
  turnId: string;
  where: "inline" | "margin";
  width: number;
}

/**
 * v1.13 `timeline.intro` (§19.3; outlet modules/TimelineIntro.tsx): the opening above a conversation's
 * first turn, shown only while the session's start is on screen (no earlier history to load). At most
 * one item per session: the first available by `order`. Read-only props — the item fetches its own data.
 */
export interface TimelineIntroItem extends SlotItemBase {
  // default unavailable "hide"
  order?: number;
  /** false = this item shows no opening for this session. */
  when?(props: TimelineIntroProps): boolean;
  render(props: TimelineIntroProps): ReactNode;
}
export interface TimelineIntroProps {
  sessionId: string;
  hostId: string;
  /** The profile name the session carries (cutex's profile reference today is the name; null = unknown). */
  profileName: string | null;
  /** The provider category the host already knows (lib/provider); null = the item resolves its own. */
  providerKind: string | null;
  /** The session's display name (the `{{name}}` placeholder). */
  agentName: string | null;
}

/**
 * v1.14 `timeline.codeBlockAction` (§22; outlet modules/CodeBlockActions.tsx via Markdown's `code`): an action
 * in the toolbar of a fenced code block (beside streamdown's Copy / Download), only in the owner's live
 * agent replies — never in their own messages or read-only timelines (archived agents, sub-agent views).
 */
export interface CodeBlockActionItem extends SessionItemBase {
  // default unavailable "hide"
  /** Pure and cheap (runs for every tagged block of a reply): true = this block gets the action. */
  match(block: CodeBlockMatch): boolean;
  Action: ComponentType<CodeBlockActionProps>;
}
export interface CodeBlockMatch {
  /** The fence tag, lower-cased (```Bash → "bash"); blocks without a tag never reach items. */
  language: string;
  /** The conversation's host (calls go there: services.daemonFor(hostId)). */
  hostId: string;
  /** That host's OS (cutex /v2/host.platform at the last connect); null = unknown. */
  platform: HostPlatform | null;
}
export interface CodeBlockActionProps extends CodeBlockMatch {
  sessionId: string;
  /** The block's text (trailing newlines trimmed). */
  code: string;
  /** The fence is still streaming (not closed): the action should be unavailable. */
  incomplete: boolean;
}

/**
 * v1.4 `ref.action` (§19.8; lib/refActions.tsx): an action on anything referable. The shell renders the same
 * list as icon buttons or menu items. Data, not a component, so it fits both.
 */
export interface RefActionItem extends SlotItemBase {
  // default unavailable "hide"
  kinds?: readonly string[]; // ref kinds this applies to; omitted = all
  excludeKinds?: readonly string[]; // ref kinds this never applies to (with `kinds` omitted: all but these)
  icon: Icon;
  titleKey: MessageKey;
  /** Live state for the current ref, e.g. "already bookmarked" (filled icon, other title). */
  useState?(ref: CutexRef): { active?: boolean; titleKey?: MessageKey; disabledReason?: string } | null;
  run(ref: CutexRef): void | Promise<void>;
}

/**
 * v1.6 `profile.fieldAction` (§20): an action beside a profile field whose daemon side a module owns,
 * in the profile editor and the 添加 profile form (claude-accounts: 「+ 添加订阅」 beside the Claude
 * 账户 select). Core renders the items through `<ProfileFieldActions field="…">` (modules/Outlet.tsx).
 */
export interface ProfileFieldActionItem extends SlotItemBase {
  // default unavailable "hide": a module that is off or lacks its capability shows nothing
  field: ProfileOwnedField;
  Action: ComponentType<ProfileFieldActionProps>;
}
/** Profile fields a `profile.fieldAction` can fill: keys of both the PATCH and the create body. */
export type ProfileOwnedField = keyof ProfilePatch & keyof ProfileCreateRequest;
export interface ProfileFieldActionProps {
  /**
   * Puts a value into the field's draft: the control re-reads its choices and shows it, the save bar
   * (editor) / 创建 (form) saves it. Picking the same value again just refreshes the control.
   */
  pick(value: string): void | Promise<void>;
  /** The field is not editable here (another profile kind, a managed profile). */
  disabled: boolean;
}

/**
 * v1.12 `project.tab` (§21): a tab of the 项目 page beside the core ones (overview 100, agents 200,
 * tasks 300, memory 400, settings 500), e.g. 成果库 / 服务. The page (and the sidebar project menu's
 * 打开项目页面) lists an item only when it is shown and the *project's* host has the module's / item's
 * capabilities (lib/hostGatingView.ts) — the module may be active for another host of the scope.
 */
export interface ProjectTabItem extends SlotItemBase {
  // default unavailable "hide"
  /** Stable deep-link name (`projects.page` param `tab`); unique across modules, never a core tab name. */
  tab: string;
  order: number;
  titleKey: MessageKey;
  Body: ComponentType<ProjectTabProps>;
  /**
   * Optional: a short phrase for the overview's count line (「3 个成果」, a link to the tab); null = nothing
   * to say (still loading, none). A hook: called once per render of the overview, in its own boundary.
   */
  useSummary?(props: ProjectTabProps): string | null;
}
export interface ProjectTabProps {
  /** The project's host (calls go there: services.daemonFor(hostId)). */
  hostId: string;
  projectId: string;
}

/** v1.4 `ref.target` (§19.9; dispatch lib/refServices.ts): the one provider of a module-defined ref kind. */
export interface RefTargetItem extends SlotItemBase {
  // default unavailable "hide"; a kind keeps its owner while that module is off (no hijack)
  kind: string;
  role: "content" | "tool";
  /** Throw / return unavailable for a deleted target; never silently retarget. Never start / restart anything. */
  open(ref: CutexRef, how: "auto" | "peek" | "page"): RefOpenResult | Promise<RefOpenResult>;
  /**
   * v1.7 (§19.6): how a `cutex:<kind>/<key>` link chip looks (tooltip, a badge after the text, tone,
   * icon). A hook, called in the link's own component; keep it cheap (batch / cache lookups). null = plain.
   */
  useLink?(ref: CutexRef): RefLinkView | null;
  /** v1.7 (§19.6): an image link's bytes for the thumbnail; null = not an image / gone / too large (the chip shows). */
  thumbnail?(ref: CutexRef, maxBytes: number): Promise<RefImage | null>;
}

/** v1.7: a `cutex:` link chip's look (RefTargetItem.useLink). */
export interface RefLinkView {
  tooltip?: string;
  badge?: string;
  tone?: "normal" | "muted" | "warn";
  icon?: Icon;
}

/** v1.7: an image link's bytes (RefTargetItem.thumbnail); the same shape as a host file read. */
export interface RefImage {
  mime: string;
  encoding: "utf8" | "base64";
  content: string;
  size: number;
  truncated: boolean;
}

export interface SlotMap {
  "settings.page": SettingsPageItem;
  "settings.section": SettingsSectionItem;
  // Renderer-internal: 在主界面调整 panels (lead 2026-10-18).
  "customize.region": CustomizeRegionItem;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each item has its own data type
  "conversation.status": StatusItem<any>;
  // v1.2: status surfaces + the overlay that hosts the capsule.
  "conversation.statusSurface": StatusSurfaceItem;
  "conversation.overlay": ConversationOverlayItem;
  "nav.primary": NavItem;
  "main.page": PageItem;
  // Step 4 (timeline): declared ahead so the contract is fixed; no module contributes and no outlet
  // reads them yet.
  "timeline.received": ReceivedRenderer;
  "timeline.tool": ToolRenderer;
  // Contract 1.3: device-side notification methods (core module `notifications`).
  "notify.method": NotifyMethodItem;
  // Contract 1.4: the right side (§18) …
  "side.component": SideComponentItem;
  // … and the two sides + refs (§19).
  "conversation.gutter": GutterItem;
  "timeline.turnAttachment": TurnAttachmentItem;
  "timeline.intro": TimelineIntroItem;
  // Contract 1.14: actions in a reply's code-block toolbar (§22).
  "timeline.codeBlockAction": CodeBlockActionItem;
  "ref.action": RefActionItem;
  "ref.target": RefTargetItem;
  // Contract 1.6: module actions beside module-owned profile fields (§20).
  "profile.fieldAction": ProfileFieldActionItem;
  // Contract 1.12: tabs of the 项目 page (§21).
  "project.tab": ProjectTabItem;
  // Contract 1.17: pane kinds (§24); side.component / main.page items derive theirs.
  "pane.kind": PaneKindItem;
}
export type SlotId = keyof SlotMap;
export type SlotItem<S extends SlotId> = SlotMap[S];

export const SLOT_SPECS: { readonly [S in SlotId]: SlotSpec } = {
  "settings.page": { unavailable: "hide" },
  "settings.section": { unavailable: "hide" },
  "customize.region": { unavailable: "hide" },
  "conversation.status": { unavailable: "hide", placement: { values: STATUS_PLACES, default: (item) => (item as StatusItem).defaultPlace } },
  "conversation.statusSurface": { unavailable: "hide" },
  "conversation.overlay": { unavailable: "hide" },
  "nav.primary": { unavailable: "disable" },
  "main.page": { unavailable: "hide" },
  "timeline.received": { unavailable: "hide" },
  "timeline.tool": { unavailable: "hide" },
  "notify.method": { unavailable: "hide" },
  "side.component": { unavailable: "hide" },
  "conversation.gutter": { unavailable: "hide" },
  "timeline.turnAttachment": { unavailable: "hide" },
  "timeline.intro": { unavailable: "hide" },
  "timeline.codeBlockAction": { unavailable: "hide" },
  "ref.action": { unavailable: "hide" },
  "ref.target": { unavailable: "hide" },
  "profile.fieldAction": { unavailable: "hide" },
  "project.tab": { unavailable: "hide" },
  "pane.kind": { unavailable: "hide" },
};

/** Narrow services handed to modules (§7). Step 1 ships the part the pilot needs; the rest lands with its area. */
export interface ModuleServices {
  /**
   * v1.5: daemon calls bound to one connected host's current connection (built-in modules only; work
   * for hosts outside the scope, e.g. the notifications module asks the event's host). The focus host
   * stays `bridge` / `api`.
   */
  daemonFor(hostId: string): DaemonApi;
  ui: {
    notice(text: string, tone?: "info" | "error"): void; // = store.notify
    openSettings(page: SettingsTab, focus?: { anchor?: string; profile?: string; create?: boolean }): void;
    /** Shows a `main.page` item (step 3); params live in memory only. */
    openPage(page: ItemId, params?: PageParams): void;
    /** Back to the conversation (closes the open page). */
    closePage(): void;
    /** 在主界面调整: opens the panel of a `customize.region` (an open page closes first); open on it already: closes it. */
    customize(region: CustomizeRegion): void;
  };
  /**
   * v1.17 (§24.5): open any pane kind — `core.conversation` (params `{ sessionId, hostId? }`; `beside` =
   * a column beside the focused one), `page:<main.page id>` (params = PageParams; in the focused pane),
   * or a tool kind (`side.component` / `pane.kind` id; the right-most tool column). Says why it cannot.
   */
  panes: {
    open(kind: string, params?: Json, opts?: PaneOpenOptions): PaneOpenResult;
  };
  /** v1.4 (§18.8): the right side — v1.17: the tool area of the panes; `open` = services.panes.open of a tool kind. */
  side: {
    open: SideOpen;
    reveal(target: SideRevealTarget): SideRevealResult;
    close(instanceId: string): void;
    /** Closes the left-gutter reference card (§19.4). */
    closePeek(): void;
    /** Instances of a component visible now (e.g. the terminal module's Ctrl+` logic). */
    list(kind: ItemId): readonly SideInstanceInfo<Json>[];
    /**
     * v1.10 (§18.14): create (or reuse) an instance in the background and hold it mounted, atomically: on
     * success its Body's first render has `held: true`; a refusal changes no layout and takes no hold.
     */
    openHeld(kind: ItemId, params: Json | undefined, opts?: SideOpenHeldOptions): SideOpenHeldResult;
    /**
     * v1.10 (§18.14): drops the pre-hold of an openHeld() while it is still that call's (the Body did not
     * release it, the shell did not revoke it). true = dropped now. Works after the caller's module stopped
     * (it only reduces); never touches another hold.
     */
    releaseHold(hold: SideHoldLocator, opts?: SideReleaseHoldOptions): boolean;
  };
  /** v1.4 (§19.7): jump to a turn in the timeline (pages older history, cross-agent; `back: false` = no 「回到」). */
  timeline: {
    focusTurn(hostId: string, sessionId: string, turnId: string, opts?: { back?: boolean }): Promise<FocusTurnResult>;
  };
  /** v1.4 (§19.9): the one entry point for every stored pointer (bookmarks, note sources, links). */
  refs: {
    open(ref: CutexRef, opts?: { how?: "auto" | "peek" | "page" | "jump" }): Promise<RefOpenResult>;
    /** Refs for what is on screen now: the selected agent, the main page, open side instances, the side page. */
    here(): readonly CutexRef[];
    /** Untrusted JSON → a valid ref, or null (kind / key / param-name rules, length limits). */
    parse(raw: unknown): CutexRef | null;
  };
}

export type AppModule = ModuleDefinition<SlotMap, ModuleServices, MessageKey>;
export type AppModuleContext = ModuleContext<SlotMap, ModuleServices, MessageKey>;
export type AppModuleHost = ModuleHost<SlotMap, ModuleServices, MessageKey>;
export type AppSlotEntry<S extends SlotId> = SlotEntry<SlotMap[S]>;

/** Identity helper: type-checks a module definition. */
export function defineModule(def: AppModule): AppModule {
  return def;
}
