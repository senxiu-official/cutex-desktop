// Settings search, React side: builds the index (lib/settingsSearch.ts) from the `settings.page` /
// `settings.section` slots in the UI language and the other one (display terms resolved, so a renamed
// "agent" is found by its new name), and scrolls to + flashes a result's card once its page renders.
import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { useEnglishCatalog, useI18n, type MessageKey } from "../i18n";
import { zhCN as zhCatalog } from "../i18n/zh-CN";
import { useModuleStatuses, useSlot } from "../modules/react";
import { appModules } from "../modules/app";
import { listedInSettings, revealUnlistedModules } from "../modules/settingsVisibility";
import { flashElement } from "./focusRequest";
import { cleanText, type SearchText, type SettingsSearchDoc } from "./settingsSearch";
import { settingsNavGroups, settingsAnchorId } from "./settingsNav";
import type { SettingsPageItem, SettingsSearchSection, SettingsSectionItem } from "../modules/slots";
import { hostGate } from "./hostGating";
import { capabilitiesOf } from "./hostGatingView";
import { isSettingsHostPage, settingsCardGate, settingsPageAccess, settingsSectionGate, type SettingsGate, type SettingsGateTarget } from "./settingsGate";
import { useSettingsGateTarget } from "./settingsGateView";
import { SETTINGS_HOST_PAGES, useSettingsHost } from "./settingsHost";
import { useHostScope } from "./useHostScope";
import { applyTerms, DEFAULT_TERMS, TERM_IDS, resolveTerms, useTermOverrides, type TermLocale, type TermOverrides } from "./terms";
import { useOwnerWindow } from "./ownerContext";

type Entry<T> = { item: T; moduleId: string; mode: "show" | "disable" | "notice"; missing: readonly string[]; waiting: boolean };

/** What `settingsSearchDocs` reads (the hook passes the live slots, language and targets). */
export interface SettingsIndexInput {
  pages: readonly Entry<SettingsPageItem>[];
  sections: readonly Entry<SettingsSectionItem>[];
  /** A message in the UI language and the other shipped one. */
  text(key: MessageKey): SearchText;
  /** A message in the UI language (reasons). */
  t(key: MessageKey, vars?: Record<string, string | number>): string;
  /** The host the host pages edit (lib/settingsHost) and the app pages' (focus host, no access). */
  hostTarget: SettingsGateTarget;
  appTarget: SettingsGateTarget;
  hostLabel: string;
  /** Module ∪ item capabilities (lib/hostGatingView capabilitiesOf). */
  capabilitiesOf(moduleId: string, item?: { requires?: { capabilities?: readonly string[] } }): string[];
  termKeywords?: readonly SearchText[];
  moduleEntries?: readonly { id: string; title: SearchText; keywords: readonly SearchText[] }[];
}

/** Keep both the effective aliases and shipped names discoverable after renaming. */
export function settingsTermSearchTexts(overrides: TermOverrides, locale: TermLocale, other: TermLocale): SearchText[] {
  const current = resolveTerms(overrides, locale);
  const translated = resolveTerms(overrides, other);
  return TERM_IDS.flatMap((id) => (["one", "many"] as const).flatMap((form) => [
    { current: current[id][form], other: translated[id][form] },
    { current: DEFAULT_TERMS[locale][id][form], other: DEFAULT_TERMS[other][id][form] },
  ]));
}

/**
 * The search docs of the settings pages and their cards, through the gates Settings renders them with
 * (lib/settingsGate): no result leads to a card the page leaves out; a card the page shows as
 * 「需要升级 cutex」 or a page this connection cannot use is a greyed result with the reason.
 */
