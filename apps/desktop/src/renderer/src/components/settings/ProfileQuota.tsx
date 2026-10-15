// Settings → Profiles → 额度. Official-login profiles (ChatGPT / Claude): read-only — cutex reads
// the official source itself. API-key profiles: current gauges + quota reader config (cutex
// `/quota-config`): a named reader (cutex profile-generic-switches; older cutex: a host-based auto
// preset) or custom HTTP readers.
import { useEffect, useState } from "react";
import type { QuotaConfigView, QuotaReaderConfig } from "../../../../shared/ipc";
import { api } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { FIELD_W } from "../../lib/fieldWidths";
import { defaultQuotaLabel, gaugeErrors, isQuotaReaderPreset, latestObservedAt, observedClock, PROFILE_GENERIC_SWITCHES_FEATURE, QUOTA_CLAUDE_FEATURE, QUOTA_NATIVE_FEATURE, quotaLabelProblem, quotaPresetChoices, quotaPresetLabel, quotaReadersOff, readerFollowsBaseUrl, usesQuotaReaders, withPrimaryEnabled } from "../../lib/quota";
import { GaugeChip } from "../GaugeBar";
import { Button, Loading, NumberField, RefreshButton, SettingRow, Section, Segmented, Select, TextInput, Toggle } from "./Form";
import { useTargetFeatures, useTargetLoadQuota, useTargetQuotas } from "../../lib/targetHost";

const MODES: QuotaReaderConfig["mode"][] = ["remaining_and_limit", "used_and_limit", "remaining_percent", "used_percent", "balance"];
const RESET_FORMATS: QuotaReaderConfig["reset_format"][] = ["rfc3339", "unix_seconds", "unix_millis"];

function blankReader(label: string): QuotaReaderConfig {
  return {
    enabled: true,
    url: "",
    auth: "profile_api_key",
    label,
    refresh_seconds: 60,
    mode: "remaining_and_limit",
    value_pointer: "/rate_limits/1/remaining",
    limit_pointer: "/rate_limits/1/limit",
    reset_pointer: "/rate_limits/1/reset_at",
    reset_format: "rfc3339",
    window_label: null,
  };
}

function ReaderFields({ reader, onChange, endpointLocked, isExtra }: { reader: QuotaReaderConfig; onChange(r: QuotaReaderConfig): void; endpointLocked: boolean; isExtra: boolean }) {
  const { t } = useI18n();
  const set = <K extends keyof QuotaReaderConfig>(key: K, value: QuotaReaderConfig[K]) => onChange({ ...reader, [key]: value });
  const balance = reader.mode === "balance";
  // Empty is fine when the window name can stand in (saved as 7d); anything else must pass cutex's rule.
  const labelProblem = quotaLabelProblem(reader.label, reader.window_label);
  return (
    <>
      <SettingRow label={t("agent-config.quota.enabled")}>
        <Toggle checked={reader.enabled} onChange={(v) => set("enabled", v)} />
      </SettingRow>
      <SettingRow
        label={t("agent-config.quota.label")}
        hint={labelProblem ? <span className="text-danger">{t(labelProblem === "bad" ? "agent-config.quota.labelBad" : "agent-config.quota.labelMissing")}</span> : t("agent-config.quota.labelHint")}
      >
        <TextInput width="w-24" value={reader.label} placeholder={defaultQuotaLabel(reader.window_label) || undefined} onChange={(v) => set("label", v)} />
        <TextInput width="w-20" placeholder="5h / 7d" value={reader.window_label ?? ""} onChange={(v) => set("window_label", v || null)} />
      </SettingRow>
      {!endpointLocked && (
        <>
          <SettingRow label="URL" hint={isExtra ? t("agent-config.quota.urlExtraHint") : undefined}>
            <TextInput width="w-80" mono value={reader.url} placeholder={isExtra ? t("agent-config.quota.samePrimary") : "https://…/usage"} onChange={(v) => set("url", v)} />
          </SettingRow>
          <SettingRow label={t("agent-config.quota.auth")}>
            <Select
              value={reader.auth}
              options={[
                { value: "profile_api_key", label: t("agent-config.quota.authKey") },
                { value: "none", label: t("agent-config.quota.authNone") },
              ]}
              onChange={(v) => set("auth", v)}
            />
          </SettingRow>
          <SettingRow label={t("agent-config.quota.mode")}>
            <Select value={reader.mode} options={MODES.map((m) => ({ value: m, label: t(`agent-config.quota.mode.${m}` as MessageKey) }))} onChange={(v) => set("mode", v)} />
          </SettingRow>
          <SettingRow label={t("agent-config.quota.valuePointer")}>
            <TextInput mono value={reader.value_pointer} onChange={(v) => set("value_pointer", v)} />
          </SettingRow>
          {!balance && reader.mode.endsWith("_limit") && (
            <SettingRow label={t("agent-config.quota.limitPointer")}>
              <TextInput mono value={reader.limit_pointer} onChange={(v) => set("limit_pointer", v)} />
            </SettingRow>
          )}
          {!balance && (
            <SettingRow label={t("agent-config.quota.resetPointer")}>
              <TextInput mono width="w-48" value={reader.reset_pointer} onChange={(v) => set("reset_pointer", v)} />
              <Select width={FIELD_W.short} value={reader.reset_format} options={RESET_FORMATS.map((f) => ({ value: f, label: f }))} onChange={(v) => set("reset_format", v)} />
            </SettingRow>
          )}
          <SettingRow label={t("agent-config.quota.refresh")}>
            <NumberField value={reader.refresh_seconds} range={[0, 86_400]} unit="s" onCommit={(v) => set("refresh_seconds", v ?? 0)} />
          </SettingRow>
        </>
      )}
    </>
  );
}

