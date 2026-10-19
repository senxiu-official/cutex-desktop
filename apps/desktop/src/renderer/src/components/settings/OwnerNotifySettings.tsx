// Settings → 通知 → 主人通知 (cutex `/v2/settings` `ownerNotify`, capability owner-messages): how an
// agent's `owner_notify` message reaches the owner — delivery matrix (level × channel), big alert
// sound, who gets the tool, rate limits, per-agent mute / force. Agents never see any of this.
// The delivery matrix and the sound only apply on hosts that still use them: a cutex without
// notification-levels, or an older cutex (no notification-presets-no-legacy) whose methods preset is
// still `legacy` (its legacy matrix is derived from them). Everywhere else the 等级 → 通知方式 table
// decides and this card shows one line pointing there (cutex removed the legacy preset 2026-10-15).
import { useState } from "react";
import { X } from "lucide-react";
import { OWNER_NOTIFY_CHANNELS, OWNER_NOTIFY_LEVELS, type OwnerNotifyAgentOverride, type OwnerNotifyChannel, type OwnerNotifySettings, type OwnerNotifyToolAudience } from "@cutex-desktop/protocol";
import type { GlobalSettings } from "../../../../shared/ipc";
import { ownerNotifyPatch, toggleChannel, type OwnerNotifyDraft } from "../../../../shared/ownerNotify";
import { useI18n, type MessageKey } from "../../i18n";
import { Button, Checkbox, ErrorNote, IconButton, Loading, NumberField, ResetButton, Section, Select, SettingRow, Toggle } from "./Form";
import { useTargetApi, useTargetFeatures, useTargetSidebar } from "../../lib/targetHost";
import { LEGACY_PRESET, NOTIFICATION_LEVELS_FEATURE, NOTIFICATION_PRESETS_NO_LEGACY_FEATURE } from "../../../../shared/notificationLevels";
import { useNotificationLevels } from "../../lib/notificationLevelsStore";
import { settingsAnchorId } from "../../lib/settingsNav";

const AUDIENCES: OwnerNotifyToolAudience[] = ["ownerFacing", "everyone", "directors", "none"];
/** cutex's default audience for owner_notify (docs/research/notification-levels.md §4.3). */
const DEFAULT_AUDIENCE: OwnerNotifyToolAudience = "ownerFacing";

