// Settings → 通知 (core module `notifications`; docs/research/notification-levels.md §4.4). Mixed
// sources, so every section tags its own: 等级 → 通知方式 and 事件 → 等级 (the host's two tables, cutex
// notification-levels), 本设备 (this computer's off switches + permission + tests), 新智能体的提醒 (cutex
// `/v2/settings` `newSessionNotification`, the bell's level for new agents), 按项目通知 (host project
// mutes); the owner-notify module's sections follow through the outlet. A cutex without
// notification-levels shows 「需要升级 cutex」 for its tables, then 新智能体的提醒 and the owner-notify sections.
// Two parts (review 2026-10-15 UI-02): 主机 edits the Settings target host (the host picker of the
// host pages, components/SettingsHostFrame), never the focus host in its place; 这台设备 is this device.
// Order (owner 2026-10-19): 这台设备 first (why nothing arrives is answered there), then the host's
// 通知方式, 主人通知, and the long 通知等级 list last, not folded. 新智能体的提醒 (the bell's off / on /
// important for new agents) is off the page (owner 2026-10-19): a second set of level words beside the
// four levels, for a per-agent bell the levels design retires (docs/research/notification-levels.md §4.3);
// the host keeps its stored value and the bell still changes one agent. 按项目通知 and the
// owner-notify per-agent list are hidden until they get sub-pages (their stored values still apply).
// A change only touches its own control (owner 2026-10-25: changing one level flashed the whole page): the control
// shows the new value at once (optimistic, until the host answers), nothing else is disabled or dimmed, and the
// writes go out one after another so answers land in order; unchanged event rows skip the re-render (EventRow memo).
import { memo, useCallback, useRef, useState } from "react";
import { Check, Lock, Wrench } from "lucide-react";
import { cellPatch, cellValue, fixedCell, groupedMethods, localText, LEGACY_PRESET, NOTIFICATION_LEVELS, NOTIFICATION_LEVELS_FEATURE, INDEPENDENT_PROJECT, isDeviceMethod, presetChoices, type EventView, type MethodGroup, type MethodSpec, type NotificationLevel, type NotificationLevelsPatch, type NotificationLevelsView } from "../../../../shared/notificationLevels";
import { ErrorNote, ListRow, Loading, Notice, ResetButton, ScopeChip, Section, Segmented, Select, SettingRow, SettingsGroup, Toggle, Button, EmptyState } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { useGlobalSettings } from "../../lib/globalSettings";
import { setDeviceOff, useDeviceOff } from "../../lib/notifyDevice";
import { settingsAnchorId } from "../../lib/settingsNav";
import { projectIcon } from "../../lib/projectIcons";
import { useUiPrefs } from "../../lib/prefs";
import { resolveTerms, retermDaemonText, useTermOverrides, type TermLocale } from "../../lib/terms";
import { ProjectBadge } from "../../components/ProjectBadge";
import { SettingsDevicePart, SettingsHostPart } from "../../components/SettingsHostFrame";
import { useFocusHostId, useTargetFeatures, useTargetHostId, useTargetSidebar } from "../../lib/targetHost";
import { SettingsSections } from "../Outlet";
import { useSlot } from "../react";
import { testMethod } from "./runtime";
import { projectMutePatch, useHostNotificationLevels, type TargetLevels } from "./targetLevels";

// `legacy` (older hosts only) is never offered: presetChoices shows it read-only as 旧版.
const KNOWN_PRESETS = new Set(["legacy", "quiet", "default", "all"]);
const KNOWN_EVENT_PRESETS = new Set(["legacy", "default"]);
const KNOWN_METHODS = new Set(["needsYou", "mark", "desktop", "phone", "sound", "bigAlert"]);
const KNOWN_MODULES = new Set(["ownerNotify", "system", "native", "delegation", "agentBus", "turn", "runtime", "jobs"]);
/** Registry modules shown under another group: owner approvals sit with 审批与提问. */
const MODULE_GROUP: Record<string, string> = { approvals: "native" };
const moduleGroup = (m: string) => MODULE_GROUP[m] ?? m;
/** The bell's levels (lib/notifyControl.ts), in the bell menu's order. */
const AGENT_LEVELS = ["off", "normal", "important"] as const;

/** A control's value while its write is on its way (key → value), e.g. `ev:turn.owner.failed` → "urgent". */
export type Pending = Readonly<Record<string, unknown>>;