/** The profile's gauges as chips (text + bar); `align` for the overview card vs right-aligned rows. */
export function GaugeList({ profile, empty, align = "end" }: { profile: string; empty: string; align?: "start" | "end" }) {
  const gauges = useTargetQuotas()[profile];
  if (gauges === undefined) return <span className="text-xs text-subtle">…</span>;
  if (gauges.length === 0) return <span className="text-xs text-subtle">{empty}</span>;
  return (
    <span className={`flex flex-wrap gap-x-4 gap-y-1.5 ${align === "end" ? "justify-end" : "justify-start"}`}>
      {gauges.map((g) => (
        <GaugeChip key={g.id} gauge={g} />
      ))}
    </span>
  );
}

/** "查询于 HH:MM" for the profile's newest gauge, or null. */
function useQuotaObserved(profile: string): string | null {
  const { t } = useI18n();
  const gauges = useTargetQuotas()[profile];
  const at = latestObservedAt(gauges ?? []);
  return at === null ? null : t("composer.quota.observedAt", { at: observedClock(at) });
}

/** `errors`: also print cutex's reason under a gauge it could not read (the chip only shows "!"). */
function GaugesRow({ profile, label, empty, errors = false }: { profile: string; label: string; empty: string; errors?: boolean }) {
  const observed = useQuotaObserved(profile);
  const gauges = useTargetQuotas()[profile];
  const failed = errors ? gaugeErrors(gauges ?? []) : [];
  return (
    <SettingRow label={label} hint={observed ?? undefined}>
      <span className="max-w-96">
        <GaugeList profile={profile} empty={empty} />
        {failed.map((line) => (
          <span key={line} className="mt-1 block text-right text-xs break-words text-danger">
            {line}
          </span>
        ))}
      </span>
    </SettingRow>
  );
}

/** 额度 for official-login profiles: nothing to configure. */
export function OfficialQuotaSection({ profile, claude }: { profile: string; claude: boolean }) {
  const { t } = useI18n();
  const loadQuota = useTargetLoadQuota();
  const native = useTargetFeatures().has(QUOTA_NATIVE_FEATURE);
  const claudeCutex = useTargetFeatures().has(QUOTA_CLAUDE_FEATURE);
  const label = claude ? (claudeCutex ? "agent-config.quota.claudeCutex" : "agent-config.quota.claude") : "agent-config.quota.official";
  const empty = claude ? (claudeCutex ? "agent-config.quota.officialEmpty" : "agent-config.quota.claudeEmpty") : native ? "agent-config.quota.officialEmpty" : "agent-config.quota.officialPending";
  return (
    <Section title={t("agent-config.quota.title")} actions={<RefreshButton label={t("composer.quota.refresh")} onClick={() => void loadQuota(profile, true)} />}>
      <GaugesRow profile={profile} label={t(label)} empty={t(empty)} />
    </Section>
  );
}

