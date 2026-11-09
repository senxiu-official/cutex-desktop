// experimental.d.ts
import type { ItemId, Json, SlotItemBase } from "./types";
import type { ModuleContext, ModuleDefinition } from "./services";
/** Slots that have no stable shape yet. */
export type ExperimentalSlotId = "side.component" | "pane.kind" | "pane.desktop" | "timeline.received" | "timeline.tool" | "timeline.turnAttachment" | "timeline.intro" | "conversation.gutter" | "customize.region" | "window.search";
export type ExperimentalItem = SlotItemBase & {
    readonly [field: string]: unknown;
};
/** The whole daemon API of one connected host. Untyped here. A call after your module stopped is refused. */
export type ExperimentalDaemonApi = {
    readonly [method: string]: (...args: never[]) => Promise<unknown>;
};
/** `defineModule` with experimental slots as well. */
export declare function defineExperimentalModule(definition: ModuleDefinition & {
    experimental?: {
        readonly [S in ExperimentalSlotId]?: readonly ExperimentalItem[];
    };
}): ModuleDefinition;
/** Adds an item to an experimental slot while the module runs. */
export declare function contributeExperimental(context: ModuleContext, slot: ExperimentalSlotId, item: ExperimentalItem): () => void;
/** Daemon calls bound to one connected host's current connection. */
export declare function daemonFor(context: ModuleContext, hostId: string): ExperimentalDaemonApi;
/** The right side and the tool area. */
export declare const side: {
    open(kind: ItemId, params?: Json, options?: Record<string, unknown>): {
        status: string;
    };
    close(instanceId: string): void;
    list(kind: ItemId): readonly {
        id: string;
        kind: ItemId;
        state: Json;
        pinned: boolean;
    }[];
};
/** Jump to a turn in the timeline. */
export declare function focusTurn(hostId: string, sessionId: string, turnId: string): Promise<{
    status: string;
}>;

// index.d.ts
import type { Jsonable, MessageKey, ModuleId, PageParams } from "./types";
import type { PageCrumb } from "./slots";
import type { AgentSummary, ModuleDefinition, ModuleServices } from "./services";
export type * from "./types";
export type * from "./slots";
export type * from "./services";
/** The running app's API version. Compare with care: pack.json's `moduleApi` already decides whether you load. */
export declare const MODULE_API_VERSION: string;
/** Type-checks a module definition. `export default defineModule({ … })` is what your entry file does. */
export declare function defineModule(definition: ModuleDefinition): ModuleDefinition;
/** The services, for components. In `activate`, prefer `ctx.services`: its calls end with the module. */
export declare const services: ModuleServices;
/** Hook. The UI's language and the message lookup. Messages are `{name}` templates. */
export declare function useI18n(): {
    locale: string;
    t(key: MessageKey, vars?: Record<string, string | number>): string;
};
/** Hook. One key of a module's prefs. `fallback` must be a primitive or a stable reference. */
export declare function useModulePref<T>(moduleId: ModuleId, key: string, fallback: T & Jsonable<T>): [T, (value: (T & Jsonable<T>) | ((previous: T) => T & Jsonable<T>)) => void];
/** A `main.page` `useTitle` for a page whose title is just its name. */
export declare function pageTitle(key: MessageKey): (params: PageParams) => readonly PageCrumb[];
/** Hook. Every agent on the connected hosts; re-renders when they change. */
export declare function useAgents(): readonly AgentSummary[];
/** Hook. The hosts the owner can pick from, the focus host first. */
export declare function useHosts(): readonly {
    id: string;
    label: string;
    online: boolean;
    focus: boolean;
}[];

