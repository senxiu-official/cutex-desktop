// The stable slots: every place a module can put something and keep it across app updates.
// Fields are additive within a major version. docs/module-authoring.md's catalogue is generated from this file:
// the `@slot` comment above an interface is its entry there.
import type { ComponentType, ReactNode } from "react";
import type { HostPlatform, Icon, ItemId, Json, MessageKey, PageParams, SlotItemBase } from "./types";

/** A page a link opens: a `main.page` id and its params. */
export interface PageTarget {
  page: ItemId;
  params?: PageParams;
}

/** @slot nav.primary An entry in the app's navigation that opens a page or runs something. */
export interface NavItem extends SlotItemBase {
  icon: Icon;
  titleKey: MessageKey;
  /** The top list (default) or the footer row. */
  area?: "top" | "footer";
  target: PageTarget | { run(): void | Promise<void> };
  /** Highlighted while one of these pages is open. Default: `target.page`. */
  activePages?: readonly ItemId[];
  /** Hook. A number, a dot or a warning on the entry. */
  useBadge?(): { text?: string; dot?: boolean; title?: string; attention?: boolean } | null;
  /** Hook. false = not drawn right now. */
  useShown?(): boolean;
  /** Hook. Highlighted while true (for an entry whose target is `run`). */
  useActive?(): boolean;
}

/** One breadcrumb of a page's title. The last one is the page's name. */
export interface PageCrumb {
  text: string;
  /** Clickable. Not on the last crumb. */
  to?: PageTarget;
  lead?: ReactNode;
  trail?: ReactNode;
}

/** @slot main.page A full page, opened with `services.ui.openPage` or from a nav entry. */
export interface PageItem extends SlotItemBase {
  Page: ComponentType<{ params: PageParams }>;
  /** Hook. The page's title. `pageTitle(key)` makes the usual one. */
  useTitle(params: PageParams): readonly PageCrumb[];
}

/** The group of Settings a page sits in. The app fixes their order. */
export type SettingsGroupId = "app" | "connection" | "agents" | "tools" | "data" | "system";

/** @slot settings.page A page of Settings. */
export interface SettingsPageItem extends SlotItemBase {
  /** The name `services.ui.openSettings` opens it by. Use your module id: names are unique across modules. */
  page: string;
  group: SettingsGroupId;
  icon: Icon;
  titleKey: MessageKey;
  /** One line under the title saying what the page is for. */
  hintKey?: MessageKey;
  /** Where the page's settings live: on this device, on the host in focus, or nowhere. */
  source: "local" | "host" | null;
  Page: ComponentType;
  /** Parts on a page of their own, opened with `openSettings(page, { sub })`. */
  subPages?: Readonly<Record<string, { titleKey: MessageKey; hintKey?: MessageKey; Page: ComponentType }>>;
  /** Hook. A dot or text on the nav row. */
  useBadge?(): { dot?: boolean; text?: string } | null;
  /** Settings search: extra words that find this page. */
  keywords?: readonly MessageKey[];
}

/** @slot settings.section A card added to a Settings page that places sections (including another module's). */
export interface SettingsSectionItem extends SlotItemBase {
  /** The target page's name. */
  page: string;
  /** Needed for search to find it. */
  titleKey?: MessageKey;
  keywords?: readonly MessageKey[];
  Section: ComponentType;
}

/** Where a status category shows: the row above the input, the floating capsule, both, nowhere. */
export type StatusPlace = "bar" | "capsule" | "both" | "off";

/** One collapsed-capsule line. */
export interface StatusLine {
  icon: ReactNode;
  text: ReactNode;
  /** Tooltip. */
  title: string;
  trailing?: ReactNode;
}

/** What a status item's `Bar` is given. */
export interface StatusBarProps {
  sessionId: string;
  /** Your placement includes the status row: draw your chip. Otherwise draw only what a request opens. */
  inline: boolean;
}

