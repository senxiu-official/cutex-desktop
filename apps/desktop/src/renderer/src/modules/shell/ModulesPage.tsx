// Settings → 模块 (docs/desktop-modules.md §5): one row per module — name, its tags (origin → version → trust / risk /
// state, modules/moduleTags.ts; each tag opens its explanation), description, state and its switch. Core modules are
// always on: a lock in the same place as every other row's switch. The state is written out only when the switch
// does not already say it (不可用：缺 X / 出错 + 重试 / 启动中 …); 已启用 / 已关闭 are the dot's tooltip.
// Owner 2026-11-24: a toolbar over the list (search · filter · sort), no page of its own.
import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { Button, EmptyState, ListRow, Section, Select, SettingsGroup, TextInput, Toggle } from "../../components/settings/Form";
import { appModules } from "../app";
import { useModuleStatuses } from "../react";
import type { ModuleState } from "../types";
import type { AppModule } from "../slots";
import { packRow, usePackRuntime, type PackRow } from "../packs";
import { useModuleDevView } from "../devModules";
import { devBuildsRunning, useDevRunning } from "../devRunning";
import { DevModulesGroup } from "./DevModules";
import { ModuleDataGroup } from "./ModuleData";
import { LocalPacksGroup, ModuleTags, PackActions, PackBelow, PackIndexHeader, PackOnlyRow, packOnlyIds } from "./ModulePacks";
import { settingsAnchorId } from "../../lib/settingsNav";
import { keyVar, MODULE_COMMANDS } from "../../lib/keybindings";
import { useUpdateStatus } from "../../lib/update";
import { MODULE_FILTERS, MODULE_SORTS, matchesModule, moduleFacts, noteInstalled, sortModules, type ModuleFilter, type ModuleListItem, type ModuleSort } from "../moduleTags";

const DOT: Record<ModuleState["kind"], string> = {
  active: "bg-ok",
  activating: "bg-warn",
  stopping: "bg-warn",
  unavailable: "bg-subtle/60",
  disabled: "border border-subtle/60",
  failed: "bg-danger",
};

type Item = ModuleListItem & ({ kind: "module"; def: AppModule; pack: PackRow | null; dev: boolean } | { kind: "pack"; pack: PackRow });