export function settingsSearchDocs({ pages, sections, text, t, hostTarget, appTarget, hostLabel, capabilitiesOf, termKeywords = [], moduleEntries = [] }: SettingsIndexInput): SettingsSearchDoc[] {
  const upgrade = (missing: readonly string[]) => t("modules.needsUpgrade", { feature: missing.join(", ") });
  const docs: SettingsSearchDoc[] = [];
  // Nav order: group, then slot order inside the group (= SettingsNav).
  const ordered = settingsNavGroups(pages).flatMap((g) => g.entries);
  ordered.forEach((entry, pageOrder) => {
    const { item } = entry;
    if (entry.mode !== "show" && entry.waiting) return; // capabilities still loading
    const hostPage = isSettingsHostPage(item);
    // A 混合设置 page that is about one host (主机: its header names the Settings host) reads that host too.
    const target = hostPage || (item.hostPart && SETTINGS_HOST_PAGES.has(item.page)) ? hostTarget : appTarget;
    let pageDisabled = entry.mode === "show" ? null : t("modules.needsCapability", { list: entry.missing.join(", ") });
    if (!pageDisabled && hostPage) {
      // Another user's connection: Settings shows only 「主机设置归主机所有者」 there.
      const access = settingsPageAccess(item, target.access);
      if (access !== "ok") pageDisabled = t(access === "pending" ? "users.access.pendingSettings" : "users.access.notOwnerSettings", { host: hostLabel });
      else {
        // The module must suit the host the page edits, not just some host of the scope.
        // (Not read yet / offline: the page still opens, showing its host's state; gated cards wait.)
        const gate = hostGate(capabilitiesOf(entry.moduleId), target.host);
        if (!gate.ok && !gate.waiting) pageDisabled = upgrade(gate.missing);
      }
    }
    const pageTitle = text(item.titleKey);
    // Host pages: their header picks the host (multi-host; 「主机选择」 finds them).
    const pageKeywords = [...(item.keywords ?? []), ...(SETTINGS_HOST_PAGES.has(item.page) ? (["hostPicker.searchKeyword"] as const) : [])];
    docs.push({ page: item.page, pageOrder, pageTitle, anchor: null, sectionTitle: null, keywords: pageKeywords.map(text), disabled: pageDisabled });
    if (item.page === "modules") for (const module of moduleEntries) {
      docs.push({ page: item.page, pageOrder, pageTitle, anchor: `module-${module.id}`, sectionTitle: module.title, keywords: module.keywords, disabled: pageDisabled });
    }
    const card = (s: SettingsSearchSection, gate: SettingsGate) => {
      if (gate.kind === "hidden") return;
      const disabled = pageDisabled ?? (gate.kind === "notice" ? upgrade(gate.missing) : null);
      docs.push({ page: item.page, pageOrder, pageTitle, anchor: s.anchor, sectionTitle: text(s.titleKey), keywords: [...(s.keywords ?? []).map(text), ...(item.page === "general" && s.anchor === "terms" ? termKeywords : [])], disabled });
    };
    // A mixed page's host part (SettingsHostPart) is on the Settings target host, like the host pages.
    const partTarget = item.hostPart ? hostTarget : null;
    for (const s of item.sections ?? []) card(s, settingsCardGate(s, s.part === "host" && partTarget ? partTarget : target));
    for (const e of sections) {
      if (e.item.page !== item.page || !e.item.titleKey) continue;
      // As SettingsSections renders it: shown, a notice card (「需要升级 cutex」, shown disabled), or left out.
      const gate = settingsSectionGate(e, capabilitiesOf(e.moduleId, e.item), hostPage ? hostTarget : partTarget);
      // A shown section with its own cards is found by those cards.
      if (gate.kind === "show" && e.item.sections?.length) {
        for (const s of e.item.sections) card(s, settingsCardGate(s, target));
        continue;
      }
      card({ anchor: e.item.id, titleKey: e.item.titleKey, keywords: e.item.keywords }, gate);
    }
  });
  return docs;
}

