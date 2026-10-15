// Notification levels (cutex capability `notification-levels`; docs/research/notification-levels.md,
// cutex docs/NOTIFICATION-LEVELS.md). Two host tables live in cutex: event → level and level → methods.
// Each device executes them and may only switch a device-side method OFF for itself ("本设备不要").
// Pure types and helpers shared by main (IPC sanitising, big alert), the renderer (the core
// `notifications` module) and the preview mock. No Electron / DOM imports.

export const NOTIFICATION_LEVELS_FEATURE = "notification-levels";
/**
 * cutex 2026-10-15: the `legacy` presets of both tables are gone (absent / stored legacy = `default`).
 * A host without this capability may still report `legacy`: shown read-only, never offered.
 */
export const NOTIFICATION_PRESETS_NO_LEGACY_FEATURE = "notification-presets-no-legacy";
/** The removed preset id of both tables (older hosts only). */
export const LEGACY_PRESET = "legacy";

/**
 * Preset choices for a table: the host's presets minus `legacy`, then the current value when it is
 * display-only (`custom`, or `legacy` reported by an older host). `readOnly` = picking it does nothing.
 */
export function presetChoices(presetIds: readonly string[], current: string): { id: string; readOnly: boolean }[] {
  const choices = presetIds.filter((id) => id !== LEGACY_PRESET).map((id) => ({ id, readOnly: false }));
  if ((current === "custom" || current === LEGACY_PRESET) && !choices.some((c) => c.id === current)) choices.push({ id: current, readOnly: true });
  return choices;
}
/** Project override key for agents outside any project (cutex INDEPENDENT_PROJECT; = the sidebar group id). */
export const INDEPENDENT_PROJECT = "__independent__";

export type NotificationLevel = "urgent" | "needsYou" | "inform" | "record";
/** Highest first (display order). */
export const NOTIFICATION_LEVELS: readonly NotificationLevel[] = ["urgent", "needsYou", "inform", "record"];
const RANK: Record<NotificationLevel, number> = { record: 0, inform: 1, needsYou: 2, urgent: 3 };

export function isNotificationLevel(value: unknown): value is NotificationLevel {
  return value === "urgent" || value === "needsYou" || value === "inform" || value === "record";
}

/** Methods this device executes (each one is a `notify.method` slot item). */
export type DeviceMethod = "desktop" | "sound" | "bigAlert";
export const DEVICE_METHODS: readonly DeviceMethod[] = ["desktop", "sound", "bigAlert"];
export function isDeviceMethod(value: unknown): value is DeviceMethod {
  return value === "desktop" || value === "sound" || value === "bigAlert";
}

/** Matrix column groups: 应用内 (fixed in-app behaviour) | 本设备 | 手机 | 外发 (server-side adapters, later). */
export type MethodGroup = "inApp" | "device" | "phone" | "outbound";
export const METHOD_GROUPS: readonly MethodGroup[] = ["inApp", "device", "phone", "outbound"];
export function methodGroup(method: string): MethodGroup {
  if (method === "needsYou" || method === "mark") return "inApp";
  if (isDeviceMethod(method)) return "device";
  if (method === "phone") return "phone";
  return "outbound";
}

/** `{"en": …, "zh-CN": …}` from the registry. */
export type LocalText = Readonly<Record<string, string>>;
export function localText(text: LocalText | undefined, locale: string): string {
  if (!text) return "";
  return text[locale] ?? text.en ?? Object.values(text)[0] ?? "";
}

export type MethodRow = Record<string, boolean>;
/** level id → method id → on. */
export type MethodMatrix = Record<string, MethodRow>;

export interface LevelSpec {
  id: string;
  title: LocalText;
  description?: LocalText;
}
export type MethodSpec = LevelSpec;

