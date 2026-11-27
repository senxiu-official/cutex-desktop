// The app's own settings-sync categories (design 056 §12, owner 2026-11-26). On by default: 外观, 术语与语言, 模块开关,
// 侧栏显示选项, 引导与「新功能」已看, 侧栏布局 (phase 1). Off by default (screen- or device-dependent, opt-in only):
// 缩放、字号、密度与宽度, 工作区组合, Shelf 默认布局. Never synced: window positions, the host list, credentials, browser
// logins, drafts, each conversation's own Shelf, unread marks.
import type { MessageKey } from "../../i18n";
import { currentLocale, requestLocale } from "../../i18n";
import { APP_LOCALES, type AppLocale } from "../../../../shared/locales";
import { applyContrast, applyDarkPalette, applyLightPalette, applyTheme, DARK_PALETTES, LIGHT_PALETTES, loadContrast, loadDarkPalette, loadLightPalette, loadTheme, type ContrastPref, type DarkPalette, type LightPalette, type ThemePref } from "../theme";
import { applyAccent, isAccentPreset, loadAccent, parseAccentPref } from "../accent";
import { appIconLook, applyAppIcon, isKnownAppIcon, loadAppIcon } from "../appIcon";
import { DEFAULT_APP_ICON } from "../../../../shared/appIcons";
import { getTermOverrides, replaceTermOverrides, subscribeTerms } from "../terms";
import { LANGUAGES } from "../languages";
import { getUiPrefs, setUiPref, subscribeUiPrefs, type UiPrefs } from "../prefs";
import { getOnboarding, setOnboardingSeen, subscribeOnboarding } from "../onboarding";
import { getGuides, replaceGuideState, subscribeGuides } from "../guides";
import { getAppearance, setAppearance, subscribeAppearance } from "../appearance";
import type { Appearance } from "../appearanceModel";
import { mainWorkspaceSets, replaceMainWorkspaceSets, type WsSet } from "../workspaceSets";
import { shelfTemplateParts, writeShelfTemplatePart } from "../paneFile";
import { appModules } from "../../modules/app";
import { registerSyncCategory, type SyncCategory, type SyncContext, type Translate } from "./registry";
import type { SyncValue, SyncValues } from "./model";