export function OwnerNotifySection({ settings, onSettings }: { settings: GlobalSettings | null; onSettings(next: GlobalSettings): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const on = settings?.ownerNotify;
  const features = useTargetFeatures();
  const levelsSupported = features.has(NOTIFICATION_LEVELS_FEATURE);
  const noLegacy = features.has(NOTIFICATION_PRESETS_NO_LEGACY_FEATURE);
  const { view } = useNotificationLevels();
  const legacy = !levelsSupported || (!noLegacy && view?.settings.methodPreset === LEGACY_PRESET);
  const save = async (draft: OwnerNotifyDraft) => {
    if (!on) return;
    const patch = ownerNotifyPatch(on, draft);
    if (!patch) return;
    setError(null);
    try {
      onSettings(await api.patchOwnerNotify(patch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    // Who gets the owner_notify tool changes what agents can call (at their next start): tagged like that.
    <Section title={t("owner-notify.settings.ownerNotify.title")} hint={t("owner-notify.hint")} source="host" agents="next" tools={[{ name: "owner_notify", desc: t("owner-notify.toolDesc") }]}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!settings && !error && <Loading rows={3} />}
      {on && (
        <>
          {/* Newer hosts: the page's 通知方式 decides; no row pointing there (owner 2026-10-19). */}
          {legacy && (
            <>
              <DeliveryMatrix settings={on} note={levelsSupported} onChange={(delivery) => void save({ delivery })} />
              <SettingRow label={t("owner-notify.sound")} hint={t("owner-notify.soundHint")}>
                <Toggle checked={on.bigAlertSound} onChange={(v) => void save({ bigAlertSound: v })} />
              </SettingRow>
            </>
          )}
          <SettingRow
            label={t("owner-notify.audience")}
            hint={t("owner-notify.audienceHint")}
            reset={<ResetButton disabled={on.toolAudience === DEFAULT_AUDIENCE} onClick={() => void save({ toolAudience: DEFAULT_AUDIENCE })} />}
          >
            <Select
              value={on.toolAudience}
              width="w-72"
              options={(on.toolAudienceOptions?.length ? on.toolAudienceOptions : AUDIENCES).map((v) => ({ value: v, label: t(`owner-notify.audience.${v}` as MessageKey) }))}
              onChange={(v) => void save({ toolAudience: v })}
            />
          </SettingRow>
          <SettingRow label={t("owner-notify.perHour")} hint={t("owner-notify.perHourHint")}>
            <NumberField value={on.rateLimit.perHour} range={[1, 1000]} unit={t("owner-notify.perHourUnit")} onCommit={(v) => v !== null && void save({ rateLimit: { perHour: v } })} />
          </SettingRow>
          <SettingRow label={t("owner-notify.urgentPerHour")} hint={t("owner-notify.urgentPerHourHint")}>
            <NumberField value={on.rateLimit.urgentPerHour} range={[0, 100]} unit={t("owner-notify.perHourUnit")} onCommit={(v) => v !== null && void save({ rateLimit: { urgentPerHour: v } })} />
          </SettingRow>
          {/* 单个智能体 (mute / force) waits for a sub-page with a searchable agent list (owner 2026-10-19); stored overrides still apply. */}
        </>
      )}
    </Section>
  );
}

function DeliveryMatrix({ settings, note, onChange }: { settings: OwnerNotifySettings; note: boolean; onChange(delivery: OwnerNotifyDraft["delivery"]): void }) {
  const { t } = useI18n();
  const phoneOff = !settings.phonePaired;
  const isDefault = OWNER_NOTIFY_LEVELS.every((l) => [...(settings.delivery[l] ?? [])].sort().join() === [...(settings.deliveryDefault?.[l] ?? [])].sort().join());
  return (
    <div className="border-b border-border py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm">{t("owner-notify.delivery")}</div>
          <div className="text-xs text-subtle">{t("owner-notify.deliveryHint")}</div>
          {note && <div className="text-xs text-subtle">{t("owner-notify.legacyNote")}</div>}
        </div>
        {!isDefault && settings.deliveryDefault && <Button onClick={() => onChange(settings.deliveryDefault)}>{t("owner-notify.resetDelivery")}</Button>}
      </div>
      <table className="w-full max-w-md text-sm">
        <thead>
          <tr className="text-xs text-subtle">
            <th className="py-1 text-left font-normal" />
            {OWNER_NOTIFY_CHANNELS.map((c) => (
              <th key={c} className="px-2 py-1 text-center font-normal" title={c === "phone" && phoneOff ? t("owner-notify.phoneUnpaired") : undefined}>
                {t(`owner-notify.channel.${c}` as MessageKey)}
                {c === "phone" && phoneOff && <div className="text-[10.5px] text-warn">{t("owner-notify.phoneUnpaired")}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {OWNER_NOTIFY_LEVELS.map((level) => (
            <tr key={level} className="border-t border-border/60">
              <td className="py-1.5">{t(`ownerNotify.level.${level}` as MessageKey)}</td>
              {OWNER_NOTIFY_CHANNELS.map((c: OwnerNotifyChannel) => {
                const checked = (settings.delivery[level] ?? []).includes(c);
                const label = `${t(`ownerNotify.level.${level}` as MessageKey)} · ${t(`owner-notify.channel.${c}` as MessageKey)}`;
                return (
                  <td key={c} className="px-2 py-1.5 text-center">
                    <span className="inline-flex align-middle">
                      <Checkbox label={label} checked={checked} disabled={c === "phone" && phoneOff && !checked} onChange={(on) => onChange({ [level]: toggleChannel(settings.delivery[level] ?? [], c, on) })} />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Per-agent mute / force: a short list plus an agent picker. */
export function Overrides({ overrides, onChange }: { overrides: Record<string, OwnerNotifyAgentOverride>; onChange(next: Record<string, OwnerNotifyAgentOverride>): void }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  const agents = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
  const nameOf = (id: string) => agents.find((a) => a.cutexSessionId === id)?.displayName ?? id;
  const free = (sidebar?.active ?? []).filter((a) => !(a.cutexSessionId in overrides)).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const [pick, setPick] = useState("");
  const [mode, setMode] = useState<OwnerNotifyAgentOverride>("mute");
  const modes = (["mute", "force"] as const).map((v) => ({ value: v, label: t(`owner-notify.override.${v}`) }));
  return (
    <div className="py-2.5">
      <div className="text-sm">{t("owner-notify.overrides")}</div>
      <div className="mb-1.5 text-xs text-subtle">{t("owner-notify.overridesHint")}</div>
      {Object.entries(overrides).map(([id, v]) => (
        <div key={id} className="flex items-center gap-2 border-t border-border/60 py-1.5">
          <span className="min-w-0 flex-1 truncate text-sm">{nameOf(id)}</span>
          <Select value={v} width="w-36" options={modes} onChange={(next) => onChange({ ...overrides, [id]: next })} label={nameOf(id)} />
          <IconButton
            label={t("owner-notify.overrideRemove")}
            onClick={() => {
              const { [id]: _drop, ...rest } = overrides;
              onChange(rest);
            }}
          >
            <X size={14} />
          </IconButton>
        </div>
      ))}
      <div className="flex items-center gap-2 border-t border-border/60 pt-2">
        <Select
          value={pick}
          width="min-w-0 flex-1"
          label={t("owner-notify.overrideAgent")}
          options={[{ value: "", label: t("owner-notify.overrideAgent") }, ...free.map((a) => ({ value: a.cutexSessionId, label: a.displayName }))]}
          onChange={setPick}
        />
        <Select value={mode} width="w-36" options={modes} onChange={setMode} label={t("owner-notify.overrides")} />
        <Button
          disabled={!pick}
          onClick={() => {
            onChange({ ...overrides, [pick]: mode });
            setPick("");
          }}
        >
          {t("owner-notify.overrideAdd")}
        </Button>
      </div>
    </div>
  );
}
