// Slot outlets (docs/desktop-modules.md §4–§5): every item instance renders inside its own error
// boundary — a render error shows one line「<模块> 出错：…」, is recorded as the module's
// `lastError` (Settings → 模块) and leaves the module running. Unavailable items show as their
// slot / item says (hide / disable / notice).
import { Component, useContext, type ErrorInfo, type ReactNode } from "react";
import { bridge } from "../bridge";
import { useI18n } from "../i18n";
import { ComponentGate } from "../components/ComponentCard";
import { PageBody } from "../components/Page";
import { Button, EmptyState, Notice, Section } from "../components/settings/Form";
import { capabilitiesOf } from "../lib/hostGatingView";
import { settingsSectionGate } from "../lib/settingsGate";
import { useSettingsGateTarget } from "../lib/settingsGateView";
import { settingsAnchorId } from "../lib/settingsNav";
import { TargetHostContext } from "../lib/targetHost";
import { useHostScope } from "../lib/useHostScope";
import type { SettingsTab } from "../store";
import { appModules, services } from "./app";
import { useOpenPage, usePageOf, useSlot, type OpenPage } from "./react";
import type { ProfileOwnedField, SettingsSectionItem } from "./slots";
import type { ItemId, ModuleId, PageParams } from "./types";

interface BoundaryProps {
  moduleId: ModuleId;
  /** Changing it clears a caught error (e.g. another page / host generation). */
  resetKey?: string;
  children: ReactNode;
}

/** Error boundary around one slot item instance. */
export class ItemBoundary extends Component<BoundaryProps, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    appModules().reportError(this.props.moduleId, error);
    const stack = [error.stack, info.componentStack].filter(Boolean).join("\n");
    void bridge.shell?.logError({ kind: "error", message: `[${this.props.moduleId}] ${error.message}`, stack }).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ItemError moduleId={this.props.moduleId} error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}

function ItemError({ moduleId, error, onRetry }: { moduleId: ModuleId; error: Error; onRetry(): void }) {
  const { t } = useI18n();
  const def = appModules().modules.find((m) => m.id === moduleId);
  return (
    <p role="alert" className="my-2 flex items-center gap-2 text-xs text-danger">
      <span className="min-w-0 truncate">{t("modules.itemError", { module: def ? (def.displayName ?? t(def.titleKey)) : moduleId, message: error.message })}</span>
      <button onClick={onRetry} className="shrink-0 rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-foreground">
        {t("modules.retry")}
      </button>
    </p>
  );
}

/** A section's title +「需要升级 cutex」 (缺 `missing`). */
function NeedsUpgrade({ id, titleKey, missing }: { id: string; titleKey: NonNullable<SettingsSectionItem["titleKey"]>; missing: readonly string[] }) {
  const { t } = useI18n();
  return (
    <div id={settingsAnchorId(id)}>
      <Section title={t(titleKey)} source="host">
        <Notice tone="info">{t("modules.needsUpgrade", { feature: missing.join(", ") })}</Notice>
      </Section>
    </div>
  );
}

/**
 * The `settings.section` items targeting `page`, in order, as lib/settingsGate `settingsSectionGate`
 * decides (the settings search index asks the same gate): a shown item renders; one whose capability is
 * missing shows its title +「需要升级 cutex」 when it is a notice item (not while capabilities are still
 * loading); others are left out. On a host page (`TargetHostContext`) the item must also suit the page's
 * target host (module ∪ item capabilities; the slot's own mode only asks whether any host of the scope
 * has them) and is the owner's. Without a target (app pages) the slot mode decides.
 */