const THEMES: readonly ThemePref[] = ["system", "light", "dark"];
const CONTRASTS: readonly ContrastPref[] = ["standard", "high", "max"];
const str = (v: SyncValue | undefined): string | null => (typeof v === "string" ? v : null);
const one = <T extends string>(v: SyncValue | undefined, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const join = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");

export const appearanceCategory: SyncCategory = {
  id: "appearance", order: 100, titleKey: "settingsSync.cat.appearance", hintKey: "settingsSync.cat.appearance.hint", defaultOn: true, pages: ["appearance"],
  read: () => ({ theme: loadTheme(), contrast: loadContrast(), lightPalette: loadLightPalette(), darkPalette: loadDarkPalette(), accent: loadAccent(), appIcon: loadAppIcon() }),
  write(v) {
    const theme = one(v.theme, THEMES); if (theme) applyTheme(theme);
    const contrast = one(v.contrast, CONTRASTS); if (contrast) applyContrast(contrast);
    const light = one<LightPalette>(v.lightPalette, LIGHT_PALETTES); if (light) applyLightPalette(light);
    const dark = one<DarkPalette>(v.darkPalette, DARK_PALETTES); if (dark) applyDarkPalette(dark);
    const accent = str(v.accent); if (accent) applyAccent(parseAccentPref(accent));
    // 应用图标: a style this build lacks leaves this device on its own (lib/appIcon).
    if (isKnownAppIcon(v.appIcon) && v.appIcon !== loadAppIcon()) applyAppIcon(v.appIcon);
  },
  summary(v, t) {
    const theme = one(v.theme, THEMES); const accent = str(v.accent); const contrast = one(v.contrast, CONTRASTS);
    return join([
      theme && `${t("shell.theme")} ${t(`shell.theme.${theme}` as MessageKey)}`,
      accent && `${t("appearance.accent")} ${isAccentPreset(accent) ? t(`appearance.accent.${accent}` as MessageKey) : accent}`,
      contrast && contrast !== "standard" && `${t("shell.contrast")} ${t(`shell.contrast.${contrast}` as MessageKey)}`,
      isKnownAppIcon(v.appIcon) && v.appIcon !== DEFAULT_APP_ICON && `${t("appearance.appIcon")} ${appIconLook(v.appIcon).label(currentLocale())}`,
    ]);
  },
};

const isLocale = (v: SyncValue | undefined): v is AppLocale => typeof v === "string" && (APP_LOCALES as readonly string[]).includes(v);
export const languageCategory: SyncCategory = {
  id: "terms-language", order: 200, titleKey: "settingsSync.cat.termsLanguage", hintKey: "settingsSync.cat.termsLanguage.hint", defaultOn: true, pages: ["general"],
  read: () => ({ locale: currentLocale(), terms: getTermOverrides() as unknown as SyncValue }),
  write(v) {
    if ("terms" in v && v.terms && typeof v.terms === "object") replaceTermOverrides(v.terms);
    if (isLocale(v.locale) && v.locale !== currentLocale()) requestLocale(v.locale);
  },
  subscribe: subscribeTerms,
  summary(v, t) {
    const locale = isLocale(v.locale) ? v.locale : null;
    const label = locale ? LANGUAGES.find((l) => l.value === locale)?.label ?? (locale.startsWith("zh-Hant") ? LANGUAGES.find((l) => l.value === "zh-Hant-CN")?.label : locale) : null;
    const terms = v.terms && typeof v.terms === "object" ? Object.values(v.terms as Record<string, Record<string, unknown>>).reduce((n, byTerm) => n + Object.keys(byTerm ?? {}).length, 0) : 0;
    return join([label && `${t("shell.language")} ${label}`, terms > 0 && t("settingsSync.sum.terms", { n: terms })]);
  },
};

/** The module switches: only modules with a switch on this device; a synced module this device lacks is left alone
 *  (Settings → 你 offers its 下载; never downloaded by itself). */
export const modulesCategory: SyncCategory = {
  id: "modules", order: 300, titleKey: "settingsSync.cat.modules", hintKey: "settingsSync.cat.modules.hint", defaultOn: true, pages: ["modules"],
  read() {
    const host = appModules();
    return Object.fromEntries(host.modules.filter((m) => !m.required).map((m) => [m.id, host.isEnabled(m.id)]));
  },
  write(v) {
    const host = appModules();
    for (const [id, on] of Object.entries(v)) {
      const def = host.modules.find((m) => m.id === id);
      if (def && !def.required && typeof on === "boolean" && host.isEnabled(id) !== on) void host.setEnabled(id, on);
    }
  },
  summary: (v, t) => (Object.keys(v).length ? t("settingsSync.sum.modules", { on: Object.values(v).filter((x) => x === true).length, total: Object.keys(v).length }) : ""),
};

/** Synced modules turned on that this device does not have (an optional module not downloaded here). */
export function missingSyncedModules(synced: SyncValues | null): string[] {
  if (!synced) return [];
  const have = new Set(appModules().modules.map((m) => m.id));
  return Object.entries(synced).filter(([id, on]) => on === true && !have.has(id)).map(([id]) => id);
}

/** 侧栏显示选项: how rows and groups look — never widths (those are 缩放、字号、密度与宽度). */
export const SIDEBAR_DISPLAY_KEYS = [
  "sidebarLayout", "systemRows", "statusChips", "rowPreview", "needsYouStrip", "titleTwoLines", "projectSeparation", "projectIconStyle",
  "sectionCollapsedShows", "olderProjectsAfter", "noOnlineProjects", "projectGrouping", "runningAgents", "nameGrouping", "nameReading",
] as const satisfies readonly (keyof UiPrefs)[];
const NULLABLE: ReadonlySet<string> = new Set(["nameGrouping", "nameReading"]);
export const sidebarDisplayCategory: SyncCategory = {
  id: "sidebar-display", order: 400, titleKey: "settingsSync.cat.sidebarDisplay", hintKey: "settingsSync.cat.sidebarDisplay.hint", defaultOn: true, pages: ["sidebar"],
  read() {
    const p = getUiPrefs();
    return Object.fromEntries(SIDEBAR_DISPLAY_KEYS.map((k) => [k, (p[k] ?? null) as SyncValue]));
  },
  write(v) {
    const p = getUiPrefs();
    for (const k of SIDEBAR_DISPLAY_KEYS) {
      // Same JSON type as this build's value (null only where the setting allows it); anything else is skipped.
      if (!(k in v)) continue;
      const next = v[k]; const cur = p[k] as unknown;
      if (next === null ? !NULLABLE.has(k) : cur !== null && typeof next !== typeof cur) continue;
      setUiPref(k, next as never);
    }
  },
  subscribe: subscribeUiPrefs,
  summary: (v, t) => (Object.keys(v).length ? t("settingsSync.sum.options", { n: Object.keys(v).length }) : ""),
};

/** The sidebar layout itself (design 056 phase 1: sections, stars, order, pins). Off = this device keeps its own. */
export const sidebarLayoutCategory: SyncCategory = {
  id: "sidebar-layout", order: 450, titleKey: "settingsSync.cat.sidebarLayout", hintKey: "settingsSync.cat.sidebarLayout.hint", defaultOn: true, pages: ["sidebar"], kind: "layout",
  read: () => ({}), write: () => {}, summary: () => "",
};

/** 引导与「新功能」已看: what was seen on one device is not shown again on the next. Seen only grows (the larger wins). */
export const onboardingCategory: SyncCategory = {
  id: "onboarding", order: 500, titleKey: "settingsSync.cat.onboarding", hintKey: "settingsSync.cat.onboarding.hint", defaultOn: true, pages: [],
  read() {
    const o = getOnboarding(); const g = getGuides();
    return { doneRevision: o.doneRevision, lastWhatsNew: o.lastWhatsNew, guidesSeen: [...g.seen].sort(), guidesAsked: g.asked };
  },
  write(v) {
    const o = getOnboarding(); const g = getGuides();
    const seen: { doneRevision?: number; lastWhatsNew?: string | null } = {};
    if (typeof v.doneRevision === "number" && v.doneRevision > o.doneRevision) seen.doneRevision = v.doneRevision;
    if (typeof v.lastWhatsNew === "string" && v.lastWhatsNew !== o.lastWhatsNew) seen.lastWhatsNew = v.lastWhatsNew;
    if (Object.keys(seen).length) setOnboardingSeen(seen);
    const more = Array.isArray(v.guidesSeen) ? (v.guidesSeen as SyncValue[]).filter((x): x is string => typeof x === "string") : [];
    const asked = g.asked || v.guidesAsked === true;
    if (more.some((id) => !g.seen.includes(id)) || asked !== g.asked) replaceGuideState({ seen: [...new Set([...g.seen, ...more])], asked });
  },
  subscribe: (l) => { const a = subscribeOnboarding(l); const b = subscribeGuides(l); return () => { a(); b(); }; },
  summary(v, t) {
    return join([
      typeof v.doneRevision === "number" && v.doneRevision > 0 && t("settingsSync.sum.introDone"),
      typeof v.lastWhatsNew === "string" && t("settingsSync.sum.whatsNew", { version: v.lastWhatsNew }),
    ]);
  },
};

/** 缩放、字号、密度与宽度 (opt-in: they depend on the screen). Fonts are not here (installed fonts differ per device). */
export const SCALE_KEYS = ["zoom", "chatFontSize", "monoFontSize", "density", "capsuleScale", "sidebarWidth", "sidePaneWidth", "readingWidth", "workspaceWidth"] as const satisfies readonly (keyof Appearance)[];
export const scaleCategory: SyncCategory = {
  id: "scale", order: 600, titleKey: "settingsSync.cat.scale", hintKey: "settingsSync.cat.scale.hint", defaultOn: false, pages: ["appearance", "conversation"],
  read() { const a = getAppearance(); return Object.fromEntries(SCALE_KEYS.map((k) => [k, a[k] as SyncValue])); },
  write(v) {
    const a = getAppearance();
    const patch = Object.fromEntries(SCALE_KEYS.filter((k) => k in v && typeof v[k] === typeof a[k]).map((k) => [k, v[k]])) as Partial<Appearance>;
    if (Object.keys(patch).length) setAppearance(patch);
  },
  subscribe: subscribeAppearance,
  summary(v, t) {
    return join([
      typeof v.zoom === "number" && `${t("appearance.zoom")} ${Math.round(v.zoom)}%`,
      typeof v.density === "string" && `${t("appearance.density")} ${t(`appearance.density.${v.density}` as MessageKey)}`,
    ]);
  },
};

/** A host as stored in the person's document: its portable id (design 056 §3.1); unknown here = null. */
const portable = (hostId: string, ctx: SyncContext): string | null => ctx.hosts.find((h) => h.id === hostId)?.instanceId ?? null;
const local = (instanceId: string, ctx: SyncContext): string | null => ctx.hosts.find((h) => h.instanceId === instanceId)?.id ?? null;

/** 工作区组合 (opt-in; owner decision 6 kept them per device). Agents of a host this device lacks are left out here. */
export const workspaceSetsCategory: SyncCategory = {
  id: "workspace-sets", order: 700, titleKey: "settingsSync.cat.workspaceSets", hintKey: "settingsSync.cat.workspaceSets.hint", defaultOn: false, pages: ["tray"],
  read(ctx) {
    const sets = mainWorkspaceSets().map((s) => ({ id: s.id, at: s.at, members: s.members.flatMap((m) => { const host = portable(m.hostId, ctx); return host ? [{ host, id: m.sessionId }] : []; }) }));
    return { sets: sets.filter((s) => s.members.length > 0) };
  },
  write(v, ctx) {
    if (!Array.isArray(v.sets)) return;
    const sets: WsSet[] = [];
    for (const s of v.sets as { id?: unknown; at?: unknown; members?: unknown }[]) {
      if (!s || typeof s.id !== "string" || !Array.isArray(s.members)) continue;
      const members = (s.members as { host?: unknown; id?: unknown }[]).flatMap((m) => { const hostId = typeof m?.host === "string" ? local(m.host, ctx) : null; return hostId && typeof m.id === "string" ? [{ hostId, sessionId: m.id }] : []; });
      if (members.length) sets.push({ id: s.id, at: typeof s.at === "number" ? s.at : 0, members });
    }
    replaceMainWorkspaceSets(sets);
  },
  summary: (v, t) => (Array.isArray(v.sets) && v.sets.length ? t("settingsSync.sum.workspaceSets", { n: v.sets.length }) : ""),
};

/** Shelf 默认布局 (opt-in; design 056 §10 Q1 kept it per device): each host's default layout for new conversations. */
export const shelfTemplateCategory: SyncCategory = {
  id: "shelf-template", order: 800, titleKey: "settingsSync.cat.shelfTemplate", hintKey: "settingsSync.cat.shelfTemplate.hint", defaultOn: false, pages: ["sides"],
  read(ctx) {
    const out: SyncValues = {};
    for (const [hostId, part] of Object.entries(shelfTemplateParts())) { const host = portable(hostId, ctx); if (host) out[host] = part as SyncValue; }
    return out;
  },
  write(v, ctx) {
    for (const [instanceId, part] of Object.entries(v)) { const hostId = local(instanceId, ctx); if (hostId) writeShelfTemplatePart(hostId, part); }
  },
  summary: (v, t) => (Object.keys(v).length ? t("settingsSync.sum.shelfTemplates", { n: Object.keys(v).length }) : ""),
};

export const BUILT_IN_SYNC_CATEGORIES: readonly SyncCategory[] = [
  appearanceCategory, languageCategory, modulesCategory, sidebarDisplayCategory, sidebarLayoutCategory, onboardingCategory,
  scaleCategory, workspaceSetsCategory, shelfTemplateCategory,
];

let registered = false;
/** Once per window (App start). */
export function registerBuiltInSyncCategories(): void {
  if (registered) return;
  registered = true;
  for (const c of BUILT_IN_SYNC_CATEGORIES) registerSyncCategory(c);
}

export type { Translate };