/** @slot conversation.status A status category of the agent in view, in the row above the input and the capsule. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each item has its own data type
export interface StatusItem<D = any> extends SlotItemBase {
  titleKey: MessageKey;
  defaultPlace: StatusPlace;
  /** Hook. The data and the collapsed line; null = nothing to show for this agent. `pulse`: bump it to highlight the capsule. */
  useStatus(sessionId: string): { data: D; line: StatusLine; pulse?: number } | null;
  Meta?: ComponentType<{ sessionId: string; data: D }>;
  Body: ComponentType<{ sessionId: string; data: D }>;
  /** The status row's part. "bar" and "both" need it. */
  Bar?: ComponentType<StatusBarProps>;
  /** Default "end". */
  barSide?: "start" | "end";
  icon?: Icon;
}

/** What a code block's language and host are. */
export interface CodeBlockMatch {
  /** The fence tag, lower-cased. Blocks without one never reach items. */
  language: string;
  hostId: string;
  /** null = unknown. */
  platform: HostPlatform | null;
}

export interface CodeBlockActionProps extends CodeBlockMatch {
  sessionId: string;
  /** Trailing newlines trimmed. */
  code: string;
  /** The fence is still streaming: the action should be unavailable. */
  incomplete: boolean;
}

/** @slot timeline.codeBlockAction A button on the toolbar of a fenced code block in an agent's reply. Not in the owner's own messages or archived agents. */
export interface CodeBlockActionItem extends SlotItemBase {
  /** Pure and cheap: it runs for every tagged block. */
  match(block: CodeBlockMatch): boolean;
  Action: ComponentType<CodeBlockActionProps>;
}

/** A stored pointer to something referable. Data only. */
export interface CutexRef {
  hostId: string;
  /** Agent, turn, note and so on. */
  kind: string;
  /** Equal keys in a (hostId, kind) mean the same target. */
  key: string;
  title: string;
  params: Readonly<Record<string, string>>;
  snapshot?: { icon?: string; agentName?: string; snippet?: string; at: string };
}

/** One row of a menu. `"separator"` draws a line; a falsy entry is skipped, so `cond && {…}` works. */
export type MenuEntry = MenuAction | "separator" | null | false | "" | 0 | undefined;

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  /** Right-aligned text, such as a shortcut. */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip, for example why it is disabled. */
  title?: string;
  /** Asks in a dialog before running. */
  confirm?: string;
  /** Asks in place instead: the first select turns the row into this text, a second one runs it. */
  armed?: string;
  /** A row that opens these entries beside it. `onSelect` is then not used. */
  submenu?: MenuEntry[] | (() => Promise<MenuEntry[]>);
  /** What it does. Leave it out on a disabled row. */
  onSelect?(): void | Promise<void>;
}

/** @slot ref.action An action on anything referable (a message, an agent, a page), as an icon or a menu row. */
export interface RefActionItem extends SlotItemBase {
  /** Ref kinds this applies to. Omitted = all. */
  kinds?: readonly string[];
  excludeKinds?: readonly string[];
  icon: Icon;
  titleKey: MessageKey;
  /** Hook. Live state for this ref, such as "already bookmarked". */
  useState?(ref: CutexRef): { active?: boolean; titleKey?: MessageKey; tooltip?: string; disabledReason?: string } | null;
  /** Always an icon on a message's hover bar. Otherwise a row of its menu. */
  inline?: boolean;
  submenu?(ref: CutexRef): MenuEntry[] | Promise<MenuEntry[]>;
  run(ref: CutexRef): void | Promise<void>;
}

/** Whether a notification method can run here. */
export type NotifyMethodAvailability = "ok" | "unsupported" | "needsPermission";

/** One delivery to a notification method. */
export interface NotifyDelivery {
  /** Stable per occurrence: replaces an earlier notification with the same key. */
  key: string;
  event: string;
  eventTitle: string;
  level: "urgent" | "needsYou" | "inform" | "record";
  title: string;
  body: string;
  agentId: string | null;
  agentName: string | null;
  sound: boolean;
  onClick?(): void;
}