export interface EventView {
  /** Dotted id, e.g. `ownerNotify.urgent`. */
  id: string;
  /** Contributing module (`ownerNotify`, `delegation`, … or a plugin id). */
  module: string;
  title: LocalText;
  description?: LocalText;
  /** Level per event preset id. */
  levels: Record<string, NotificationLevel>;
  /** `cutex` and / or `client` (desktop / phone apply it). */
  appliedBy: string[];
  /** Capabilities the decision depends on that may not exist yet (e.g. `turn-triggers`). */
  requires: string[];
  /** Effective level. */
  level: NotificationLevel;
  /** The owner changed it (differs from the preset). */
  overridden: boolean;
}

export interface EventPresetView {
  id: string;
  title: LocalText;
  description?: LocalText;
  levels: Record<string, NotificationLevel>;
}

export interface MethodPresetView {
  id: string;
  title: LocalText;
  description?: LocalText;
  /** `ownerNotifyDelivery`: the legacy preset of an older host, derived from ownerNotify.delivery. */
  derived?: string | null;
  methods: MethodMatrix | null;
}

/** Stored settings (`/v2/settings` `notificationLevels`, `GET /v2/notification-levels` `settings`). */
export interface NotificationLevelSettings {
  eventPreset: string;
  eventLevels: Record<string, string>;
  methodPreset: string;
  methods: MethodMatrix;
  /** projectId | `__independent__` → `mute`. */
  projectOverrides: Record<string, "mute">;
}

/** `GET /v2/notification-levels` (also the PATCH answer, plus `changed`). */
export interface NotificationLevelsView {
  contractVersion: number;
  registryVersion: number;
  levels: LevelSpec[];
  methods: MethodSpec[];
  /** level → method → the only allowed value. */
  fixedCells: MethodMatrix;
  eventPresets: EventPresetView[];
  methodPresets: MethodPresetView[];
  events: EventView[];
  settings: NotificationLevelSettings;
  effective: {
    /** A preset id, or `custom`. */
    eventPreset: string;
    methodPreset: string;
    eventLevels: Record<string, NotificationLevel>;
    methods: MethodMatrix;
    /** Legacy methods preset (older hosts): an owner_notify message without a channel does not count in Needs you. Always false since cutex removed legacy. */
    legacyNeedsYouRequiresChannel: boolean;
  };
  unregisteredEventLevels?: Record<string, string>;
  changed?: boolean;
}

/** `PATCH /v2/notification-levels` (= `/v2/settings` `notificationLevels`). A preset clears that table's cells. */
export interface NotificationLevelsPatch {
  events?: { preset?: string; levels?: Record<string, NotificationLevel | null> };
  methods?: { preset?: string; cells?: Record<string, Record<string, boolean | null>> };
  projectOverrides?: Record<string, "mute" | null>;
}

/** `POST /v2/notification-levels/evaluate`: `projectId` absent = unknown, null = independent agent. */
export interface NotificationEvaluateRequest {
  events: string[];
  agentId?: string | null;
  projectId?: string | null;
}

export interface NotificationDecision {
  level: NotificationLevel;
  /** The event that decided the level. */
  event: string;
  /** Methods that are on (registry order). */
  actions: string[];
  /** owner_notify channels (`desktop` / `phone` / `bigAlert`). */
  channels: string[];
  muted: boolean;
  needsYou: boolean;
}

// ---------- wire parsing (defensive: untyped JSON) ----------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A view from the wire, or null when it is not one. */
export function asLevelsView(raw: unknown): NotificationLevelsView | null {
  if (!isObject(raw) || !Array.isArray(raw.levels) || !Array.isArray(raw.methods) || !Array.isArray(raw.events) || !isObject(raw.effective) || !isObject(raw.settings)) return null;
  const effective = raw.effective as Record<string, unknown>;
  if (!isObject(effective.methods) || !isObject(effective.eventLevels)) return null;
  return raw as unknown as NotificationLevelsView;
}

const EVENT_ID = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;
const KEY = /^[^\u0000-\u001f]{1,200}$/;

export function isEventId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 128 && EVENT_ID.test(id);
}