/** The settings search index for the current language, host capabilities and modules. */
export function useSettingsSearchIndex(): SettingsSearchDoc[] {
  const { t, locale } = useI18n();
  const overrides = useTermOverrides();
  // Host pages follow the host Settings edits (lib/settingsHost), app pages the focus host: the same
  // targets Settings renders them with, through the same gate (lib/settingsGate).
  const settingsHost = useSettingsHost();
  const hostTarget = useSettingsGateTarget(settingsHost);
  const appTarget = useSettingsGateTarget(null);
  const hostLabel = useHostScope().host(settingsHost)?.label ?? settingsHost;
  const pages = useSlot("settings.page");
  const sections = useSlot("settings.section");
  const statuses = useModuleStatuses();
  // en loads on demand (i18n): the index is rebuilt when it arrives, so a search typed before then also finds the
  // English names. Opening Settings starts the load (the search lives there).
  const enCatalog = useEnglishCatalog();
  return useMemo(() => {
    // The other shipped language, with its own display terms: zh UI also matches English,
    // en-family UI also Chinese, other languages also English.
    const otherLocale = locale.startsWith("zh") ? "en" : locale.startsWith("en") ? "zh-CN" : "en";
    const otherCatalog: Partial<Record<MessageKey, string>> = otherLocale === "en" ? (enCatalog ?? {}) : zhCatalog;
    const otherTerms = resolveTerms(overrides, otherLocale);
    const text = (key: MessageKey): SearchText => ({ current: cleanText(t(key)), other: cleanText(applyTerms(otherCatalog[key] ?? enCatalog?.[key] ?? zhCatalog[key] ?? key, otherTerms, otherLocale)) });
    const modules = appModules();
    const reveal = revealUnlistedModules();
    const moduleEntries = modules.modules.filter((m) => listedInSettings(m.id, modules.isEnabled(m.id), reveal)).map((m) => ({
      id: m.id, title: m.displayName ? { current: m.displayName, other: m.displayName } : text(m.titleKey), keywords: [text(m.titleKey)],
    }));
    return settingsSearchDocs({ pages, sections, text, t, hostTarget, appTarget, hostLabel, capabilitiesOf,
      termKeywords: settingsTermSearchTexts(overrides, locale, otherLocale), moduleEntries });
  }, [t, locale, overrides, hostTarget, appTarget, hostLabel, pages, sections, statuses, enCatalog]);
}

// ---- reveal (scroll + flash after the page renders) ----

const useReveal = create<{ anchor: string | null; nonce: number }>(() => ({ anchor: null, nonce: 0 }));

/** Asks the open settings page to scroll to and flash the card `anchor` once it is rendered. */
export function requestSettingsReveal(anchor: string): void {
  useReveal.setState((s) => ({ anchor, nonce: s.nonce + 1 }));
}

/**
 * Runs `onReveal` when a reveal targets `anchor`: one requested before the card mounted (its page was
 * still loading) or while it is shown. A collapsed card uses it to open itself before it is flashed.
 */
export function useOnSettingsReveal(anchor: string, onReveal: () => void): void {
  const callback = useRef(onReveal);
  callback.current = onReveal;
  useEffect(() => {
    if (useReveal.getState().anchor === anchor) callback.current();
    return useReveal.subscribe((s, prev) => {
      if (s.anchor === anchor && s.nonce !== prev.nonce) callback.current();
    });
  }, [anchor]);
}

const REVEAL_TIMEOUT_MS = 3000;

/** Mounted by the Settings page: waits (pages load their data first) for the card, then flashes it. */
export function useSettingsReveal(): void {
  const win = useOwnerWindow();
  const { anchor, nonce } = useReveal();
  useEffect(() => {
    if (!anchor) return;
    const started = Date.now();
    let frame = 0;
    const tick = () => {
      const el = win.document.getElementById(settingsAnchorId(anchor));
      if (el) {
        flashElement(el);
        useReveal.setState({ anchor: null });
        return;
      }
      if (Date.now() - started < REVEAL_TIMEOUT_MS) frame = win.requestAnimationFrame(tick);
      else useReveal.setState({ anchor: null });
    };
    frame = win.requestAnimationFrame(tick);
    return () => win.cancelAnimationFrame(frame);
  }, [anchor, nonce, win]);
}