/** @slot notify.method How a device delivers a notification. One item per method; the host's table decides when it runs. */
export interface NotifyMethodItem extends SlotItemBase {
  method: "desktop" | "sound" | "bigAlert";
  titleKey: MessageKey;
  /** Cheap and synchronous. */
  available(): NotifyMethodAvailability;
  /** Asks the OS, only when `available()` says "needsPermission". */
  requestPermission?(): Promise<void>;
  deliver(notification: NotifyDelivery): void;
}

/** @slot tray.entry A button at the far end of the tray. The component decides when it shows: return null for nothing. Use `TrayButton` for its look. */
export interface TrayEntryItem extends SlotItemBase {
  Button: ComponentType;
}

/** @slot identity.menu Rows in the menu of the user button, read each time it opens. */
export interface IdentityMenuItem extends SlotItemBase {
  entries(): MenuEntry[];
}

/** A widget's per-instance settings. */
export type WidgetSettings = { readonly [key: string]: Json };

interface WidgetFieldBase {
  key: string;
  labelKey: MessageKey;
  hintKey?: MessageKey;
}

/** One field of a widget's settings form. The app draws the form. */
export type WidgetSettingField =
  | (WidgetFieldBase & { type: "text"; maxLength?: number; placeholderKey?: MessageKey })
  | (WidgetFieldBase & { type: "number"; min: number; max: number; step?: number; unit?: string })
  | (WidgetFieldBase & { type: "toggle" })
  | (WidgetFieldBase & { type: "select"; options: readonly { value: string; labelKey: MessageKey }[] })
  | (WidgetFieldBase & { type: "timezone" });

/** What a widget may do beyond itself. Each returns false when it did not happen. */
export interface WidgetActions {
  openAgent(hostId: string, sessionId: string): Promise<boolean>;
  openPage(page: ItemId, params?: PageParams): boolean;
  /** Only after the owner confirms the text in a dialog. */
  sendToAgent(hostId: string, sessionId: string, text: string): Promise<boolean>;
}

export interface DesktopWidgetProps {
  instanceId: string;
  /** The box in px. */
  width: number;
  height: number;
  /** The box in grid units (40 px, 16 px apart). */
  units: { w: number; h: number };
  theme: "light" | "dark";
  settings: WidgetSettings;
  setSettings(next: WidgetSettings): void;
  reducedMotion: boolean;
  /** The desktop is being arranged: draw the content inert. */
  arranging: boolean;
  /** The shared ticker's time in epoch ms. Use it instead of your own timer. */
  now: number;
  actions: WidgetActions;
}

/** Sizes in grid units (40 px, 16 px apart). A box is at least 2 × 2. */
export interface WidgetUnitSizes {
  min: readonly [w: number, h: number];
  max: readonly [w: number, h: number];
  default: readonly [w: number, h: number];
  presets?: Readonly<Record<string, readonly [w: number, h: number]>>;
}

/** @slot desktop.widget A kind of widget the owner can place on the desktop. */
export interface DesktopWidgetItem extends SlotItemBase {
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  icon: Icon;
  size: { units: WidgetUnitSizes; ratio?: number; resizable?: boolean };
  /** card (default): the desktop's glass card. round: a circle, keep `ratio` 1. bare: no chrome. */
  shape?: "card" | "round" | "bare";
  /** More than one instance allowed. Default false. */
  multiple?: boolean;
  settings?: readonly WidgetSettingField[];
  /** A new instance's settings; a function of the locale when they hold words. */
  defaults?: WidgetSettings | ((locale: string) => WidgetSettings);
  /** Re-render cadence through the shared ticker. Default: never. */
  refresh?: "minute" | "second";
  Widget: ComponentType<DesktopWidgetProps>;
}

/** Every stable slot and the item it takes. */
export interface SlotMap {
  "nav.primary": NavItem;
  "main.page": PageItem;
  "settings.page": SettingsPageItem;
  "settings.section": SettingsSectionItem;
  "conversation.status": StatusItem;
  "timeline.codeBlockAction": CodeBlockActionItem;
  "ref.action": RefActionItem;
  "notify.method": NotifyMethodItem;
  "tray.entry": TrayEntryItem;
  "identity.menu": IdentityMenuItem;
  "desktop.widget": DesktopWidgetItem;
}
export type SlotId = keyof SlotMap;