/**
 * Writes for one section: `send(key, value, patch)` shows `value` on control `key` at once and PATCHes in
 * the background, queued so the answers (each a whole view) arrive in the order the changes were made. When
 * it settles the control follows the host's view again (a failed write: back to the old value, the error
 * shown above). Nothing else on the page is disabled while it runs (the old page-wide `busy` dimmed every
 * row for the round trip: the flash).
 */
export function usePendingPatch(levels: TargetLevels): { send(key: string, value: unknown, patch: NotificationLevelsPatch): void; pending: Pending } {
  const [pending, setPending] = useState<Pending>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(levels);
  latest.current = levels;
  const send = useCallback((key: string, value: unknown, patch: NotificationLevelsPatch) => {
    setPending((p) => ({ ...p, [key]: value }));
    const run = queue.current.then(() => latest.current.patch(patch)).catch(() => {});
    queue.current = run;
    void run.then(() =>
      setPending((p) => {
        // A later change of the same control is still on its way: keep showing that one.
        if (!(key in p) || p[key] !== value) return p;
        const rest = { ...p };
        delete rest[key];
        return rest;
      }),
    );
  }, []);
  return { send, pending };
}

/** The shown value of control `key`: its pending one, else the host's. */
const shown = <T,>(pending: Pending, key: string, actual: T): T => (key in pending && pending[key] !== null ? (pending[key] as T) : actual);

export function NotificationsPage() {
  const { t } = useI18n();
  return (
    <>
      {/* No part headings (owner 2026-10-19): like the other pages, each card carries its own tag —
          本地桌面应用 for 提醒开关, 「cutex 后端 · ● HOST ▾」 (the Settings target picker) for the host's cards. */}
      <SettingsDevicePart>
        <DeviceSection />
      </SettingsDevicePart>
      <SettingsHostPart>
        <HostSections />
      </SettingsHostPart>
    </>
  );
}

/** The Settings target host's part (inside SettingsHostPart: lib/targetHost is that host). */
function HostSections() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const focus = useFocusHostId();
  const features = useTargetFeatures();
  const supported = features.has(NOTIFICATION_LEVELS_FEATURE);
  const levels = useHostNotificationLevels(hostId, focus, supported);
  return (
    <>
      {supported && levels.error && <ErrorNote>{levels.error}</ErrorNote>}
      {supported && <MatrixSection levels={levels} />}
      {!supported && features.size > 0 && (
        <Section id={settingsAnchorId("levels")} title={t("notifications.matrix.title")} >
          <Notice tone="info">{t("modules.needsUpgrade", { feature: NOTIFICATION_LEVELS_FEATURE })}</Notice>
        </Section>
      )}
      <SettingsSections page="notifications" />
      {supported && <EventsSection levels={levels} />}
    </>
  );
}

// ---------- 1 等级 → 通知方式 ----------

function levelName(t: (k: MessageKey) => string, view: NotificationLevelsView, level: string, locale: string): string {
  if ((NOTIFICATION_LEVELS as readonly string[]).includes(level)) return t(`notifications.level.${level}` as MessageKey);
  return localText(view.levels.find((l) => l.id === level)?.title, locale) || level;
}

function methodName(t: (k: MessageKey) => string, method: MethodSpec, locale: string): string {
  return KNOWN_METHODS.has(method.id) ? t(`notifications.method.${method.id}` as MessageKey) : localText(method.title, locale) || method.id;
}

interface Column {
  group: MethodGroup;
  method: MethodSpec | null; // null = the greyed outbound placeholder
}

