// Settings → 模块 (docs/desktop-modules.md §5): one row per module — name, its tags (origin → version → trust / risk /
// state, modules/moduleTags.ts; each tag opens its explanation), description, state and its switch. Core modules are
// always on: a lock in the same place as every other row's switch. The state is written out only when the switch
// does not already say it (不可用：缺 X / 出错 + 重试 / 启动中 …); 已启用 / 已关闭 are the dot's tooltip.
// Owner 2026-11-24: a toolbar over the list (search · filter · sort), no page of its own.
// Owner 2026-11-26 (module list v2): the list in groups by use, in the order of shared/moduleGroups.ts (核心 folded,
// last); each row also says where the module shows up (from its contributes, modules/moduleCatalog.ts) and its
// default; 一键设置 精简 / 推荐 / 全部 asks in place first and can be undone. Sorting by name / recent shows one list.
// module-dependencies-20261126: 项目 / 归档 / 存储 / 审批 are required but listed with their use (必需 + why); turning
// off a module that modules on need asks to turn them off too, turning one on turns on what it needs.
// Owner 2026-11-26: a module that only adds widgets to another (世界时钟, 正在运行的 Maid → 桌面; moduleCatalog
// moduleParent) is an indented row under it, labelled by what it adds (桌面小组件); with its parent off it is greyed,
// 「需要先开启桌面」, its switch disabled. The parent's 被…依赖 line names real dependents only, in a neutral grey.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { Banner, Button, EmptyState, ListRow, Section, Segmented, Select, SettingsGroup, TextInput, Toggle } from "../../components/settings/Form";
import { appModules } from "../app";
import { useModuleStatuses } from "../react";
import type { ModuleState } from "../types";
import type { AppModule } from "../slots";
import { packRow, usePackRuntime, type PackRow } from "../packs";
import { useModuleDevView } from "../devModules";
import { devBuildsRunning, useDevRunning } from "../devRunning";
import { DevModulesGroup } from "./DevModules";
import { ModuleDataGroup } from "./ModuleData";
import { LocalPacksGroup, ModuleSettingsButton, ModuleTags, PackActions, PackBelow, PackIndexHeader, PackOnlyRow, packOnlyIds } from "./ModulePacks";
import { settingsAnchorId } from "../../lib/settingsNav";
import { keyVar, MODULE_COMMANDS } from "../../lib/keybindings";
import { useUpdateStatus } from "../../lib/update";
import { MODULE_FILTERS, MODULE_SORTS, matchesModule, moduleFacts, noteInstalled, sortModules, type ModuleFilter, type ModuleListItem, type ModuleSort } from "../moduleTags";
import { MODULE_PRESETS, currentPreset, groupModules, isKeptOn, moduleDependents, moduleGroup, moduleOrder, moduleParent, modulePlaces, nestChildren, presetChanges, switchPlan, type ModulePreset, type PresetModule } from "../moduleCatalog";
import type { ModuleGroup } from "../../../../shared/moduleGroups";
import { moduleMetadata } from "../../../../shared/moduleMetadata";
import { ON_DEMAND_UPGRADE_PACKS } from "../../../../shared/modulePacks";

const onDemandIds = new Set<string>(ON_DEMAND_UPGRADE_PACKS);

const DOT: Record<ModuleState["kind"], string> = {
  active: "bg-ok",
  activating: "bg-warn",
  stopping: "bg-warn",
  unavailable: "bg-subtle/60",
  disabled: "border border-subtle/60",
  failed: "bg-danger",
};

type Item = ModuleListItem & { group: ModuleGroup; optional: boolean } & (
  | { kind: "module"; def: AppModule; pack: PackRow | null; dev: boolean; defaultOn: boolean; parent: string | null }
  | { kind: "pack"; pack: PackRow }
);