/** 额度 for API-key profiles; the config draft is saved by the editor's save bar. */
export function QuotaConfigSection({ profile, draft, setDraft }: { profile: string; draft: QuotaConfigView | null; setDraft(v: QuotaConfigView): void }) {
  const { t } = useI18n();
  const loadQuota = useTargetLoadQuota();
  const presetLabel = (preset: string) => quotaPresetLabel(t, preset);
  // cutex profile-generic-switches: explicit readers; `auto` is only a legacy leftover to replace.
  const readers = usesQuotaReaders(draft, useTargetFeatures().has(PROFILE_GENERIC_SWITCHES_FEATURE));
  const auto = draft?.preset === "auto";
  const reader = draft !== null && readers && isQuotaReaderPreset(draft.preset);
  const endpointLocked = auto || reader;
  const presetHint = !draft
    ? undefined
    : readers
      ? auto ? (
          <>
            <span className="block text-danger">{t("agent-config.quota.legacyAuto")}</span>
            {draft.presetError && <span className="block text-subtle">{draft.presetError}</span>}
          </>
        ) : reader ? (
          <>
            {draft.presetError && <span className="block text-danger">{draft.presetError}</span>}
            {t(readerFollowsBaseUrl(draft.preset) ? "agent-config.quota.readerFollowsBaseUrl" : "agent-config.quota.readerFixed")}
          </>
        ) : (
          t("agent-config.quota.customHint")
        )
      : auto ? (
          <>
            {/* cutex re-resolves the reader when the Base URL changes: "none for this host" shows here. */}
            {draft.presetError && <span className="block text-danger">{draft.presetError}</span>}
            {t("agent-config.quota.autoHint")}
          </>
        ) : (
          t("agent-config.quota.customHint")
        );
  return (
    <Section title={t("agent-config.quota.title")} hint={t("agent-config.quota.hint")} actions={<RefreshButton label={t("composer.quota.refresh")} onClick={() => void loadQuota(profile, true)} />}>
      {/* No reader on: cutex reads nothing, so say so and offer the switch (saved by the save bar). */}
      {draft && quotaReadersOff(draft) ? (
        <SettingRow label={t("agent-config.quota.current")}>
          <span className="text-xs text-subtle">{t("agent-config.quota.currentOff")}</span>
          <Button onClick={() => setDraft(withPrimaryEnabled(draft))}>{t("agent-config.quota.enableNow")}</Button>
        </SettingRow>
      ) : (
        <GaugesRow profile={profile} label={t("agent-config.quota.current")} empty={t("agent-config.quota.currentEmpty")} errors />
      )}
      {!draft ? (
        <Loading rows={1} />
      ) : (
        <>
          <SettingRow label={t("agent-config.quota.preset")} hint={presetHint}>
            {readers ? (
              <Select
                width="w-64"
                value={draft.preset}
                options={[
                  // The legacy `auto` stays visible (disabled) until the user picks a source.
                  ...(auto ? [{ value: "auto", label: t("agent-config.quota.pickReader"), disabled: true }] : []),
                  ...quotaPresetChoices(draft).map((value) => ({ value, label: presetLabel(value) })),
                ]}
                onChange={(preset) => setDraft({ ...draft, preset })}
              />
            ) : (
              <Segmented
                value={draft.preset}
                options={[
                  { value: "auto", label: t("agent-config.quota.auto") },
                  { value: "custom", label: t("agent-config.quota.custom") },
                ]}
                onChange={(preset) => setDraft({ ...draft, preset })}
              />
            )}
          </SettingRow>
          <ReaderFields reader={draft.primary} endpointLocked={endpointLocked} isExtra={false} onChange={(primary) => setDraft({ ...draft, primary })} />
          {/* Extras: with readers next to any explicit source (an empty URL inherits the reader's endpoint). */}
          {!auto &&
            draft.extras.map((extra, i) => (
              <div key={i} className="border-b border-border last:border-b-0">
                <div className="flex items-center pt-3 pb-1 text-xs font-medium text-muted">
                  {t("agent-config.quota.extra", { n: i + 1 })}
                  <span className="ml-auto">
                    <Button onClick={() => setDraft({ ...draft, extras: draft.extras.filter((_, j) => j !== i) })}>{t("agent-config.remove")}</Button>
                  </span>
                </div>
                <ReaderFields reader={extra} endpointLocked={false} isExtra onChange={(r) => setDraft({ ...draft, extras: draft.extras.map((x, j) => (j === i ? r : x)) })} />
              </div>
            ))}
          {!auto && (
            <div className="py-2.5">
              <Button disabled={draft.extras.length >= 8} onClick={() => setDraft({ ...draft, extras: [...draft.extras, blankReader(draft.primary.label)] })}>
                + {t("agent-config.quota.addExtra")}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
