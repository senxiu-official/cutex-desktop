// Settings → Agent capabilities → 插件: codex plugins and marketplaces on the shared CODEX_HOME via
// cutex `POST /v2/codex/requests` (capability `codex-plugins`; DESIGN §4.5, gap 21;
// docs/research/codex-plugins.md). cutex projects the shared [plugins] into every Codex agent at
// launch (settings `codexConfigFollowShared`, FollowSharedSection heads this page and MCP / 技能 / 钩子);
// running agents need a restart.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";
import type { HookMetadata, HooksListResponse, MarketplaceAddResponse, MarketplaceUpgradeResponse, PluginDetail, PluginInstallResponse, PluginListResponse } from "@cutex-desktop/protocol/codex/v2";
import { useI18n, type MessageKey } from "../../i18n";
import { groupHooks, hookHandlerText, hookNeedsReview, hookTrustEdits, HOOK_TRUST_TONE } from "../../lib/codexTools";
import {
  CODEX_PLUGINS_FEATURE,
  filterPlugins,
  groupByMarketplace,
  installedRows,
  marketplaceRows,
  marketplaceSources,
  normalizeMarketplaceSource,
  pluginComponents,
  pluginKeyPath,
  pluginRows,
  type PluginRow,
} from "../../lib/codexPlugins";
import { ArmedRemove, Button, EmptyState, ErrorNote, IconButton, Loading, RefreshButton, Section, Segmented, SettingRow, TextInput, Toggle } from "./Form";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { FollowSharedSection } from "./FollowShared";
import { useTargetApi, useTargetFeatures } from "../../lib/targetHost";

type Tab = "installed" | "browse" | "marketplaces";
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" }) {
  const color = tone === "ok" ? "bg-ok/15 text-ok-text" : tone === "warn" ? "bg-warn/15 text-warn-text" : "bg-surface-2 text-muted";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${color}`}>{children}</span>;
}

function ComponentGroup({ label, items, warn }: { label: string; items: string[]; warn?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className={`shrink-0 rounded px-1.5 py-0.5 ${warn ? "bg-warn/15 text-warn-text" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"}`}>
        {label} {items.length}
      </span>
      <span className="min-w-0 break-words font-mono text-muted">{items.join(", ")}</span>
    </div>
  );
}

