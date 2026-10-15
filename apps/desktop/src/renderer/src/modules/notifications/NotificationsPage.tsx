// Settings → 通知 (core module `notifications`; docs/research/notification-levels.md §4.4). Mixed
// sources, so every section tags its own: 等级 → 通知方式 and 事件 → 等级 (the host's two tables, cutex
// notification-levels), 本设备 (this computer's off switches + permission + tests), 新智能体的提醒 (cutex
// `/v2/settings` `newSessionNotification`, the bell's level for new agents), 按项目通知 (host project
// mutes); the owner-notify module's sections follow through the outlet. A cutex without
// notification-levels shows 「需要升级 cutex」 for its tables, then 新智能体的提醒 and the owner-notify sections.
// Two parts (review 2026-10-15 UI-02): 主机 edits the Settings target host (the host picker of the
// host pages, components/SettingsHostFrame), never the focus host in its place; 本设备 is this computer.
import { useState } from "react";
import { Check, Lock } from "lucide-react";
import { cellPatch, cellValue, fixedCell, groupedMethods, localText, LEGACY_PRESET, NOTIFICATION_LEVELS, NOTIFICATION_LEVELS_FEATURE, INDEPENDENT_PROJECT, isDeviceMethod, presetChoices, type EventView, type MethodGroup, type MethodSpec, type NotificationLevel, type NotificationLevelsPatch, type NotificationLevelsView } from "../../../../shared/notificationLevels";
import { ErrorNote, ListRow, Loading, Notice, ResetButton, Section, Segmented, Select, SettingRow, Toggle, Button, EmptyState } from "../../components/settings/Form";
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