export function ModulesPage() {
  const { t, locale } = useI18n();
  const statuses = useModuleStatuses();
  const host = appModules();
  // The desktop app's version (a source build: its commit), as 关于 shows it.
  const current = useUpdateStatus()?.current;
  const appVersion = current?.version ?? (current?.commit ? current.commit.slice(0, 7) : null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ModuleFilter>("all");
  const [sort, setSort] = useState<ModuleSort>("default");
  const stateText = (state: ModuleState): string => {
    switch (state.kind) {
      case "active":
      case "activating":
      case "stopping":
      case "disabled":
        return t(`modules.state.${state.kind}`);
      case "failed":
        return t("modules.state.failed", { error: state.error });
      case "unavailable": {
        const m = state.missing;
        const reasons: string[] = [];
        if (m.waiting) reasons.push(t("modules.missing.waiting"));
        else if (m.capabilities.length) reasons.push(t("modules.missing.capabilities", { list: m.capabilities.join(", ") }));
        if (m.modules.length) reasons.push(t("modules.missing.modules", { list: m.modules.map((id) => moduleTitle(id)).join(", ") }));
        if (m.hostKind) reasons.push(t("modules.missing.hostKind"));
        return t("modules.state.unavailable", { reason: reasons.join("；") });
      }
    }
  };
  const moduleTitle = (id: string) => {
    const def = host.modules.find((m) => m.id === id);
    return def ? (def.displayName ?? t(def.titleKey)) : id;
  };
  const packs = usePackRuntime();
  // Signed packs (§23.9): only with a module-pack bridge (Electron, or the preview's mock).
  // A module you added is the one you came here for: above the long list of the app's own.
  const devView = useModuleDevView();
  // The developer-folder build actually running under each id (not main's newest build: a failed one leaves the last
  // that ran; a folder whose id another module holds runs nothing).
  const devBuild = devBuildsRunning(devView, useDevRunning(), host.modules);
  const added = new Set<string>([...(packs.view?.installed ?? []).filter((p) => p.local).map((p) => p.id), ...devBuild.keys()]);
  const packRowOf = (id: string) => (packs.view ? packRow(id, packs, packs.bundled ? id in packs.bundled : true, packs.bundled?.[id] ?? null) : null);
  // When this desktop first saw each installed version (最近安装或更新). No view yet = still loading: read only.
  const installedKey = packs.view ? packs.view.installed.map((p) => `${p.id}@${p.version}`).join(",") : null;
  const seen = useMemo(() => noteInstalled(packs.view?.installed ?? null), [installedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: Item[] = [];
  for (const def of host.modules) {
    const pack = def.required ? null : packRowOf(def.id);
    const dev = def.required ? undefined : devBuild.get(def.id);
    items.push({
      kind: "module", def, pack, id: def.id, dev: !!dev,
      title: def.displayName ?? t(def.titleKey),
      detail: def.descriptionKey ? t(def.descriptionKey, MODULE_COMMANDS[def.id] ? keyVar(MODULE_COMMANDS[def.id]!) : undefined) : undefined,
      facts: moduleFacts({ required: !!def.required, pack, appVersion, dev: dev ? { version: dev.version, host: dev.host } : null }),
      enabled: !!def.required || host.isEnabled(def.id),
      hasUpdate: pack?.offer?.kind === "update",
      installedAt: seen[def.id] ?? null,
    });
  }
  if (packs.view) {
    for (const id of packOnlyIds(packs.view, new Set(host.modules.map((m) => m.id)))) {
      const pack = packRow(id, packs, false, null);
      const texts = pack.installed ?? pack.available[0];
      items.push({
        kind: "pack", pack, id,
        title: texts?.title?.[locale] ?? texts?.title?.en ?? id,
        detail: texts?.description?.[locale] ?? texts?.description?.en,
        facts: moduleFacts({ required: false, pack, appVersion }),
        enabled: false,
        hasUpdate: pack.offer?.kind === "update",
        installedAt: seen[id] ?? null,
      });
    }
  }
  // Default order: what you added (local packs, developer folders) first, the app's own after; stable within each.
  items.sort((a, b) => Number(added.has(b.id)) - Number(added.has(a.id)));
  const shown = sortModules(items.filter((item) => matchesModule(item, query, filter)), sort, locale);
  const narrowed = !!query.trim() || filter !== "all";

  return (
    // Two cards: where modules come from (index, local packs, developer mode, data), then the modules themselves.
    <>
    <Section id={settingsAnchorId("module-sources")} title={t("modules.section.sources")}>
      <PackIndexHeader />
      <LocalPacksGroup />
      <DevModulesGroup />
      <ModuleDataGroup />
    </Section>
    <Section id={settingsAnchorId("module-list")} title={t("modules.section.all")}>
      <div role="toolbar" aria-label={t("modules.section.all")} className="flex flex-wrap items-center gap-2 py-2" data-settings-list-filter="" data-module-toolbar="">
        <TextInput search value={query} onChange={setQuery} width="w-48" label={t("modules.list.search")} placeholder={t("modules.list.search")} />
        <span className="inline-flex" data-module-filter-wrap="">
          <Select<ModuleFilter> value={filter} width="w-auto" label={t("modules.list.filter")} options={MODULE_FILTERS.map((f) => ({ value: f, label: t(`modules.list.filter.${f}` as MessageKey) }))} onChange={setFilter} />
        </span>
        <Select<ModuleSort> value={sort} width="w-auto" label={t("modules.list.sort")} options={MODULE_SORTS.map((s) => ({ value: s, label: t(`modules.list.sort.${s}` as MessageKey) }))} onChange={setSort} />
        {narrowed && <span className="text-caption text-subtle tabular-nums" data-module-count="">{t("modules.list.count", { shown: shown.length, total: items.length })}</span>}
      </div>
      {shown.length === 0 && <EmptyState>{t("modules.list.empty")}</EmptyState>}
      {shown.map((item) => {
        if (item.kind === "pack") return <PackOnlyRow key={item.id} row={item.pack} name={item.title} detail={item.detail} facts={item.facts} />;
        const { def, pack } = item;
        const status = statuses.get(def.id);
        const state = status?.state ?? { kind: "disabled" as const };
        const title = item.title;
        return (
          <div key={def.id} id={settingsAnchorId(`module-${def.id}`)}>
          {/* Only the browser module serves agents: off = its relay refuses agent browser calls at once (main/browser/install.ts moduleEnabled). */}
          <SettingsGroup agents={def.id === "browser" ? "now" : "none"} source="local" readOnly={!!def.required && state.kind !== "failed" && !status?.lastError}>
          <ListRow
            leading={<span className={`h-2 w-2 shrink-0 rounded-full ${DOT[state.kind]}`} title={stateText(state)} aria-hidden />}
            title={
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate">{title}</span>
                <ModuleTags facts={item.facts} packable={!!pack?.bundledVersion} bundled={!!pack?.bundled} dev={item.dev} />
                {state.kind !== "active" && state.kind !== "disabled" && (
                  <span className={`shrink-0 text-xs ${state.kind === "failed" ? "text-danger" : "text-subtle"}`} title={stateText(state)}>
                    {stateText(state)}
                  </span>
                )}
              </span>
            }
            detail={item.detail}
            below={
              <>
                {status?.lastError && (
                  <p className="pb-0.5 pl-[18px] text-xs text-warn" title={status.lastError.message}>
                    {t("modules.lastError", { message: status.lastError.message })}
                  </p>
                )}
                {pack && <PackBelow row={pack} />}
              </>
            }
            actions={
              <>
                {(state.kind === "failed" || status?.lastError) && <Button onClick={() => void host.retry(def.id)}>{t("modules.retry")}</Button>}
                {pack && <PackActions row={pack} name={title} />}
                {def.required ? (
                  // Core: always on. Only a lock (owner 2026-11-25: no greyed switch), in a switch-wide slot so its
                  // right edge lines up with the other rows' switches (the 核心 chip is by the name).
                  <span role="img" aria-label={`${title} · ${t("modules.coreLocked")}`} className="inline-flex h-5 w-9 shrink-0 items-center justify-end pr-1" data-module-locked="" title={t("modules.coreLocked")}>
                    <Lock size={14} className="text-subtle" aria-hidden />
                  </span>
                ) : (
                  <Toggle label={title} checked={host.isEnabled(def.id)} onChange={(on) => void host.setEnabled(def.id, on)} />
                )}
              </>
            }
          />
          </SettingsGroup>
          </div>
        );
      })}
    </Section>
    </>
  );
}