/** The writable subset of a patch the renderer sent (main forwards only this; cutex validates values). */
export function sanitizeLevelsPatch(raw: unknown): NotificationLevelsPatch {
  const p = isObject(raw) ? raw : {};
  const out: NotificationLevelsPatch = {};
  if (isObject(p.events)) {
    const events: NonNullable<NotificationLevelsPatch["events"]> = {};
    if (typeof p.events.preset === "string" && KEY.test(p.events.preset)) events.preset = p.events.preset;
    if (isObject(p.events.levels)) {
      const levels: Record<string, NotificationLevel | null> = {};
      for (const [id, level] of Object.entries(p.events.levels).slice(0, 1000)) if (isEventId(id) && (level === null || isNotificationLevel(level))) levels[id] = level;
      events.levels = levels;
    }
    out.events = events;
  }
  if (isObject(p.methods)) {
    const methods: NonNullable<NotificationLevelsPatch["methods"]> = {};
    if (typeof p.methods.preset === "string" && KEY.test(p.methods.preset)) methods.preset = p.methods.preset;
    if (isObject(p.methods.cells)) {
      const cells: Record<string, Record<string, boolean | null>> = {};
      for (const [level, row] of Object.entries(p.methods.cells)) {
        if (!isNotificationLevel(level) || !isObject(row)) continue;
        const clean: Record<string, boolean | null> = {};
        for (const [method, value] of Object.entries(row).slice(0, 64)) if (/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(method) && (value === null || typeof value === "boolean")) clean[method] = value;
        cells[level] = clean;
      }
      methods.cells = cells;
    }
    out.methods = methods;
  }
  if (isObject(p.projectOverrides)) {
    const overrides: Record<string, "mute" | null> = {};
    for (const [project, mode] of Object.entries(p.projectOverrides).slice(0, 500)) if (KEY.test(project) && (mode === "mute" || mode === null)) overrides[project] = mode;
    out.projectOverrides = overrides;
  }
  return out;
}

/** A checked evaluate request (main): 1–32 event ids, optional agent / project. */
export function sanitizeEvaluate(raw: unknown): NotificationEvaluateRequest {
  const p = isObject(raw) ? raw : {};
  const events = Array.isArray(p.events) ? p.events.filter(isEventId).slice(0, 32) : [];
  if (!events.length) throw new Error("bad notification events");
  const out: NotificationEvaluateRequest = { events };
  if (typeof p.agentId === "string" && KEY.test(p.agentId)) out.agentId = p.agentId;
  if (p.projectId === null) out.projectId = null;
  else if (typeof p.projectId === "string" && KEY.test(p.projectId) && p.projectId !== INDEPENDENT_PROJECT) out.projectId = p.projectId;
  else if (p.projectId === INDEPENDENT_PROJECT) out.projectId = null;
  return out;
}

export function asDecision(raw: unknown): NotificationDecision | null {
  if (!isObject(raw) || !isNotificationLevel(raw.level) || !Array.isArray(raw.actions)) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { level: raw.level, event: typeof raw.event === "string" ? raw.event : "", actions: strings(raw.actions), channels: strings(raw.channels), muted: raw.muted === true, needsYou: raw.needsYou === true };
}

// ---------- matrix ----------

/** A cell's fixed value (locked in the matrix), or null when the owner may change it. */
export function fixedCell(view: Pick<NotificationLevelsView, "fixedCells">, level: string, method: string): boolean | null {
  const v = view.fixedCells[level]?.[method];
  return typeof v === "boolean" ? v : null;
}

/** The effective value of one cell (fixed cells win; missing = off). */
export function cellValue(view: Pick<NotificationLevelsView, "fixedCells" | "effective">, level: string, method: string): boolean {
  return fixedCell(view, level, method) ?? view.effective.methods[level]?.[method] === true;
}

/** The patch that switches one cell; null for a fixed cell. */
export function cellPatch(view: Pick<NotificationLevelsView, "fixedCells" | "effective">, level: NotificationLevel, method: string, on: boolean): NotificationLevelsPatch | null {
  if (fixedCell(view, level, method) !== null) return null;
  return { methods: { cells: { [level]: { [method]: on } } } };
}

