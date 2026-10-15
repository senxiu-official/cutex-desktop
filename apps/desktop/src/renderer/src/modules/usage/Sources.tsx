// 额外目录 (cutex usage-external-sources): the owner's own Claude Code / Codex CLI / ZCode directories whose
// runs never went through cutex. cutex reads them (session logs; ZCode: its usage database, model_usage
// only) and keeps the rows apart; this card only edits the list and shows each one's scan status.
import { useState, type ReactNode } from "react";
import type { CutexRefusal } from "../../../../shared/ipc";
import { USAGE_SOURCE_KIND_DEFAULTS, USAGE_SOURCES_FEATURE, type UsageSource, type UsageSourceBilling, type UsageSourceKind, type UsageSourceResult, type UsageSourcesView } from "../../../../shared/usageSources";
import { useI18n } from "../../i18n";
import { AddButton, ArmedRemove, Button, ErrorNote, Loading, Notice, RefreshButton, Select, TextInput, Toggle } from "../../components/settings/Form";
import { ProviderIcon } from "../../components/ProviderIcon";
import { modelProvider } from "../../lib/provider";
import { useTargetApi } from "../../lib/targetHost";
import { availableKinds, scanClock, suggestedPath } from "./sourceHelpers";

const CARD = "rounded-xl border border-border bg-surface";

function KindIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  // ZCode is Zhipu's: the GLM logo.
  return <ProviderIcon provider={kind === "zcode" ? "glm" : modelProvider(kind === "codex" ? "codex" : "claude")} name={kind} size={size} />;
}

function useRefusalText() {
  const { t } = useI18n();
  return (e: CutexRefusal) =>
    e.code === "usage_source_overlaps_cutex"
      ? t("usage.sources.overlapsCutex")
      : e.code === "usage_source_overlaps_source"
        ? t("usage.sources.overlapsSource")
        : e.code === "usage_source_disabled"
          ? t("usage.sources.disabledError")
          : e.message;
}

function Status({ source }: { source: UsageSource }) {
  const { t } = useI18n();
  const s = source.status;
  if (!source.supported) return <span className="text-warn">{t("usage.sources.unsupportedKind")}</span>;
  if (!source.enabled) return <span>{t("usage.sources.off")}</span>;
  if (s.scanning) return <span>{t("usage.sources.scanning")}</span>;
  if (!s.lastScanAt) return <span>{t("usage.sources.notScanned")}</span>;
  return (
    <span className="tabular-nums">
      {t("usage.sources.status", { time: scanClock(s.lastScanAt), files: s.files, rows: s.rows })}
      {s.errors > 0 && (
        <span className="text-danger" title={s.lastError ?? undefined}>
          {" · "}
          {t("usage.sources.errors", { n: s.errors })}
        </span>
      )}
    </span>
  );
}

function AddForm({ view, onDone, onCancel }: { view: UsageSourcesView | null; onDone(): void; onCancel(): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const refusal = useRefusalText();
  const kinds = availableKinds(view);
  const [kind, setKind] = useState<UsageSourceKind>(() => kinds.find((k) => suggestedPath(view, k)) ?? "claude-code");
  const [path, setPath] = useState(() => suggestedPath(view, kind));
  const [label, setLabel] = useState("");
  const [billing, setBilling] = useState<UsageSourceBilling>("subscription");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeKind = (k: UsageSourceKind) => {
    // Swap the suggested directory along with the kind unless the owner typed one.
    if (!path || path === suggestedPath(view, kind)) setPath(suggestedPath(view, k));
    setKind(k);
  };
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.addUsageSource({ kind, path, label: label.trim() || undefined, billing });
      if (r.ok) onDone();
      else setError(refusal(r.error));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const field = "grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3";
  return (
    <div className="-mx-4 space-y-2 border-t border-border bg-surface-2/40 px-4 py-3 first:border-t-0">
      <div className={field}>
        <span className="text-xs text-muted">{t("usage.sources.kind")}</span>
        <Select width="w-44" value={kind} options={kinds.map((k) => ({ value: k, label: t(`usage.sources.kind.${k}`) }))} onChange={changeKind} label={t("usage.sources.kind")} />
      </div>
      <div className={field}>
        <span className="text-xs text-muted">{t("usage.sources.path")}</span>
        <TextInput mono width="w-full" value={path} onChange={setPath} placeholder={USAGE_SOURCE_KIND_DEFAULTS[kind].path} label={t("usage.sources.path")} />
      </div>
      {kind === "zcode" && (
        <div className={field}>
          <span />
          <p className="text-xs text-subtle">{t("usage.sources.kindHint.zcode")}</p>
        </div>
      )}
      <div className={field}>
        <span className="text-xs text-muted">{t("usage.sources.label")}</span>
        <TextInput width="w-64" value={label} onChange={setLabel} maxLength={80} placeholder={USAGE_SOURCE_KIND_DEFAULTS[kind].label} label={t("usage.sources.label")} />
      </div>
      <div className={field}>
        <span className="text-xs text-muted">{t("usage.sources.billing")}</span>
        <Select width="w-64" value={billing} options={(["subscription", "api"] as const).map((b) => ({ value: b, label: t(`usage.sources.billing.${b}`) }))} onChange={setBilling} label={t("usage.sources.billing")} />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onCancel}>{t("settings.cancel")}</Button>
        <Button primary disabled={busy || !path.trim()} onClick={() => void add()}>
          {t("usage.sources.add")}
        </Button>
      </div>
    </div>
  );
}