function usePatch(levels: TargetLevels): [(patch: NotificationLevelsPatch) => void, boolean] {
  const [busy, setBusy] = useState(false);
  const run = (patch: NotificationLevelsPatch) => {
    setBusy(true);
    void levels
      .patch(patch)
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  return [run, busy];
}

export function NotificationsPage() {
  const { t } = useI18n();
  return (
    <>
      <SettingsHostPart title={t("notifications.part.host")} hint={t("notifications.part.hostHint")}>
        <HostSections />
      </SettingsHostPart>
      <SettingsDevicePart title={t("notifications.part.device")} hint={t("notifications.part.deviceHint")}>
        <DeviceSection />
      </SettingsDevicePart>
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
      {supported && <EventsSection levels={levels} />}
      {!supported && features.size > 0 && (
        <Section id={settingsAnchorId("levels")} title={t("notifications.matrix.title")} source="host">
          <Notice tone="info">{t("modules.needsUpgrade", { feature: NOTIFICATION_LEVELS_FEATURE })}</Notice>
        </Section>
      )}
      <NewAgentSection />
      {supported && <MuteSection levels={levels} />}
      <SettingsSections page="notifications" />
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

function MatrixSection({ levels }: { levels: TargetLevels }) {
  const { t, locale } = useI18n();
  const { view } = levels;
  const [patch, busy] = usePatch(levels);
  const off = useDeviceOff();
  const { settings } = useGlobalSettings();
  const phonePaired = settings?.ownerNotify?.phonePaired !== false;
  const presetIds = view ? view.methodPresets.map((p) => p.id) : [];
  const current = view?.effective.methodPreset ?? "default";
  const choices = presetChoices(presetIds, current);
  const options = choices.map(({ id }) => ({
    value: id,
    label: KNOWN_PRESETS.has(id) || id === "custom" ? t(`notifications.preset.${id}` as MessageKey) : localText(view?.methodPresets.find((p) => p.id === id)?.title, locale) || id,
  }));
  const pickable = (id: string) => id !== current && !choices.find((c) => c.id === id)?.readOnly;
  const columns: Column[] = view
    ? groupedMethods(view.methods).flatMap(({ group, methods }): Column[] => (methods.length ? methods.map((method) => ({ group, method })) : group === "outbound" ? [{ group, method: null }] : []))
    : [];
  const groups = columns.reduce<{ group: MethodGroup; span: number }[]>((acc, c) => {
    const last = acc[acc.length - 1];
    if (last?.group === c.group) last.span++;
    else acc.push({ group: c.group, span: 1 });
    return acc;
  }, []);
  const template = `minmax(8rem, 1.6fr) repeat(${Math.max(1, columns.length)}, minmax(3.25rem, 1fr))`;
  return (
    <Section id={settingsAnchorId("levels")} title={t("notifications.matrix.title")} hint={t("notifications.matrix.hint")} source="host">
      {!view && <Loading rows={4} />}
      {view && (
        <>
          <SettingRow label={t("notifications.preset")} hint={current === LEGACY_PRESET ? t("notifications.preset.legacyNote") : undefined}>
            <Segmented value={current} options={options} disabled={busy} onChange={(id) => pickable(id) && patch({ methods: { preset: id } })} />
          </SettingRow>
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
                      {deviceOff && <div className="text-[10.5px] text-warn">{t("notifications.deviceOff")}</div>}
                      {phoneOff && <div className="text-[10.5px] text-warn">{t("notifications.phoneUnpaired")}</div>}
                    </div>
                  );
                })}
              </div>
              {view.levels.map((level) => (
                <div key={level.id} role="row" className="contents">
                  <div role="rowheader" className="border-t border-border/60 py-1.5 pr-2">
                    <div className="text-sm">{levelName(t, view, level.id, locale)}</div>
                    <div className="text-[11px] text-subtle">{(NOTIFICATION_LEVELS as readonly string[]).includes(level.id) ? t(`notifications.levelHint.${level.id}` as MessageKey) : localText(level.description, locale)}</div>
                  </div>
                  {columns.map((c) => (
                    <div key={c.method?.id ?? "outbound"} role="cell" className="flex items-center justify-center border-t border-border/60 py-1.5">
                      {c.method ? (
                        <MatrixCell
                          on={cellValue(view, level.id, c.method.id)}
                          fixed={fixedCell(view, level.id, c.method.id) !== null}
                          dim={(isDeviceMethod(c.method.id) && off[c.method.id]) || (c.method.id === "phone" && !phonePaired)}
                          disabled={busy}
                          label={`${levelName(t, view, level.id, locale)} · ${methodName(t, c.method, locale)}`}
                          fixedLabel={t("notifications.fixed")}
                          onToggle={(on) => {
                            const p = cellPatch(view, level.id as NotificationLevel, c.method!.id, on);
                            if (p) patch(p);
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
        </>
      )}
    </Section>
  );
}

function MatrixCell({ on, fixed, dim, disabled, label, fixedLabel, onToggle }: { on: boolean; fixed: boolean; dim: boolean; disabled: boolean; label: string; fixedLabel: string; onToggle(on: boolean): void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      aria-disabled={fixed || undefined}
      title={fixed ? `${label} · ${fixedLabel}` : label}
      disabled={disabled && !fixed}
      onClick={() => !fixed && onToggle(!on)}
      className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
        on ? "border-accent bg-accent text-white" : "border-border bg-background text-subtle"
      } ${fixed ? "cursor-default opacity-50" : "hover:border-accent/70"} ${dim && !fixed ? "opacity-45" : ""}`}
    >
      {fixed ? <Lock size={10} strokeWidth={2.5} /> : on ? <Check size={13} strokeWidth={3} /> : null}
    </button>
  );
}

// ---------- 2 事件 → 等级 ----------

function EventsSection({ levels: target }: { levels: TargetLevels }) {
  const { t, locale } = useI18n();
  const { view } = target;
  const [patch, busy] = usePatch(target);
  const [changedOnly, setChangedOnly] = useState(false);
  const current = view?.effective.eventPreset ?? "default";
  const choices = presetChoices(view?.eventPresets.map((p) => p.id) ?? [], current);
  const pickable = (id: string) => id !== current && !choices.find((c) => c.id === id)?.readOnly;
  const options = choices.map(({ id }) => ({
    value: id,
    label: id === "custom" ? t("notifications.preset.custom") : KNOWN_EVENT_PRESETS.has(id) ? t(`notifications.eventPreset.${id}` as MessageKey) : localText(view?.eventPresets.find((p) => p.id === id)?.title, locale) || id,
  }));
  const levels = NOTIFICATION_LEVELS.map((l) => ({ value: l, label: t(`notifications.level.${l}`) }));
  const events = (view?.events ?? []).filter((e) => !changedOnly || e.overridden);
  const modules = [...new Set(events.map((e) => moduleGroup(e.module)))];
  const moduleName = (m: string) => (KNOWN_MODULES.has(m) ? t(`notifications.module.${m}` as MessageKey) : m);
  return (
    <Section
      id={settingsAnchorId("events")}
      title={t("notifications.events.title")}
      hint={t("notifications.events.hint")}
      source="host"
      actions={
        <label className="flex items-center gap-2 text-xs text-muted">
          {t("notifications.events.changedOnly")}
          <Toggle checked={changedOnly} onChange={setChangedOnly} label={t("notifications.events.changedOnly")} />
        </label>
      }
    >
      {!view && <Loading rows={4} />}
      {view && (
        <>
          <SettingRow label={t("notifications.preset")} hint={current === LEGACY_PRESET ? t("notifications.preset.legacyNote") : undefined}>
            <Segmented value={current} options={options} disabled={busy} onChange={(id) => pickable(id) && patch({ events: { preset: id } })} />
          </SettingRow>
          {events.length === 0 && <EmptyState>{t("notifications.events.none")}</EmptyState>}
          {modules.map((m) => (
            <div key={m}>
              <div className="pt-3 pb-1 text-[11px] font-medium text-subtle">{moduleName(m)}</div>
              {events
                .filter((e) => moduleGroup(e.module) === m)
                .map((e) => (
                  <EventRow key={e.id} event={e} locale={locale} levels={levels} disabled={busy} onLevel={(level) => patch({ events: { levels: { [e.id]: level } } })} />
                ))}
            </div>
          ))}
        </>
      )}
    </Section>
  );
}

/** One event: a settings row whose ↺ (reset slot) drops the override, like every defaultable row. */
function EventRow({ event, locale, levels, disabled, onLevel }: { event: EventView; locale: string; levels: { value: NotificationLevel; label: string }[]; disabled: boolean; onLevel(level: NotificationLevel | null): void }) {
  const { t } = useI18n();
  const terms = resolveTerms(useTermOverrides(), locale as TermLocale);
  const title = retermDaemonText(localText(event.title, locale), terms, locale as TermLocale) || event.id;
  const description = retermDaemonText(localText(event.description, locale), terms, locale as TermLocale);
  return (
    <SettingRow
      label={
        <span className="flex items-center gap-1.5" title={`${event.id}${description ? ` — ${description}` : ""}`}>
          <span className="truncate">{title}</span>
          {event.overridden && <span className="shrink-0 rounded bg-accent/15 px-1 text-[10.5px] text-accent">{t("notifications.events.changed")}</span>}
        </span>
      }
      hint={description || undefined}
      reset={<ResetButton title={t("notifications.events.reset")} disabled={disabled || !event.overridden} onClick={() => onLevel(null)} />}
    >
      <Select value={event.level} width="w-28" options={levels} disabled={disabled} label={title} onChange={(level) => onLevel(level)} />
    </SettingRow>
  );
}

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
      source="local"
      actions={items.map(({ item }) => (
        <Button key={item.id} disabled={item.available() !== "ok" || off[item.method]} onClick={() => testMethod(item.method, text)}>
          {t(`notifications.device.test.${item.method}` as MessageKey)}
        </Button>
      ))}
    >
      <SettingRow label={t("notifications.device.permission")}>
        <span className={`text-xs ${permission === "ok" ? "text-muted" : "text-warn"}`}>{t(`notifications.device.${permission}` as MessageKey)}</span>
        {permission === "needsPermission" && desktop?.requestPermission && (
          <Button onClick={() => void desktop.requestPermission?.().finally(() => rerender((n) => n + 1))}>{t("notifications.device.allow")}</Button>
        )}
      </SettingRow>
      {items.map(({ item }) => {
        const available = item.available();
        return (
          <SettingRow key={item.id} label={t(item.titleKey)} hint={available === "unsupported" ? t("notifications.device.unsupported") : undefined}>
            <Toggle checked={!off[item.method]} disabled={available === "unsupported"} label={t(item.titleKey)} onChange={(v) => void setDeviceOff(item.method, !v)} />
          </SettingRow>
        );
      })}
    </Section>
  );
}

// ---------- 4 新智能体的提醒 ----------

/** The level a new agent starts with (`newSessionNotification`), worded like the title-bar bell. */
function NewAgentSection() {
  const { t } = useI18n();
  const { settings, patch } = useGlobalSettings();
  if (!settings?.newSessionNotification) return null;
  return (
    <Section id={settingsAnchorId("newAgentLevel")} title={t("agent-config.defaults.notification")} hint={t("agent-config.defaults.notificationHint")} source="host">
      <SettingRow label={t("notify.newAgentLevel")}>
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

// ---------- 5 按项目通知 ----------

function MuteSection({ levels }: { levels: TargetLevels }) {
  const { t } = useI18n();
  const { view } = levels;
  const hostId = useTargetHostId();
  const projects = useTargetSidebar()?.projects?.projects ?? [];
  const icons = useUiPrefs().projectIcons;
  const overrides = view?.settings.projectOverrides ?? {};
  const row = (id: string, title: string, leading: React.ReactNode) => (
    <ListRow key={id} leading={leading} title={title} actions={<Toggle label={title} disabled={!view} checked={overrides[id] !== "mute"} onChange={() => void levels.patch(projectMutePatch(view, id)).catch(() => {})} />} />
  );
  return (
    <Section id={settingsAnchorId("mute")} title={t("notifications.mute.title")} hint={t("notifications.mute.hint")} source="host">
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