// services.d.ts
import type { ItemId, Json, MessageKey, ModuleHostContext, ModuleHostsContext, ModuleId, ModulePrefs, ModuleRequires, PageParams } from "./types";
import type { SlotId, SlotMap } from "./slots";
export type AgentStatus = "needsInput" | "running" | "idle" | "offline" | "error" | "unknown";
/** One agent as a module sees it. */
export interface AgentSummary {
    id: string;
    hostId: string;
    name: string;
    /** A colour hint for its avatar. */
    color: string | null;
    projectId: string | null;
    status: AgentStatus;
    /** Archived agents are in the list too. */
    archived: boolean;
}
/** "ownerMessage": the owner sent a message from this desktop. "command", "tool": an agent ran one on a connected host. */
export interface ActivityEvent {
    kind: "ownerMessage" | "command" | "tool";
    hostId: string;
}
export interface PaneOpenOptions {
    /** Beside the focused pane rather than in it. */
    beside?: boolean;
    /** Give it the keyboard focus. Default false. */
    focus?: boolean;
    /** Open without taking the view. Wins over `focus`. */
    background?: boolean;
}
/** Says why when it did not open. */
export type PaneOpenResult = {
    status: "opened";
    kind: string;
    paneId: string | null;
    instanceId: string | null;
} | {
    status: "unavailable";
    reason: string;
} | {
    status: "stale";
};
export interface ModuleServices {
    ui: {
        /** A short line above the input of the conversation in view. With no conversation open nobody sees it: use `toast`. */
        notice(text: string, tone?: "info" | "error"): void;
        /** A short message at the bottom of the window, on any screen, for a few seconds. One at a time: a new one replaces it. */
        toast(text: string): void;
        /** A modal dialog. Resolves true when confirmed. */
        confirm(message: string, danger?: boolean): Promise<boolean>;
        /** Shows a `main.page`. */
        openPage(page: ItemId, params?: PageParams): void;
        /** Back to the conversation. */
        closePage(): void;
        /** Opens a Settings page by its name. `anchor`: a card to scroll to; `sub`: one of its sub-pages. */
        openSettings(page: string, focus?: {
            anchor?: string;
            sub?: string;
        }): void;
    };
    panes: {
        /** `core.conversation` (params `{ sessionId, hostId? }`) or `page:<main.page id>` (params = page params). */
        open(kind: string, params?: Json, options?: PaneOpenOptions): PaneOpenResult;
    };
    agents: {
        /** Every agent on the connected hosts. The same array until something changes, so it works with useSyncExternalStore. */
        list(): readonly AgentSummary[];
        get(id: string): AgentSummary | null;
        subscribe(listener: () => void): () => void;
        /** Shows the agent's conversation. */
        open(id: string): void;
    };
    activity: {
        /** Called once per event. Costs nothing until you subscribe. */
        subscribe(listener: (event: ActivityEvent) => void): () => void;
    };
}
/** What a module's `activate` is given. Everything in it ends when the module stops. */
export interface ModuleContext {
    readonly id: ModuleId;
    /** Aborted when the module stops. */
    readonly signal: AbortSignal;
    /** Goes up by one on each activation. */
    readonly generation: number;
    /** The host in focus. */
    readonly host: ModuleHostContext;
    readonly hosts: ModuleHostsContext;
    readonly services: ModuleServices;
    readonly prefs: ModulePrefs;
    /** Adds an item while the module runs. Returns a function to take it away. */
    contribute<S extends SlotId>(slot: S, item: SlotMap[S]): () => void;
    t(key: MessageKey, vars?: Record<string, string | number>): string;
}
export interface ModuleDefinition {
    /** Your module's id, the same as in pack.json. */
    id: ModuleId;
    /** Its name in Settings → Modules. */
    titleKey: MessageKey;
    descriptionKey?: MessageKey;
    requires?: ModuleRequires;
    /** Default true. */
    defaultEnabled?: boolean;
    /** Items that are there whenever the module is on. */
    contributes?: {
        readonly [S in SlotId]?: readonly SlotMap[S][];
    };
    /** Subscriptions and items that depend on data. Do not wait on the network here. */
    activate?(context: ModuleContext): void | Promise<void>;
}