function SourceRow({ source, onChanged }: { source: UsageSource; onChanged(): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const refusal = useRefusalText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (call: () => Promise<UsageSourceResult | { ok: true; purged: boolean } | { ok: false; error: CutexRefusal }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      if (!r.ok) setError(refusal(r.error));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="-mx-4 border-t border-border px-4 py-2.5 first:border-t-0">
      <div className="flex min-h-7 items-center gap-2.5">
        <KindIcon kind={source.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="truncate font-medium">{source.label}</span>
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted" title={source.billing === "subscription" ? t("usage.sources.subscriptionHint") : undefined}>
              {t(source.billing === "subscription" ? "usage.sources.tag.subscription" : "usage.sources.tag.api")}
            </span>
          </div>
          <div className="truncate font-mono text-xs text-subtle" title={source.path}>
            {source.path}
          </div>
          <div className="truncate text-xs text-subtle">
            <Status source={source} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Select
            width="w-28"
            value={source.billing}
            disabled={busy}
            options={(["subscription", "api"] as const).map((b) => ({ value: b, label: t(`usage.sources.tag.${b}`) }))}
            onChange={(billing) => void run(() => api.patchUsageSource(source.id, { billing }))}
            label={t("usage.sources.billing")}
          />
          <Toggle checked={source.enabled} disabled={busy || !source.supported} onChange={(enabled) => void run(() => api.patchUsageSource(source.id, { enabled }))} label={t("usage.sources.enabled")} />
          <RefreshButton label={t("usage.sources.rescan")} disabled={busy || !source.enabled || !source.supported || source.status.scanning} onClick={() => void run(() => api.rescanUsageSource(source.id))} />
          <ArmedRemove title={t("usage.sources.remove")} armedLabel={t("usage.sources.removeArmed")} disabled={busy} onRemove={() => void run(() => api.deleteUsageSource(source.id, true))} />
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/**
 * `view` undefined = loading, null = this cutex has no extra sources route. `host` / `hostHint`: 用量
 * 「全部主机」's edit host picker in the header (directories are one host's) and why it is there.
 */
export function UsageSources({ view, error, unsupported, onChanged, host, hostHint }: { view: UsageSourcesView | null | undefined; error: string | null; unsupported: boolean; onChanged(): void; host?: ReactNode; hostHint?: string }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  // A known feature list without extra sources = an older cutex: keep the card in place so the feature is findable.
  if (view === null)
    return !unsupported ? null : (
      <section className="mb-6">
        <div className="mb-1 flex h-7 items-center gap-2">
          <h3 className="text-sm font-semibold">{t("usage.sources.title")}</h3>
          {host && <span className="ml-auto">{host}</span>}
        </div>
        <Notice tone="info">{t("modules.needsUpgrade", { feature: USAGE_SOURCES_FEATURE })}</Notice>
      </section>
    );
  return (
    <section className="mb-6">
      <div className="mb-1 flex h-7 items-center gap-2">
        <h3 className="text-sm font-semibold">{t("usage.sources.title")}</h3>
        <span className="ml-auto flex items-center gap-2">
          {host}
          {!adding && (
            <AddButton disabled={!view} onClick={() => setAdding(true)}>
              {t("usage.sources.addDir")}
            </AddButton>
          )}
        </span>
      </div>
      <p className="mb-2 text-xs text-subtle">
        {t("usage.sources.hint", { min: Math.round((view?.scanIntervalSecs ?? 300) / 60) })}
        {hostHint && ` ${hostHint}`}
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className={`${CARD} px-4`}>
        {view === undefined && <Loading rows={2} />}
        {view && view.sources.length === 0 && !adding && <div className="py-3 text-xs text-subtle">{t("usage.sources.empty")}</div>}
        {view?.sources.map((s) => <SourceRow key={s.id} source={s} onChanged={onChanged} />)}
        {adding && view && (
          <AddForm
            view={view}
            onCancel={() => setAdding(false)}
            onDone={() => {
              setAdding(false);
              onChanged();
            }}
          />
        )}
      </div>
    </section>
  );
}