/** Method columns grouped (registry order inside a group). */
export function groupedMethods(methods: readonly MethodSpec[]): { group: MethodGroup; methods: MethodSpec[] }[] {
  return METHOD_GROUPS.map((group) => ({ group, methods: methods.filter((m) => methodGroup(m.id) === group) }));
}

/**
 * The decision cutex would make, from a fetched view (fallback when `/evaluate` fails; cutex
 * Evaluator::decide minus the legacy channel order): the highest level of the events wins; a mute
 * (agent override or project) lowers inform to record outside the legacy preset and drops the
 * outgoing methods.
 */
export function decideLocally(view: NotificationLevelsView, events: readonly string[], scope: { projectId?: string | null; agentMuted?: boolean } = {}): NotificationDecision {
  let chosen: { event: string; level: NotificationLevel } | null = null;
  for (const event of events) {
    const level = view.effective.eventLevels[event] ?? "record";
    if (!chosen || RANK[level] > RANK[chosen.level]) chosen = { event, level };
  }
  let level = chosen?.level ?? "record";
  // Older cutex: the configured methods preset (not the effective one) decides the legacy rules
  // (a host with notification-presets-no-legacy never reports legacy).
  const legacy = view.settings.methodPreset === "legacy";
  const project = scope.projectId === undefined ? undefined : (scope.projectId ?? INDEPENDENT_PROJECT);
  const muted = !!scope.agentMuted || (project !== undefined && view.settings.projectOverrides?.[project] === "mute");
  if (muted && !legacy && level === "inform") level = "record";
  let actions = view.methods.map((m) => m.id).filter((m) => cellValue(view, level, m));
  if (muted) actions = actions.filter((a) => a !== "desktop" && a !== "phone" && a !== "sound" && a !== "bigAlert");
  const channels = ["desktop", "phone", "bigAlert"].filter((c) => actions.includes(c));
  return { level, event: chosen?.event ?? "", actions, channels, muted, needsYou: actions.includes("needsYou") };
}

// ---------- device execution ----------

/** Device methods this device turned off for itself (never adds one). */
export type DeviceOff = Readonly<Record<DeviceMethod, boolean>>;
export const DEVICE_OFF_NONE: DeviceOff = { desktop: false, sound: false, bigAlert: false };

export function parseDeviceOff(raw: unknown): DeviceOff {
  const v = isObject(raw) ? raw : {};
  return { desktop: v.desktop === true, sound: v.sound === true, bigAlert: v.bigAlert === true };
}

export interface DevicePlan {
  /** Methods to run on this device, in DEVICE_METHODS order. */
  methods: DeviceMethod[];
  /** The big alert window rings itself (sound is not played separately). */
  alertSound: boolean;
}

/**
 * What this device does for decided actions: only device methods, minus the ones this device turned
 * off, minus the ones that cannot run here (`available`); when the owner is looking at the subject
 * (window focused on that agent / page) nothing pops up. Sound goes with the big alert when both run.
 */
export function devicePlan(actions: readonly string[], opts: { off: DeviceOff; looking: boolean; available(method: DeviceMethod): boolean }): DevicePlan {
  if (opts.looking) return { methods: [], alertSound: false };
  const methods = DEVICE_METHODS.filter((m) => actions.includes(m) && !opts.off[m] && opts.available(m));
  if (methods.includes("bigAlert") && methods.includes("sound")) return { methods: methods.filter((m) => m !== "sound"), alertSound: true };
  return { methods, alertSound: false };
}

/** Checked desktop notification from the renderer (main shows it; strings capped). */
export function sanitizeShellNotification(raw: unknown): { key: string; title: string; body: string } {
  const v = isObject(raw) ? raw : {};
  if (typeof v.key !== "string" || !/^[A-Za-z0-9._:@-]{1,160}$/.test(v.key)) throw new Error("bad notification key");
  const text = (s: unknown, max: number) => (typeof s === "string" ? s.slice(0, max) : "");
  return { key: v.key, title: text(v.title, 200) || "Cutex", body: text(v.body, 1000) };
}