export function SettingsSections({ page, only }: { page: SettingsTab; /** Only these item ids (a mixed page placing its halves). */ only?: readonly string[] }) {
  const entries = useSlot("settings.section");
  const target = useSettingsGateTarget(useContext(TargetHostContext));
  return (
    <>
      {entries
        .filter((e) => e.item.page === page && (!only || only.includes(e.item.id)))
        .map((e) => {
          const gate = settingsSectionGate(e, capabilitiesOf(e.moduleId, e.item), target);
          if (gate.kind === "hidden") return null;
          if (gate.kind === "notice") return <NeedsUpgrade key={e.item.id} id={e.item.id} titleKey={e.item.titleKey!} missing={gate.missing} />;
          // Each section sits in an anchor (settingsAnchorId(item id)) for settings search.
          const Body = e.item.Section;
          return (
            <div key={e.item.id} id={settingsAnchorId(e.item.id)}>
              <ItemBoundary moduleId={e.moduleId}>
                <Body />
              </ItemBoundary>
            </div>
          );
        })}
    </>
  );
}

/**
 * v1.6: the `profile.fieldAction` items for `field` (docs/desktop-modules.md §20), in order — beside
 * the field's control in the profile editor and the 添加 profile form. Hidden items are left out, so
 * a module that is off or lacks its capability shows nothing.
 */
export function ProfileFieldActions({ field, pick, disabled = false }: { field: ProfileOwnedField; pick(value: string): void | Promise<void>; disabled?: boolean }) {
  const entries = useSlot("profile.fieldAction");
  return (
    <>
      {entries
        .filter((e) => e.mode === "show" && e.item.field === field)
        .map((e) => {
          const Action = e.item.Action;
          return (
            <ItemBoundary key={e.item.id} moduleId={e.moduleId}>
              <Action pick={pick} disabled={disabled} />
            </ItemBoundary>
          );
        })}
    </>
  );
}

/** Shown in place of an open page whose module is off / unavailable on this host (or unknown). */
function PageOff() {
  const { t } = useI18n();
  return (
    <main className="flex min-w-0 flex-1">
      <PageBody>
        <Section>
          <EmptyState action={<Button onClick={() => services.ui.openSettings("modules")}>{t("modules.openModules")}</Button>}>{t("modules.pageOff")}</EmptyState>
        </Section>
      </PageBody>
    </main>
  );
}

/**
 * The open `main.page` (docs/desktop-modules.md §3.2), or `children` (the conversation) when no page
 * is open. Nothing while the page's module only waits for capabilities; 「模块已关闭」 when it is off.
 */
export function MainOutlet({ children }: { children: ReactNode }) {
  return <PageOutlet open={useOpenPage()}>{children}</PageOutlet>;
}

/** v1.17 (§24.4): the page a conversation pane shows over its conversation (another pane than the focused one). */
export function PaneOutlet({ page, children }: { page: { page: ItemId; params: PageParams } | null; children: ReactNode }) {
  return <PageOutlet open={usePageOf(page)}>{children}</PageOutlet>;
}

function PageOutlet({ open, children }: { open: OpenPage | null; children: ReactNode }) {
  if (!open) return <>{children}</>;
  if (!open.entry) return open.waiting ? <main className="min-w-0 flex-1" /> : <PageOff />;
  const { Page } = open.entry.item;
  const requires = appModules().modules.find((m) => m.id === open.entry!.moduleId)?.requires;
  const page = <Page params={open.params} />;
  return (
    <ItemBoundary moduleId={open.entry.moduleId} resetKey={open.page}>
      {requires?.component ? <FocusComponentGate name={requires.component} capabilities={requires.capabilities ?? []}>{page}</FocusComponentGate> : page}
    </ItemBoundary>
  );
}

/** v1.15 `requires.component` (§12.1): a main page targets the focus host. */
function FocusComponentGate({ name, capabilities, children }: { name: string; capabilities: readonly string[]; children: ReactNode }) {
  const focus = useHostScope().focus;
  return (
    <ComponentGate name={name} hostId={focus} moduleCapabilities={capabilities}>
      {children}
    </ComponentGate>
  );
}

/** The open page's Aside (replaces the app sidebar), if it has one. */
export function PageAsideOutlet() {
  const open = useOpenPage();
  const Aside = open?.entry?.item.Aside;
  if (!open?.entry || !Aside) return null;
  return (
    <ItemBoundary moduleId={open.entry.moduleId} resetKey={open.page}>
      <Aside params={open.params} />
    </ItemBoundary>
  );
}