// slots.d.ts
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
    target: PageTarget | {
        run(): void | Promise<void>;
    };
    /** Highlighted while one of these pages is open. Default: `target.page`. */
    activePages?: readonly ItemId[];
    /** Hook. A number, a dot or a warning on the entry. */
    useBadge?(): {
        text?: string;
        dot?: boolean;
        title?: string;
        attention?: boolean;
    } | null;
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
    Page: ComponentType<{
        params: PageParams;
    }>;
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
    subPages?: Readonly<Record<string, {
        titleKey: MessageKey;
        hintKey?: MessageKey;
        Page: ComponentType;
    }>>;
    /** Hook. A dot or text on the nav row. */
    useBadge?(): {
        dot?: boolean;
        text?: string;
    } | null;
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
export interface StatusItem<D = any> extends SlotItemBase {
    titleKey: MessageKey;
    defaultPlace: StatusPlace;
    /** Hook. The data and the collapsed line; null = nothing to show for this agent. `pulse`: bump it to highlight the capsule. */
    useStatus(sessionId: string): {
        data: D;
        line: StatusLine;
        pulse?: number;
    } | null;
    Meta?: ComponentType<{
        sessionId: string;
        data: D;
    }>;
    Body: ComponentType<{
        sessionId: string;
        data: D;
    }>;
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
    snapshot?: {
        icon?: string;
        agentName?: string;
        snippet?: string;
        at: string;
    };
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
    useState?(ref: CutexRef): {
        active?: boolean;
        titleKey?: MessageKey;
        tooltip?: string;
        disabledReason?: string;
    } | null;
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
export type WidgetSettings = {
    readonly [key: string]: Json;
};
interface WidgetFieldBase {
    key: string;
    labelKey: MessageKey;
    hintKey?: MessageKey;
}
/** One field of a widget's settings form. The app draws the form. */
export type WidgetSettingField = (WidgetFieldBase & {
    type: "text";
    maxLength?: number;
    placeholderKey?: MessageKey;
}) | (WidgetFieldBase & {
    type: "number";
    min: number;
    max: number;
    step?: number;
    unit?: string;
}) | (WidgetFieldBase & {
    type: "toggle";
}) | (WidgetFieldBase & {
    type: "select";
    options: readonly {
        value: string;
        labelKey: MessageKey;
    }[];
}) | (WidgetFieldBase & {
    type: "timezone";
});
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
    units: {
        w: number;
        h: number;
    };
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
    size: {
        units: WidgetUnitSizes;
        ratio?: number;
        resizable?: boolean;
    };
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
export {};

// types.d.ts
import type { ComponentType } from "react";
/** `^[a-z][a-z0-9-]{0,63}$`. Never changes once published: prefs and message keys are stored under it. */
export type ModuleId = string;
/** `<moduleId>.<name>`, unique within a slot. */
export type ItemId = `${string}.${string}`;
export type HostKind = "local" | "ssh";
export type HostPlatform = "windows" | "linux" | "macos";
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
/** Flat string params of a page; they live in memory only. */
export type PageParams = Readonly<Record<string, string | undefined>>;
/** A message key in your own catalog: `<moduleId>.<name>`. */
export type MessageKey = string;
/** Any `lucide-react` icon fits. */
export type Icon = ComponentType<{
    size?: number;
    strokeWidth?: number;
    className?: string;
}>;
export interface ModuleRequires {
    /** Every one must be in the host's capability list. */
    capabilities?: readonly string[];
    /** Must be active; they activate first, and this module stops when one stops. */
    modules?: readonly ModuleId[];
    /** Omitted = any. */
    hostKinds?: readonly HostKind[];
    /** Only the focus host counts. Default: any connected host satisfying the rest activates the module. */
    focusHost?: boolean;
    /** An optional host component your pages need; the app shows a card to set it up instead of the page while it is missing. */
    component?: string;
}
export interface SlotItemBase {
    /** Must start with your module id and a dot. */
    id: ItemId;
    /** Ascending. The app's own items use multiples of 100. */
    order?: number;
    requires?: {
        capabilities?: readonly string[];
    };
    /** How the item shows while its requirements are not met. Each slot has its own default. */
    unavailable?: "hide" | "disable" | "notice";
}
/** `T` when it can be stored as JSON, so your own interfaces and arrays of them are fine; never for a function or the like. */
export type Jsonable<T> = T extends Json ? T : T extends ((...args: never[]) => unknown) | symbol | bigint | undefined ? never : T extends readonly (infer U)[] ? readonly Jsonable<U>[] : T extends object ? {
    [K in keyof T]: Jsonable<T[K]>;
} : never;
/** Your module's own settings, kept on this device. Removing the module keeps them. A property set to `undefined` throws: leave it out. */
export interface ModulePrefs {
    get<T>(key: string, fallback: T & Jsonable<T>): T;
    set<T>(key: string, value: T & Jsonable<T>): void;
    subscribe(listener: () => void): () => void;
}
export interface ModuleHostContext {
    readonly id: string;
    readonly kind: HostKind;
    /** Empty until the capabilities have loaded. */
    readonly features: ReadonlySet<string>;
}
export interface ModuleHostEntry extends ModuleHostContext {
    readonly featuresKnown: boolean;
    readonly focus: boolean;
    readonly inScope: boolean;
}
/** A live view of the connected hosts. Changes do not restart a module: subscribe. */
export interface ModuleHostsContext {
    /** Connected hosts, the focus host first. */
    list(): readonly ModuleHostEntry[];
    get(id: string): ModuleHostEntry | undefined;
    /** Ends with the module. */
    subscribe(listener: () => void): () => void;
}

// ui.d.ts
import type { MouseEvent, ReactNode } from "react";
import type { MenuEntry } from "./slots";
/** A page's scrolling column, with the app's gutters and width. `aside`: a panel beside it when there is room. */
export declare function Page(props: {
    children: ReactNode;
    aside?: ReactNode;
}): ReactNode;
/** A row for filters and actions at the top of a page. */
export declare function PageToolbar(props: {
    children?: ReactNode;
}): ReactNode;
/** A titled card holding rows. */
export declare function Section(props: {
    title?: ReactNode;
    hint?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
}): ReactNode;
/** One setting: label and hint on the left, its control on the right. In a Section. */
export declare function SettingRow(props: {
    label: ReactNode;
    hint?: ReactNode;
    children?: ReactNode;
}): ReactNode;
/** One thing in a list: a leading mark, a name, a grey line, actions on the right. In a Section. */
export declare function ListRow(props: {
    leading?: ReactNode;
    title: ReactNode;
    detail?: ReactNode;
    actions?: ReactNode;
}): ReactNode;
/** Applies at once. */
export declare function Toggle(props: {
    checked: boolean;
    onChange(checked: boolean): void;
    disabled?: boolean;
    label?: string;
}): ReactNode;
/** Applies at once. */
export declare function Select<T extends string>(props: {
    value: T;
    options: readonly {
        value: NoInfer<T>;
        label: string;
        disabled?: boolean;
    }[];
    onChange(value: NoInfer<T>): void;
    disabled?: boolean;
    label?: string;
}): ReactNode;
/** A short row of choices. Applies at once. */
export declare function Segmented<T extends string>(props: {
    value: T;
    options: readonly {
        value: NoInfer<T>;
        label: string;
        title?: string;
    }[];
    onChange(value: NoInfer<T>): void;
    disabled?: boolean;
    label?: string;
}): ReactNode;
/** Reports every keystroke. For a draft you save yourself. */
export declare function TextInput(props: {
    value: string;
    onChange(value: string): void;
    placeholder?: string;
    mono?: boolean;
    disabled?: boolean;
    maxLength?: number;
    label?: string;
}): ReactNode;
/** Applies on Enter or when it loses focus. */
export declare function TextField(props: {
    value: string;
    onCommit(value: string): void | Promise<unknown>;
    placeholder?: string;
    mono?: boolean;
    disabled?: boolean;
    maxLength?: number;
    label?: string;
}): ReactNode;
/** Applies on Enter or when it loses focus. `null` = emptied. */
export declare function NumberField(props: {
    value: number | null;
    range: readonly [number, number];
    unit?: string;
    step?: number;
    slider?: boolean;
    onCommit(value: number | null): void;
    disabled?: boolean;
    label?: string;
    placeholder?: string;
}): ReactNode;
export declare function Button(props: {
    children: ReactNode;
    onClick?(event: MouseEvent<HTMLButtonElement>): void;
    variant?: "primary" | "secondary" | "ghost";
    size?: "md" | "sm";
    danger?: boolean;
    disabled?: boolean;
    title?: string;
}): ReactNode;
/** `label` is its tooltip and accessible name. `children` is the icon. */
export declare function IconButton(props: {
    label: string;
    children: ReactNode;
    onClick?(event: MouseEvent<HTMLButtonElement>): void;
    variant?: "secondary" | "ghost";
    size?: "md" | "sm";
    danger?: boolean;
    disabled?: boolean;
}): ReactNode;
/** A button that fits the tray (`tray.entry`). `children` is the icon. `text` is a short live value such as a countdown, up to about 6 characters: it goes after the icon and the button widens to fit. Give at least one of the two. */
export declare function TrayButton(props: {
    label: string;
    children?: ReactNode;
    text?: string;
    onClick?(event: MouseEvent<HTMLButtonElement>): void;
}): ReactNode;
/** A button that fits a code block's toolbar (`timeline.codeBlockAction`), beside its Copy and Download. `children` is a 14 px icon. */
export declare function CodeBlockButton(props: {
    label: string;
    children: ReactNode;
    onClick?(event: MouseEvent<HTMLButtonElement>): void;
    disabled?: boolean;
}): ReactNode;
/** A small state mark. */
export declare function StatusIcon(props: {
    kind: "blocked" | "review" | "active" | "closed" | "error" | "starting" | "running" | "stopped";
    size?: number;
}): ReactNode;
/** Pick one of the owner's hosts; draws nothing with only one. Hosts that are not online cannot be picked. */
export declare function HostPicker(props: {
    value: string;
    onChange(hostId: string): void;
    title: string;
}): ReactNode;
/** A short line for an empty list, with an optional action. In a Section. */
export declare function EmptyState(props: {
    children: ReactNode;
    action?: ReactNode;
}): ReactNode;
/** A warning or a remark inside a card. */
export declare function Notice(props: {
    children: ReactNode;
    tone?: "warn" | "info";
}): ReactNode;
/** Placeholder rows while something loads. */
export declare function Loading(props: {
    rows?: number;
}): ReactNode;
/** Opens the app's menu under an element, or at a point (for a right click). */
export declare function openMenu(at: HTMLElement | {
    x: number;
    y: number;
}, entries: MenuEntry[]): void;