/** Checked event big alert from the renderer. */
export function sanitizeEventAlert(raw: unknown): { key: string; agentId: string | null; agentName: string; title: string; text: string; sound: boolean } {
  const v = isObject(raw) ? raw : {};
  const { key, title } = sanitizeShellNotification({ key: v.key, title: v.title, body: "" });
  const agentId = typeof v.agentId === "string" && KEY.test(v.agentId) ? v.agentId : null;
  const agentName = typeof v.agentName === "string" && v.agentName.trim() ? v.agentName.slice(0, 120) : "Cutex";
  return { key, agentId, agentName, title, text: typeof v.text === "string" ? v.text.slice(0, 4000) : "", sound: v.sound === true };
}

/** What a retract asks main to close (shell op `retractAlerts`; ipc.ts ShellRetract). */
export interface RetractRequest {
  keys: string[];
  prefixes: string[];
  notes: { hostId: string; notificationId: string }[];
}

const MAX_RETRACT = 200;
const RETRACT_KEY = /^[A-Za-z0-9._:@-]{1,160}$/;
/** A prefix names something (`req:<agent>:`, `approval:`): ends with ":" and is never just ":". */
const RETRACT_PREFIX = /^[A-Za-z0-9._:@-]{1,159}:$/;
const HOST_ID = /^[A-Za-z0-9._:@-]{1,128}$/;
const NOTE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Checked retract from the renderer (anything malformed is dropped, lists capped). */
export function sanitizeRetract(raw: unknown): RetractRequest {
  const v = isObject(raw) ? raw : {};
  const strings = (list: unknown, re: RegExp) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && re.test(x)).slice(0, MAX_RETRACT) : []);
  const notes = Array.isArray(v.notes)
    ? v.notes
        .filter((n): n is { hostId: string; notificationId: string } => isObject(n) && typeof n.hostId === "string" && HOST_ID.test(n.hostId) && typeof n.notificationId === "string" && NOTE_ID.test(n.notificationId))
        .slice(0, MAX_RETRACT)
        .map((n) => ({ hostId: n.hostId, notificationId: n.notificationId }))
    : [];
  return { keys: strings(v.keys, RETRACT_KEY), prefixes: strings(v.prefixes, RETRACT_PREFIX), notes };
}

/** An occurrence key a retract names (exactly, or by one of its prefixes). */
export function retractMatches(key: string, retract: Pick<RetractRequest, "keys" | "prefixes">): boolean {
  return retract.keys.includes(key) || retract.prefixes.some((p) => key.startsWith(p));
}

// ---------- one-time migration of the old desktop prefs ----------

/** localStorage key of the retired desktop-only switches (`needsInput`, `turnCompleted`, `mutedProjects`). */
export const LEGACY_NOTIFY_KEY = "cutex-desktop.notify";

/**
 * `mutedProjects` of the old desktop prefs → cutex `projectOverrides` (only adds mutes; null when
 * there is nothing to send). The old switches `needsInput` / `turnCompleted` are dropped.
 */
export function migrationPatch(stored: string | null, current: Readonly<Record<string, string>> | undefined): NotificationLevelsPatch | null {
  if (!stored) return null;
  let muted: unknown;
  try {
    muted = (JSON.parse(stored) as { mutedProjects?: unknown } | null)?.mutedProjects;
  } catch {
    return null;
  }
  if (!Array.isArray(muted)) return null;
  const overrides: Record<string, "mute"> = {};
  for (const id of muted) if (typeof id === "string" && KEY.test(id) && current?.[id] !== "mute") overrides[id] = "mute";
  return Object.keys(overrides).length ? { projectOverrides: overrides } : null;
}

/** Whether a project / sidebar group is muted on the host (`projectOverrides`). */
export function projectMutedIn(view: Pick<NotificationLevelsView, "settings"> | null | undefined, groupId: string | null | undefined): boolean {
  return view?.settings.projectOverrides?.[groupId ?? INDEPENDENT_PROJECT] === "mute";
}