export function MatrixSection({ levels }: { levels: TargetLevels }) {
  const { t, locale } = useI18n();
  const { view } = levels;
  const { send, pending } = usePendingPatch(levels);
  const off = useDeviceOff();
  const { settings } = useGlobalSettings();
  const phonePaired = settings?.ownerNotify?.phonePaired !== false;
  const presetIds = view ? view.methodPresets.map((p) => p.id) : [];
  const actualPreset = view?.effective.methodPreset ?? "default";
  const current = shown(pending, "methods.preset", actualPreset);
  const choices = presetChoices(presetIds, actualPreset);
  const options = choices.map(({ id }) => ({
    value: id,
    label: KNOWN_PRESETS.has(id) || id === "custom" ? t(`notifications.preset.${id}` as MessageKey) : localText(view?.methodPresets.find((p) => p.id === id)?.title, locale) || id,
  }));
  const pickable = (id: string) => id !== current && !choices.find((c) => c.id === id)?.readOnly;
  const columns: Column[] = view
    ? groupedMethods(view.methods).flatMap(({ group, methods }): Column[] => methods.map((method) => ({ group, method })))
    : [];
  const groups = columns.reduce<{ group: MethodGroup; span: number }[]>((acc, c) => {
    const last = acc[acc.length - 1];
    if (last?.group === c.group) last.span++;
    else acc.push({ group: c.group, span: 1 });
    return acc;
  }, []);
  const template = `minmax(8rem, 1.6fr) repeat(${Math.max(1, columns.length)}, minmax(3.25rem, 1fr))`;
  return (
    <Section id={settingsAnchorId("levels")} title={t("notifications.matrix.title")} hint={t("notifications.matrix.hint")} >
      {!view && <Loading rows={4} />}
      {view && (
        <>
          <SettingRow agents="none" source="host" label={t("notifications.preset")} hint={current === LEGACY_PRESET ? t("notifications.preset.legacyNote") : undefined}>
            <Segmented value={current} options={options} onChange={(id) => pickable(id) && send("methods.preset", id, { methods: { preset: id } })} />
          </SettingRow>
          <SettingsGroup agents="none" source="host">
          <div className="-mx-4 overflow-x-auto px-4 py-2">
            <div role="table" aria-label={t("notifications.matrix.title")} className="grid min-w-[36rem] text-xs" style={{ gridTemplateColumns: template }}>
              <div role="row" className="contents">
                <div role="columnheader" />
                {groups.map((g, i) => (
                  <div key={`${g.group}-${i}`} role="columnheader" style={{ gridColumn: `span ${g.span}` }} className={`border-b border-border pb-1 text-center font-medium ${g.group === "outbound" ? "text-subtle/60" : "text-muted"}`}>
                    {t(`notifications.group.${g.group}` as MessageKey)}
                  </div>
                ))}
              </div>
              <div role="row" className="contents">
                <div role="columnheader" />
                {columns.map((c) => {
                  const deviceOff = c.method && isDeviceMethod(c.method.id) && off[c.method.id];
                  const phoneOff = c.method?.id === "phone" && !phonePaired;
                  return (
                    <div key={c.method?.id ?? "outbound"} role="columnheader" title={c.method ? localText(c.method.description, locale) || undefined : t("notifications.outbound.later")} className={`px-1 pt-1.5 pb-1 text-center leading-tight ${c.method ? "text-subtle" : "text-subtle/50"}`}>
                      {c.method ? methodName(t, c.method, locale) : "—"}
                      {deviceOff && <div className="text-caption/[inherit] text-warn">{t("notifications.deviceOff")}</div>}
                      {phoneOff && <div className="text-caption/[inherit] text-warn">{t("notifications.phoneUnpaired")}</div>}
                    </div>
                  );
                })}
              </div>
              {view.levels.map((level) => (
                <div key={level.id} role="row" className="contents">
                  <div role="rowheader" className="border-t border-border/60 py-1.5 pr-2">
                    <div className="text-sm">{levelName(t, view, level.id, locale)}</div>
                    <div className="text-caption/[inherit] text-subtle">{(NOTIFICATION_LEVELS as readonly string[]).includes(level.id) ? t(`notifications.levelHint.${level.id}` as MessageKey) : localText(level.description, locale)}</div>
                  </div>
                  {columns.map((c) => (
                    <div key={c.method?.id ?? "outbound"} role="cell" className="flex items-center justify-center border-t border-border/60 py-1.5">
                      {c.method ? (
                        <MatrixCell
                          on={shown(pending, `cell:${level.id}:${c.method.id}`, cellValue(view, level.id, c.method.id))}
                          fixed={fixedCell(view, level.id, c.method.id) !== null}
                          dim={(isDeviceMethod(c.method.id) && off[c.method.id]) || (c.method.id === "phone" && !phonePaired)}
                          label={`${levelName(t, view, level.id, locale)} · ${methodName(t, c.method, locale)}`}
                          fixedLabel={t("notifications.fixed")}
                          onToggle={(on) => {
                            const p = cellPatch(view, level.id as NotificationLevel, c.method!.id, on);
                            if (p) send(`cell:${level.id}:${c.method!.id}`, on, p);
                          }}
                        />
                      ) : (
                        <span className="text-subtle/40" title={t("notifications.outbound.later")}>—</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          </SettingsGroup>
        </>
      )}
    </Section>
  );
}

function MatrixCell({ on, fixed, dim, label, fixedLabel, onToggle }: { on: boolean; fixed: boolean; dim: boolean; label: string; fixedLabel: string; onToggle(on: boolean): void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      aria-disabled={fixed || undefined}
      title={fixed ? `${label} · ${fixedLabel}` : label}
      onClick={() => !fixed && onToggle(!on)}
      className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
        on ? "border-accent bg-accent text-white" : "border-border bg-background text-subtle"
      } ${fixed ? "cursor-default opacity-50" : "hover:border-accent/70"} ${dim && !fixed ? "opacity-45" : ""}`}
    >
      {fixed ? <Lock size={10} strokeWidth={2.5} /> : on ? <Check size={13} strokeWidth={3} /> : null}
    </button>
  );
}

// ---------- 2 事件分级 (event → level) ----------

/**
 * Groups by what an event means for you (owner 2026-10-19), not by cutex module. Ids we know get their
 * group, title and description here (lib-free, UI copy); anything else falls back by module, and an event
 * no rule places goes to 其他 with cutex's own title / description.
 */
const EVENT_GROUPS = ["ask", "mine", "ownerNotify", "others", "trouble", "other"] as const;
type EventGroup = (typeof EVENT_GROUPS)[number];
const KNOWN_EVENTS: Record<string, EventGroup> = {
  "native.approval": "ask",
  "native.question": "ask",
  "ownerApproval.pending": "ask",
  "delegation.pendingReview": "ask",
  "delegation.failed.owner": "mine",
  "turn.owner.completed": "mine",
  "turn.owner.failed": "mine",
  "turn.owner.interrupted": "mine",
  "ownerNotify.info": "ownerNotify",
  "ownerNotify.attention": "ownerNotify",
  "ownerNotify.urgent": "ownerNotify",
  "ownerNotify.needsReply": "ownerNotify",
  "turn.other.completed": "others",
  "turn.other.failed": "others",
  "job.completed.agent": "others",
  "system.quarantine": "trouble",
  "system.deliveryFailed": "trouble",
  "system.idleDelegation": "trouble",
  "delegation.deliveryFailed": "trouble",
  "agentBus.messageFailed": "trouble",
  "runtime.error": "trouble",
};
function eventGroup(e: EventView): EventGroup {
  const known = KNOWN_EVENTS[e.id];
  if (known) return known;
  if (e.module === "ownerNotify") return "ownerNotify";
  if (e.module === "native" || e.module === "approvals") return "ask";
  if (e.module === "turn") return e.id.startsWith("turn.owner.") ? "mine" : "others";
  if (e.module === "jobs") return "others";
  if (e.module === "system" || e.module === "agentBus" || e.module === "runtime") return "trouble";
  return "other";
}

/** The group band: a plain dark strip between rows of the one card (not the preview's dots). */
function GroupBand({ group, first }: { group: EventGroup; first: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`-mx-4 flex min-h-8 items-center gap-2 border-b border-border/70 bg-win px-4 py-1.5 ${first ? "-mt-1 rounded-t-xl" : "-mt-px border-t"}`}>
      <span className="text-meta/[inherit] font-medium text-muted">{t(`notifications.eventGroup.${group}` as MessageKey)}</span>
      <span className="min-w-0 truncate text-caption/[inherit] text-subtle">{t(`notifications.eventGroup.${group}.hint` as MessageKey)}</span>
      {/* 主人通知 is the agents' MCP tool owner_notify: the band carries its [MCP工具] tag. */}
      {group === "ownerNotify" && (
        <span className="ml-auto shrink-0">
          <ScopeChip tone="plain" icon={<Wrench size={11} aria-hidden />} label={t("settings.scope.mcp.label")} title={t("settings.scope.mcp.title", { tools: "owner_notify" })} body={`${t("settings.scope.mcp.body", { tools: "owner_notify" })} ${t("owner-notify.toolDesc")}`} />
        </span>
      )}
    </div>
  );
}

export function EventsSection({ levels: target }: { levels: TargetLevels }) {
  const { t, locale } = useI18n();
  const { view } = target;
  const { send, pending } = usePendingPatch(target);
  const actualPreset = view?.effective.eventPreset ?? "default";
  const current = shown(pending, "events.preset", actualPreset);
  const choices = presetChoices(view?.eventPresets.map((p) => p.id) ?? [], actualPreset);
  const pickable = (id: string) => id !== current && !choices.find((c) => c.id === id)?.readOnly;
  const options = choices.map(({ id }) => ({
    value: id,
    label: id === "custom" ? t("notifications.preset.custom") : KNOWN_EVENT_PRESETS.has(id) ? t(`notifications.eventPreset.${id}` as MessageKey) : localText(view?.eventPresets.find((p) => p.id === id)?.title, locale) || id,
  }));
  const levels = useLevelOptions();
  // One callback for every row (EventRow is memoised on it).
  const onLevel = useCallback((id: string, level: NotificationLevel | null) => send(`ev:${id}`, level, { events: { levels: { [id]: level } } }), [send]);
  const events = view?.events ?? [];
  const groups = EVENT_GROUPS.filter((g) => events.some((e) => eventGroup(e) === g));
  return (
    <Section
      id={settingsAnchorId("events")}
      title={t("notifications.events.title")}
      hint={current === LEGACY_PRESET ? `${t("notifications.events.hint")} ${t("notifications.preset.legacyNote")}` : t("notifications.events.hint")}
      actions={view ? <SettingsGroup agents="none" source="host"><Segmented value={current} options={options} label={t("notifications.preset")} onChange={(id) => pickable(id) && send("events.preset", id, { events: { preset: id } })} /></SettingsGroup> : undefined}
    >
      {!view && <Loading rows={4} />}
      {view && events.length === 0 && <EmptyState>{t("notifications.events.none")}</EmptyState>}
      {view &&
        groups.map((g, i) => (
          <div key={g}>
            <GroupBand group={g} first={i === 0} />
            {events
              .filter((e) => eventGroup(e) === g)
              .map((e) => (
                <EventRow key={e.id} event={e} locale={locale} levels={levels} level={shown(pending, `ev:${e.id}`, e.level)} resetting={pending[`ev:${e.id}`] === null} onLevel={onLevel} />
              ))}
          </div>
        ))}
    </Section>
  );
}


type LevelOption = { value: NotificationLevel; label: string };

/** The four level choices, the same array while the locale stays (EventRow's memo compares it). */
function useLevelOptions(): LevelOption[] {
  const { t, locale } = useI18n();
  const memo = useRef<{ locale: string; t: unknown; options: LevelOption[] } | null>(null);
  if (!memo.current || memo.current.locale !== locale || memo.current.t !== t)
    memo.current = { locale, t, options: NOTIFICATION_LEVELS.map((l) => ({ value: l, label: t(`notifications.level.${l}`) })) };
  return memo.current.options;
}

type EventRowProps = { event: EventView; locale: string; levels: LevelOption[]; level: NotificationLevel; resetting: boolean; onLevel(id: string, level: NotificationLevel | null): void };

/** A new view (every answer is a whole one) re-renders only the rows whose event changed. */
const sameEvent = (a: EventRowProps, b: EventRowProps) =>
  a.locale === b.locale && a.levels === b.levels && a.level === b.level && a.resetting === b.resetting && a.onLevel === b.onLevel &&
  a.event.id === b.event.id && a.event.level === b.event.level && a.event.overridden === b.event.overridden && JSON.stringify([a.event.title, a.event.description]) === JSON.stringify([b.event.title, b.event.description]);

/** One event: a settings row whose ↺ (reset slot) drops the override, like every defaultable row. */
const EventRow = memo(function EventRow({ event, locale, levels, level, resetting, onLevel }: EventRowProps) {
  const { t } = useI18n();
  const terms = resolveTerms(useTermOverrides(), locale as TermLocale);
  // Known ids carry our own title and one-line description (owner 2026-10-19); others keep cutex's.
  const known = event.id in KNOWN_EVENTS;
  const title = known ? t(`notifications.ev.${event.id}` as MessageKey) : retermDaemonText(localText(event.title, locale), terms, locale as TermLocale) || event.id;
  const description = known ? t(`notifications.ev.${event.id}.desc` as MessageKey) : retermDaemonText(localText(event.description, locale), terms, locale as TermLocale);
  return (
    <SettingRow
      agents="none"
      source="host"
      label={
        <span className="flex items-center gap-1.5" title={`${event.id}${description ? ` — ${description}` : ""}`}>
          <span className="truncate">{title}</span>
        </span>
      }
      hint={description || undefined}
      reset={<ResetButton title={t("notifications.events.reset")} disabled={resetting || !event.overridden} onClick={() => onLevel(event.id, null)} />}
    >
      <Segmented accent value={level} options={levels} label={title} onChange={(next) => onLevel(event.id, next)} />
    </SettingRow>
  );
}, sameEvent);

// ---------- 3 本设备 ----------

function DeviceSection() {
  const { t } = useI18n();
  const off = useDeviceOff();
  const items = useSlot("notify.method");
  const [, rerender] = useState(0);
  const desktop = items.find((e) => e.item.method === "desktop")?.item;
  const permission = desktop?.available() ?? "unsupported";
  const text = { title: t("notifications.test.title"), body: t("notifications.test.body") };
  return (
    <Section
      id={settingsAnchorId("device")}
      title={t("notifications.device.title")}
      hint={t("notifications.device.hint")}

      actions={items.map(({ item }) => (
        <Button key={item.id} disabled={item.available() !== "ok" || off[item.method]} onClick={() => testMethod(item.method, text)}>
          {t(`notifications.device.test.${item.method}` as MessageKey)}
        </Button>
      ))}
    >
      <SettingRow readOnly={permission !== "needsPermission" || !desktop?.requestPermission} label={t("notifications.device.permission")} agents="none" source="local">
        <span className={`text-xs ${permission === "ok" ? "text-muted" : "text-warn"}`}>{t(`notifications.device.${permission}` as MessageKey)}</span>
        {permission === "needsPermission" && desktop?.requestPermission && (
          <Button onClick={() => void desktop.requestPermission?.().finally(() => rerender((n) => n + 1))}>{t("notifications.device.allow")}</Button>
        )}
      </SettingRow>
      {items.map(({ item }) => {
        const available = item.available();
        return (
          <SettingRow readOnly={available === "unsupported"} key={item.id} label={t(item.titleKey)} agents="none" source="local">
            {available === "unsupported" ? (
              <span className="text-xs text-subtle">{t("notifications.device.unsupported")}</span>
            ) : (
              <Toggle checked={!off[item.method]} label={t(item.titleKey)} onChange={(v) => void setDeviceOff(item.method, !v)} />
            )}
          </SettingRow>
        );
      })}
    </Section>
  );
}

// ---------- 4 新智能体的提醒 ----------

/** The level a new agent starts with (`newSessionNotification`), worded like the title-bar bell. */
export function NewAgentSection() {
  const { t } = useI18n();
  const { settings, patch } = useGlobalSettings();
  if (!settings?.newSessionNotification) return null;
  return (
    <Section id={settingsAnchorId("newAgentLevel")} title={t("agent-config.defaults.notification")} hint={t("agent-config.defaults.notificationHint")} >
      <SettingRow label={t("notify.newAgentLevel")} agents="none" source="host">
        <Segmented
          value={settings.newSessionNotification}
          label={t("notify.newAgentLevel")}
          options={AGENT_LEVELS.map((v) => ({ value: v, label: t(`notify.lvl.${v}`) }))}
          onChange={(v) => void patch({ newSessionNotification: v })}
        />
      </SettingRow>
    </Section>
  );
}

// ---------- 5 按项目通知 (hidden for now: a sub-page later, owner 2026-10-19) ----------

export function MuteSection({ levels }: { levels: TargetLevels }) {
  const { t } = useI18n();
  const { view } = levels;
  const hostId = useTargetHostId();
  const projects = useTargetSidebar()?.projects?.projects ?? [];
  const icons = useUiPrefs().projectIcons;
  const overrides = view?.settings.projectOverrides ?? {};
  const row = (id: string, title: string, leading: React.ReactNode) => (
    <SettingsGroup key={id} agents="none" source="host"><ListRow leading={leading} title={title} actions={<Toggle label={title} disabled={!view} checked={overrides[id] !== "mute"} onChange={() => void levels.patch(projectMutePatch(view, id)).catch(() => {})} />} /></SettingsGroup>
  );
  return (
    <Section id={settingsAnchorId("mute")} title={t("notifications.mute.title")} hint={t("notifications.mute.hint")} >
      {projects.map((p) =>
        row(
          p.project_id,
          p.presentation.display_name || p.project_id,
          <ProjectBadge icon={projectIcon(icons, hostId, p.project_id)} badge={p.presentation.badge_label || (p.presentation.display_name || p.project_id).slice(0, 1)} color={p.presentation.color} />,
        ),
      )}
      {row(INDEPENDENT_PROJECT, t("sidebar.independent"), <span className="h-4 w-4 shrink-0 rounded border border-dashed border-subtle/60" />)}
    </Section>
  );
}