/** After 一键设置: what it changed (to undo it), or that it was undone. */
type PresetNote = { kind: "applied"; preset: ModulePreset; prev: ReadonlyMap<string, boolean> } | { kind: "undone" };
/** Under one row: turning it off would stop modules that need it (ask), or turning it on turned on what it needs. */
type SwitchNote = { id: string; kind: "askOff" | "turnedOn"; others: readonly string[] };

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
  const [ask, setAsk] = useState<ModulePreset | null>(null);
  const [note, setNote] = useState<PresetNote | null>(null);
  const [switchNote, setSwitchNote] = useState<SwitchNote | null>(null);
  // Groups the owner folded or unfolded (核心 starts folded, the others open).
  const [flipped, setFlipped] = useState<ReadonlySet<ModuleGroup>>(() => new Set());
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
    const optional = !def.required && !!moduleMetadata(def.id)?.optional;
    // Only adds to another module (桌面小组件): listed under it, in its group.
    const parent = def.required ? null : moduleParent(def);
    items.push({
      kind: "module", def, pack, id: def.id, dev: !!dev, optional, parent,
      group: parent ? moduleGroup(parent, !!host.modules.find((m) => m.id === parent)?.required) : moduleGroup(def.id, !!def.required),
      // Optional modules start off on new installs whatever the definition says (shared/moduleMetadata).
      defaultOn: !!def.required || (!optional && def.defaultEnabled !== false),
      title: def.displayName ?? t(def.titleKey),
      detail: def.descriptionKey ? t(def.descriptionKey, MODULE_COMMANDS[def.id] ? keyVar(MODULE_COMMANDS[def.id]!) : undefined) : undefined,
      facts: moduleFacts({ id: def.id, required: !!def.required, pack, appVersion, dev: dev ? { version: dev.version, host: dev.host } : null }),
      enabled: !!def.required || host.isEnabled(def.id),
      hasUpdate: pack?.offer?.kind === "update",
      installedAt: seen[def.id] ?? null,
    });
  }
  if (packs.view) {
    const known = new Set(host.modules.map((m) => m.id));
    const missing = new Set([...packOnlyIds(packs.view, known), ...ON_DEMAND_UPGRADE_PACKS.filter(id => !known.has(id))]);
    for (const id of missing) {
      const pack = packRow(id, packs, false, null);
      const texts = pack.installed ?? pack.available[0];
      items.push({
        kind: "pack", pack, id, group: moduleGroup(id), optional: true,
        title: onDemandIds.has(id) ? t(`${id}.title` as MessageKey) : texts?.title?.[locale] ?? texts?.title?.en ?? id,
        detail: onDemandIds.has(id) ? t(`${id}.description` as MessageKey) : texts?.description?.[locale] ?? texts?.description?.en,
        facts: moduleFacts({ id, required: false, pack, appVersion }),
        enabled: false,
        hasUpdate: pack.offer?.kind === "update",
        installedAt: seen[id] ?? null,
      });
    }
  }
  // Default order (shared/moduleGroups): by group, the most used first within each, optional ones at a group's end;
  // what you added (local packs, developer folders) ahead of the app's own where they tie.
  items.sort((a, b) => Number(added.has(b.id)) - Number(added.has(a.id)));
  const ordered = moduleOrder(items, (i) => ({ id: i.id, required: i.group === "core", optionalOrPack: i.optional || i.kind === "pack" }));
  const shown = sortModules(ordered.filter((item) => matchesModule(item, query, filter)), sort, locale);
  const narrowed = !!query.trim() || filter !== "all";
  const grouped = sort === "default";

  // 一键设置: the modules with a switch; presets leave core, kept-on and optional modules alone (moduleCatalog).
  const presetModules: PresetModule[] = items.flatMap((i) => (i.kind === "module" ? [{ id: i.id, required: !!i.def.required, defaultOn: i.defaultOn, requires: i.def.requires?.modules ?? [] }] : []));
  const isOn = (id: string) => host.isEnabled(id);
  const preset = currentPreset(presetModules, isOn);
  const presetName = (p: ModulePreset) => t(`modules.list.preset.${p}` as MessageKey);
  const asked = ask ? presetChanges(ask, presetModules, isOn) : null;
  const apply = (p: ModulePreset) => {
    const { on, off } = presetChanges(p, presetModules, isOn);
    const prev = new Map([...on, ...off].map((id) => [id, isOn(id)] as const));
    for (const id of on) void host.setEnabled(id, true);
    for (const id of off) void host.setEnabled(id, false);
    setAsk(null);
    setNote({ kind: "applied", preset: p, prev });
  };
  const undo = (prev: ReadonlyMap<string, boolean>) => {
    for (const [id, on] of prev) if (isOn(id) !== on) void host.setEnabled(id, on);
    setNote({ kind: "undone" });
  };
  const dependents = moduleDependents(presetModules);
  const setOne = (id: string, on: boolean) => {
    const plan = switchPlan(id, on, presetModules, isOn);
    if (!on && plan.length > 1) { setSwitchNote({ id, kind: "askOff", others: plan.slice(1) }); return; }
    for (const x of plan) void host.setEnabled(x, on);
    setSwitchNote(on && plan.length > 1 ? { id, kind: "turnedOn", others: plan.slice(1) } : null);
  };
  // A search / filter opens every group (a hit is never hidden in a folded one).
  const isOpen = (g: ModuleGroup) => narrowed || (g === "core") === flipped.has(g);
  const toggleGroup = (g: ModuleGroup) => setFlipped((prev) => { const next = new Set(prev); if (!next.delete(g)) next.add(g); return next; });

  const parentOf = (i: Item): string | null => (i.kind === "module" ? i.parent : null);
  const renderRow = (item: Item, child = false) => {
    if (item.kind === "pack") return <PackOnlyRow key={item.id} row={item.pack} name={item.title} detail={item.detail} facts={item.facts} />;
    const { def, pack } = item;
    const status = statuses.get(def.id);
    const state = status?.state ?? { kind: "disabled" as const };
    const title = item.title;
    const kept = isKeptOn(def.id, !!def.required);
    // 被 X 依赖: only the modules on now that need it, its own children (listed under it) left out.
    const needed = (dependents.get(def.id) ?? []).filter((x) => isOn(x) && items.find((i) => i.id === x && parentOf(i) === def.id) === undefined).map(moduleTitle);
    // A child whose parent is off: greyed, 「需要先开启桌面」, no switch to turn on (the parent first).
    const parentOff = !!item.parent && !isOn(item.parent);
    const rowNote = switchNote?.id === def.id ? switchNote : null;
    const others = rowNote ? rowNote.others.map(moduleTitle).join("、") : "";
    const places = modulePlaces(def.contributes as Readonly<Record<string, readonly unknown[] | undefined>> | undefined);
    const on = !!def.required || host.isEnabled(def.id);
    return (
      <div key={def.id} id={settingsAnchorId(`module-${def.id}`)} className={`${child ? "pl-6" : ""} ${parentOff ? "opacity-60" : ""}`} data-module-child={item.parent ?? undefined} data-module-nested={child ? "" : undefined}>
      {/* Only the browser module serves agents: off = its relay refuses agent browser calls at once (main/browser/install.ts moduleEnabled). */}
      <SettingsGroup agents={def.id === "browser" ? "now" : "none"} source="local" readOnly={!!def.required && state.kind !== "failed" && !status?.lastError}>
      <ListRow
        leading={<span className={`h-2 w-2 shrink-0 rounded-full ${DOT[state.kind]}`} title={stateText(state)} aria-hidden />}
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate">{title}</span>
            <ModuleTags facts={item.facts} packable={!!pack?.bundledVersion} bundled={!!pack?.bundled} dev={item.dev} />
            {parentOff ? (
              <span className="shrink-0 text-xs text-subtle" data-module-needs-parent="">{t("modules.list.needsParent", { name: moduleTitle(item.parent!) })}</span>
            ) : state.kind !== "active" && state.kind !== "disabled" && (
              <span className={`shrink-0 text-xs ${state.kind === "failed" ? "text-danger" : "text-subtle"}`} title={stateText(state)}>
                {stateText(state)}
              </span>
            )}
          </span>
        }
        detail={item.detail}
        below={
          <>
            {/* Where it shows up · its default · 你改过 · 被 X 依赖: one muted line under the description. */}
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pb-0.5 pl-[18px] text-caption text-subtle" data-module-meta="">
              {item.parent ? (
                // A child says what it adds (桌面小组件), not 「出现在：桌面小组件」 again under its parent.
                <span data-module-places={places.join(" ")} data-module-child-label="">{places.map((p) => t(`modules.list.place.${p}` as MessageKey)).join(" · ")}</span>
              ) : (
                <span data-module-places={places.join(" ")}>
                  {places.length ? t("modules.list.places", { list: places.map((p) => t(`modules.list.place.${p}` as MessageKey)).join(" · ") }) : t("modules.list.places.none")}
                </span>
              )}
              {kept && <span data-module-kept="">· {t(`modules.list.keptOn.${def.id}` as MessageKey)}</span>}
              {!def.required && <span data-module-default={item.defaultOn ? "on" : "off"}>· {t(item.defaultOn ? "modules.list.default.on" : "modules.list.default.off")}</span>}
              {!def.required && on !== item.defaultOn && <span className="text-accent" data-module-changed="">· {t("modules.list.changed")}</span>}
              {needed.length > 0 && (
                <span title={t("modules.list.dependents.hint", { list: needed.join("、") })} data-module-dependents="">
                  · {t("modules.list.dependents", { list: needed.join("、") })}
                </span>
              )}
            </p>
            {status?.lastError && (
              <p className="pb-0.5 pl-[18px] text-xs text-warn" title={status.lastError.message}>
                {t("modules.lastError", { message: status.lastError.message })}
              </p>
            )}
            {pack && <PackBelow row={pack} />}
            {rowNote && (
              <Banner
                tone={rowNote.kind === "askOff" ? "warn" : "info"}
                className="mb-1.5 ml-[18px]"
                attrs={{ "data-module-switch-note": rowNote.kind }}
                actions={rowNote.kind === "askOff" ? (
                  <>
                    <Button primary onClick={() => { for (const x of [def.id, ...rowNote.others]) void host.setEnabled(x, false); setSwitchNote(null); }}>{t("modules.list.switchOff.all")}</Button>
                    <Button onClick={() => setSwitchNote(null)}>{t("modules.list.preset.cancel")}</Button>
                  </>
                ) : undefined}
              >
                {rowNote.kind === "askOff" ? t("modules.list.switchOff.ask", { name: title, list: others }) : t("modules.list.switchOn.done", { name: title, list: others })}
              </Banner>
            )}
          </>
        }
        actions={
          <>
            {(state.kind === "failed" || status?.lastError) && <Button onClick={() => void host.retry(def.id)}>{t("modules.retry")}</Button>}
            {!def.required && <ModuleSettingsButton moduleId={def.id} name={title} />}
            {pack && <PackActions row={pack} name={title} />}
            {kept ? (
              // 必需: the lock and its word where the switch is; why, in the line under the description.
              <span role="img" aria-label={`${title} · ${t("modules.list.keptOn")}`} className="inline-flex h-5 shrink-0 items-center gap-1 text-xs text-subtle" data-module-kept-on="" title={t("modules.list.keptOn.hint")}>
                <Lock size={14} aria-hidden />
                {t("modules.list.keptOn")}
              </span>
            ) : def.required ? (
              // Core: always on. Only a lock (owner 2026-11-25: no greyed switch), in a switch-wide slot so its
              // right edge lines up with the other rows' switches (the 核心 chip is by the name).
              <span role="img" aria-label={`${title} · ${t("modules.coreLocked")}`} className="inline-flex h-5 w-9 shrink-0 items-center justify-end pr-1" data-module-locked="" title={t("modules.coreLocked")}>
                <Lock size={14} className="text-subtle" aria-hidden />
              </span>
            ) : (
              <Toggle label={title} checked={host.isEnabled(def.id)} disabled={parentOff && !host.isEnabled(def.id)} onChange={(v) => setOne(def.id, v)} />
            )}
          </>
        }
      />
      </SettingsGroup>
      </div>
    );
  };

  return (
    // Two cards: where modules come from (index, local packs, developer mode, data), then the modules themselves.
    <>
    <Section id={settingsAnchorId("module-sources")} title={t("modules.section.sources")}>
      <PackIndexHeader />
      <LocalPacksGroup />
      <DevModulesGroup />
      <ModuleDataGroup />
    </Section>
    <Section
      id={settingsAnchorId("module-list")}
      title={t("modules.section.all")}
      actions={
        <span className="inline-flex items-center gap-2" data-module-presets="">
          <span className="text-xs text-subtle">{t("modules.list.presets")}</span>
          {/* A preset may switch the browser module, which serves agents at once (as its row says). */}
          <SettingsGroup agents="now" source="local">
            <Segmented<ModulePreset>
              label={t("modules.list.presets")}
              value={preset ?? ("" as ModulePreset)}
              options={MODULE_PRESETS.map((p) => ({ value: p, label: presetName(p), title: t(`modules.list.preset.${p}.hint` as MessageKey) }))}
              onChange={(p) => { setAsk(p); setNote(null); setSwitchNote(null); }}
            />
          </SettingsGroup>
        </span>
      }
    >
      <div role="toolbar" aria-label={t("modules.section.all")} className="flex flex-wrap items-center gap-2 py-2" data-settings-list-filter="" data-module-toolbar="">
        <TextInput search value={query} onChange={setQuery} width="w-48" label={t("modules.list.search")} placeholder={t("modules.list.search")} />
        <span className="inline-flex" data-module-filter-wrap="">
          <Select<ModuleFilter> value={filter} width="w-auto" label={t("modules.list.filter")} options={MODULE_FILTERS.map((f) => ({ value: f, label: t(`modules.list.filter.${f}` as MessageKey) }))} onChange={setFilter} />
        </span>
        <Select<ModuleSort> value={sort} width="w-auto" label={t("modules.list.sort")} options={MODULE_SORTS.map((s) => ({ value: s, label: t(`modules.list.sort.${s}` as MessageKey) }))} onChange={setSort} />
        {narrowed && <span className="text-caption text-subtle tabular-nums" data-module-count="">{t("modules.list.count", { shown: shown.length, total: items.length })}</span>}
      </div>
      {ask && asked && (
        // In place (medium risk, undoable): what the preset would change, then 应用 / 取消.
        <Banner
          tone="info"
          className="my-2"
          attrs={{ "data-module-preset-ask": ask }}
          actions={asked.on.length + asked.off.length === 0 ? (
            <Button onClick={() => setAsk(null)}>{t("modules.list.preset.cancel")}</Button>
          ) : (
            <>
              <Button primary onClick={() => apply(ask)}>{t("modules.list.preset.apply")}</Button>
              <Button onClick={() => setAsk(null)}>{t("modules.list.preset.cancel")}</Button>
            </>
          )}
        >
          {asked.on.length + asked.off.length === 0 ? t("modules.list.preset.nothing", { preset: presetName(ask) }) : (
            <>
              <div className="text-foreground">{t("modules.list.preset.confirm", { preset: presetName(ask), on: asked.on.length, off: asked.off.length })}</div>
              <div className="text-xs text-subtle">{t("modules.list.preset.confirmNote")}</div>
            </>
          )}
        </Banner>
      )}
      {note && (
        <Banner tone="info" className="my-2" attrs={{ "data-module-preset-note": note.kind }} actions={note.kind === "applied" ? <Button onClick={() => undo(note.prev)}>{t("modules.list.preset.undo")}</Button> : undefined}>
          {note.kind === "applied" ? t("modules.list.preset.applied", { preset: presetName(note.preset) }) : t("modules.list.preset.undone")}
        </Banner>
      )}
      {shown.length === 0 && <EmptyState>{t("modules.list.empty")}</EmptyState>}
      {grouped
        ? groupModules(shown, (i) => i.group).map(({ group, items: rows }) => {
            const all = items.filter((i) => i.group === group && i.kind === "module");
            const open = isOpen(group);
            return (
              <div key={group} data-module-group={group}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group)}
                  className="press -mx-4 flex w-[calc(100%+2rem)] items-center gap-1.5 border-b border-border px-4 pt-3 pb-1.5 text-left text-xs font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                  <span>{t(`modules.list.group.${group}` as MessageKey)}</span>
                  {/* No count where there is nothing to switch (only packs to download). */}
                  {all.length > 0 && (
                    <span className="font-normal text-subtle tabular-nums">
                      {group === "core" ? all.length : t("modules.list.group.count", { on: all.filter((i) => i.enabled).length, total: all.length })}
                    </span>
                  )}
                  {group === "core" && <span className="ml-auto font-normal text-subtle">{t("modules.list.group.coreHint")}</span>}
                </button>
                {open && nestChildren(rows, parentOf).map(({ item, child }) => renderRow(item, child))}
              </div>
            );
          })
        : shown.map((item) => renderRow(item))}
    </Section>
    </>
  );
}