/** Inline detail (plugin/read) with components, warnings and install / uninstall. */
function PluginDetailPanel({ row, onChanged, onNotice }: { row: PluginRow; onChanged(): void; onNotice(text: string): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .codexRequest("plugin/read", { marketplacePath: row.marketplacePath, pluginName: row.name })
      .then((r) => setDetail((r as { plugin: PluginDetail }).plugin), (e: unknown) => setError(errorText(e)));
  }, [row.marketplacePath, row.name]);
  const parts = detail ? pluginComponents(detail) : null;
  const summary = (c: NonNullable<typeof parts>) =>
    [
      c.mcpServers.length && `${t("codex-config.plugins.comp.mcp")} ${c.mcpServers.length}`,
      c.hooks.length && `${t("codex-config.plugins.comp.hooks")} ${c.hooks.length}`,
      c.skills.length && `${t("codex-config.plugins.comp.skills")} ${c.skills.length}`,
      c.apps.length && `${t("codex-config.plugins.comp.apps")} ${c.apps.length}`,
    ]
      .filter(Boolean)
      .join(" · ") || t("codex-config.plugins.comp.none");
  // Hook trust of an installed plugin: its entries in hooks/list (only enabled plugins are listed).
  const [hooks, setHooks] = useState<HookMetadata[] | null>(null);
  const loadHooks = useCallback(async () => {
    const r = (await api.codexRequest("hooks/list", {})) as HooksListResponse;
    const mine = groupHooks(r.data).find((g) => g.pluginId === row.id)?.hooks ?? [];
    setHooks(mine);
    return mine;
  }, [row.id]);
  useEffect(() => {
    if (row.installed) loadHooks().catch(() => setHooks(null));
  }, [row.installed, loadHooks]);
  const pendingHooks = (hooks ?? []).filter((h) => !h.isManaged && hookNeedsReview(h));
  const trustHooks = async (list: HookMetadata[]) => {
    if (list.length) await api.codexRequest("config/batchWrite", { edits: hookTrustEdits(list) });
    return list.length;
  };
  const trustNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await trustHooks(pendingHooks);
      await loadHooks();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Install confirmation (inline, not window.confirm): what it runs, and "also trust its hooks".
  const [confirming, setConfirming] = useState(false);
  const [alsoTrust, setAlsoTrust] = useState(true);
  const declaredHooks = detail?.hooks.length ?? 0;
  const install = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const r = (await api.codexRequest("plugin/install", { marketplacePath: row.marketplacePath, pluginName: row.name })) as PluginInstallResponse;
      const apps = (r?.appsNeedingAuth ?? []).map((a) => a.name);
      let hookNote = "";
      if (alsoTrust && declaredHooks > 0) {
        try {
          const trusted = await trustHooks((await loadHooks()).filter((h) => !h.isManaged && hookNeedsReview(h)));
          hookNote = trusted ? t("codex-config.plugins.hooksTrusted", { n: trusted }) : t("codex-config.plugins.hooksNotListed");
        } catch (e) {
          hookNote = `${t("codex-config.plugins.hooksNotListed")} (${errorText(e)})`;
        }
      }
      onNotice([t("codex-config.plugins.installedNote", { name: row.displayName }), hookNote, apps.length ? t("codex-config.plugins.needsAuth", { apps: apps.join(", ") }) : ""].filter(Boolean).join(" "));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const [armed, setArmed] = useArmed(row.id);
  const uninstall = async () => {
    setArmed(false);
    setBusy(true);
    setError(null);
    try {
      await api.codexRequest("plugin/uninstall", { pluginId: row.id });
      onNotice(t("codex-config.plugins.uninstalledNote", { name: row.displayName }));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const iface = detail?.summary.interface;
  return (
    <div className="mb-2 space-y-2 rounded-lg bg-surface-2 p-3">
      {!detail && !error && <p className="text-xs text-subtle">{t("codex-config.plugins.loadingDetail")}</p>}
      {detail && (
        <>
          {(detail.description || iface?.longDescription) && <p className="whitespace-pre-wrap text-xs text-foreground">{iface?.longDescription || detail.description}</p>}
          <div className="space-y-1 text-xs text-subtle">
            <div>
              {t("codex-config.plugins.source")}: <span className="font-mono">{row.source || row.marketplace}</span>
            </div>
            {iface?.developerName && <div>{t("codex-config.plugins.developer")}: {iface.developerName}</div>}
            {iface?.websiteUrl && (
              <div>
                {t("codex-config.plugins.website")}:{" "}
                <a className="text-accent hover:underline" href={iface.websiteUrl} target="_blank" rel="noreferrer">
                  {iface.websiteUrl}
                </a>
              </div>
            )}
          </div>
          {parts && (
            <div className="space-y-1">
              <ComponentGroup label={t("codex-config.plugins.comp.mcp")} items={parts.mcpServers} warn />
              <ComponentGroup label={t("codex-config.plugins.comp.hooks")} items={parts.hooks} warn />
              <ComponentGroup label={t("codex-config.plugins.comp.skills")} items={parts.skills} />
              <ComponentGroup label={t("codex-config.plugins.comp.apps")} items={parts.apps} />
              <ComponentGroup label={t("codex-config.plugins.comp.tasks")} items={parts.scheduledTasks} />
              {summary(parts) === t("codex-config.plugins.comp.none") && <p className="text-xs text-subtle">{t("codex-config.plugins.comp.none")}</p>}
            </div>
          )}
          {parts?.runsCode && (
            <p className="flex items-start gap-1.5 text-xs text-warn">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              {t("codex-config.plugins.runsCode")}
            </p>
          )}
          {parts && parts.apps.length > 0 && <p className="text-xs text-subtle">{t("codex-config.plugins.appsNote")}</p>}
          {row.installed && hooks && hooks.length > 0 && (
            <div className="space-y-0.5 border-t border-border pt-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted">{t("codex-config.plugins.hookTrust")}</span>
                {pendingHooks.length > 0 && (
                  <span className="ml-auto">
                    <Button disabled={busy} onClick={() => void trustNow()}>
                      {t("codex-config.hooks.trustAll", { n: pendingHooks.length })}
                    </Button>
                  </span>
                )}
              </div>
              {hooks.map((h) => (
                <div key={h.key} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0">
                    {t(`codex-config.hooks.event.${h.eventName}` as MessageKey)}
                    {h.matcher ? ` · ${h.matcher}` : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-subtle" title={hookHandlerText(h)}>
                    {hookHandlerText(h)}
                  </span>
                  <span className={`shrink-0 ${HOOK_TRUST_TONE[h.trustStatus]}`}>{t(`codex-config.hooks.trust.${h.trustStatus}` as MessageKey)}</span>
                </div>
              ))}
            </div>
          )}
          {confirming && parts && (
            <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-foreground">{t("codex-config.plugins.confirmInstall", { name: row.displayName, parts: summary(parts) })}</p>
              {declaredHooks > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Toggle label={t("codex-config.plugins.trustHooks", { n: declaredHooks })} checked={alsoTrust} onChange={setAlsoTrust} />
                  <span>{t("codex-config.plugins.trustHooks", { n: declaredHooks })}</span>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button onClick={() => setConfirming(false)}>{t("settings.cancel")}</Button>
                <Button primary disabled={busy} onClick={() => void install()}>
                  {t("codex-config.plugins.confirmInstallButton")}
                </Button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            {row.installed ? (
              armed ? (
                <button className={ARMED_FORM_BUTTON} disabled={busy} onClick={() => void uninstall()}>
                  {t("codex-config.plugins.uninstallArmed")}
                </button>
              ) : (
                <Button disabled={busy} onClick={() => setArmed(true)}>
                  {t("codex-config.plugins.uninstall")}
                </Button>
              )
            ) : confirming ? null : (
              <Button primary disabled={busy || !row.installable} onClick={() => setConfirming(true)}>
                {row.installable ? t("codex-config.plugins.install") : t("codex-config.plugins.unavailable")}
              </Button>
            )}
          </div>
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

function PluginList({ rows, open, setOpen, onToggle, onChanged, onNotice, showMarketplace }: { rows: PluginRow[]; open: string | null; setOpen(id: string | null): void; onToggle?(row: PluginRow, enabled: boolean): void; onChanged(): void; onNotice(text: string): void; showMarketplace?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {rows.map((r) => (
        <div key={r.id}>
          <SettingRow label={r.displayName} hint={[showMarketplace ? r.id : r.name !== r.displayName ? r.name : null, r.description].filter(Boolean).join(" · ") || undefined}>
            {r.category && <Badge>{r.category}</Badge>}
            {r.installed && !onToggle && <Badge tone="ok">{t("codex-config.plugins.installedBadge")}</Badge>}
            {r.installed && onToggle && !r.enabled && <Badge>{t("codex-config.plugins.disabledBadge")}</Badge>}
            <button aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className="flex items-center gap-0.5 rounded text-xs whitespace-nowrap text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
              {open === r.id ? t("codex-config.plugins.hide") : t("codex-config.plugins.details")}
              {open === r.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {onToggle && <Toggle label={r.displayName} checked={r.enabled} onChange={(v) => onToggle(r, v)} />}
          </SettingRow>
          {open === r.id && <PluginDetailPanel row={r} onChanged={onChanged} onNotice={onNotice} />}
        </div>
      ))}
    </>
  );
}

function AddMarketplace({ onDone, onNotice }: { onDone(): void; onNotice(text: string): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = normalizeMarketplaceSource(source);
  const add = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const r = (await api.codexRequest("marketplace/add", { source: parsed.source, refName: parsed.refName })) as MarketplaceAddResponse;
      onNotice(t(r.alreadyAdded ? "codex-config.plugins.market.already" : "codex-config.plugins.market.added", { name: r.marketplaceName }));
      setSource("");
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("codex-config.plugins.market.add")} hint={t("codex-config.plugins.market.sourceHint")}>
      <SettingRow label={t("codex-config.plugins.market.source")}>
        <TextInput mono width="w-64" value={source} onChange={setSource} placeholder="owner/repo" />
        <Button primary disabled={!parsed || busy} onClick={() => void add()}>
          {t("codex-config.plugins.market.addButton")}
        </Button>
      </SettingRow>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Section>
  );
}

export function PluginsPage() {
  const api = useTargetApi();
  const { t } = useI18n();
  const supported = useTargetFeatures().has(CODEX_PLUGINS_FEATURE);
  const [list, setList] = useState<PluginListResponse | null>(null);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setError(null);
    api.codexRequest("plugin/list", {}).then((r) => setList(r as PluginListResponse), (e: unknown) => setError(errorText(e)));
    api.codexRequest("config/read", {}).then((r) => setConfig((r as { config: Record<string, unknown> }).config), () => setConfig(null));
  }, []);
  useEffect(() => {
    if (!supported) return;
    reload();
  }, [supported, reload]);

  const rows = useMemo(() => pluginRows(list), [list]);
  const installed = useMemo(() => installedRows(rows), [rows]);
  const markets = useMemo(() => marketplaceRows(list, marketplaceSources(config)), [list, config]);
  const browse = useMemo(() => groupByMarketplace(filterPlugins(rows, query)), [rows, query]);

  if (!supported) {
    return (
      <>
        <FollowSharedSection />
        <Section title={t("codex-config.plugins")}>
          <p className="py-2 text-sm text-muted">{t("codex-config.plugins.needsCutex")}</p>
        </Section>
      </>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (row: PluginRow, enabled: boolean) =>
    void run(async () => {
      await api.codexRequest("config/value/write", { keyPath: pluginKeyPath(row.id), value: { enabled }, mergeStrategy: "upsert" });
      reload();
    });
  const upgrade = (marketplaceName: string | null) =>
    void run(async () => {
      const r = (await api.codexRequest("marketplace/upgrade", { marketplaceName })) as MarketplaceUpgradeResponse;
      const errors = (r?.errors ?? []).map((e) => `${e.marketplaceName}: ${e.message}`);
      setNotice([t("codex-config.plugins.market.upgraded", { checked: r?.selectedMarketplaces?.length ?? 0, updated: r?.upgradedRoots?.length ?? 0 }), ...errors].join(" · "));
      reload();
    });
  const remove = (name: string) =>
    void run(async () => {
      await api.codexRequest("marketplace/remove", { marketplaceName: name });
      reload();
    });

  const loadErrors = list?.marketplaceLoadErrors ?? [];
  const refresh = <RefreshButton disabled={busy} onClick={reload} />;
  return (
    <>
      <FollowSharedSection />
      <p className="mb-4 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
        <AlertTriangle size={14} className="mt-px shrink-0" />
        {t("codex-config.plugins.warning")}
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={tab}
          options={[
            { value: "installed" as Tab, label: t("codex-config.plugins.tab.installed", { n: installed.length }) },
            { value: "browse" as Tab, label: t("codex-config.plugins.tab.browse") },
            { value: "marketplaces" as Tab, label: t("codex-config.plugins.tab.marketplaces", { n: markets.length }) },
          ]}
          onChange={(v) => {
            setTab(v);
            setOpen(null);
          }}
        />
        {tab === "browse" && <TextInput value={query} onChange={setQuery} placeholder={t("codex-config.plugins.search")} width="w-56" />}
      </div>
      {notice && (
        <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-foreground">
          {notice}{" "}
          <span className="inline-flex align-middle">
            <IconButton label={t("codex-config.plugins.dismiss")} onClick={() => setNotice(null)}>
              <X size={13} />
            </IconButton>
          </span>
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!list && !error && (
        <Section>
          <Loading rows={3} />
        </Section>
      )}

      {list && tab === "installed" && (
        <Section title={t("codex-config.plugins.tab.installed", { n: installed.length })} actions={refresh}>
          {installed.length === 0 && <EmptyState>{t("codex-config.plugins.none")}</EmptyState>}
          <PluginList rows={installed} open={open} setOpen={setOpen} onToggle={toggle} onChanged={reload} onNotice={setNotice} showMarketplace />
        </Section>
      )}

      {list && tab === "browse" && (
        <>
          {rows.length === 0 && <p className="mb-3 text-xs text-subtle">{t("codex-config.plugins.empty")}</p>}
          {rows.length > 0 && browse.length === 0 && <p className="mb-3 text-xs text-subtle">{t("codex-config.plugins.noMatch")}</p>}
          {browse.map((g, i) => (
            <Section key={g.marketplace} title={g.display} hint={g.display !== g.marketplace ? g.marketplace : undefined} actions={i === 0 ? refresh : undefined}>
              <PluginList rows={g.rows} open={open} setOpen={setOpen} onChanged={reload} onNotice={setNotice} />
            </Section>
          ))}
        </>
      )}

      {list && tab === "marketplaces" && (
        <>
          <Section
            title={t("codex-config.plugins.tab.marketplaces", { n: markets.length })}
            actions={
              <>
                <Button disabled={busy || !markets.some((m) => m.canUpgrade)} onClick={() => upgrade(null)}>
                  {t("codex-config.plugins.market.upgradeAll")}
                </Button>
                {refresh}
              </>
            }
          >
            {markets.length === 0 && <EmptyState>{t("codex-config.plugins.market.none")}</EmptyState>}
            {markets.map((m) => (
              <SettingRow
                key={m.name}
                label={m.display}
                hint={[
                  m.display !== m.name ? m.name : null,
                  t("codex-config.plugins.market.count", { n: m.plugins, installed: m.installed }),
                  m.configured?.source ?? m.path,
                  m.configured?.ref ? `#${m.configured.ref}` : null,
                  m.configured?.lastUpdated ? t("codex-config.plugins.market.updated", { at: m.configured.lastUpdated }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                {m.official && <Badge>{t("codex-config.plugins.market.builtin")}</Badge>}
                {m.canUpgrade && (
                  <Button disabled={busy} onClick={() => upgrade(m.name)}>
                    {t("codex-config.plugins.market.upgrade")}
                  </Button>
                )}
                {m.canRemove && (
                  <ArmedRemove disabled={busy} title={t("codex-config.plugins.market.remove")} onRemove={() => remove(m.name)} />
                )}
              </SettingRow>
            ))}
          </Section>
          {loadErrors.length > 0 && (
            <Section title={t("codex-config.plugins.loadErrors")}>
              {loadErrors.map((e) => (
                <p key={e.marketplacePath} className="py-1 font-mono text-xs text-danger">
                  {e.marketplacePath}: {e.message}
                </p>
              ))}
            </Section>
          )}
          <AddMarketplace onDone={reload} onNotice={setNotice} />
        </>
      )}
    </>
  );
}
