// One gate for what a settings page shows, shared by the rendering (modules/Outlet SettingsSections)
// and the settings search index (lib/settingsSearchView), so a search result never leads to a card the
// page does not render, or to a bare 「需要升级 cutex」. It answers per page target: the host a host
// page edits (lib/settingsHost) with its capabilities and this desktop's role there, or no host (an
// app page: the slot's own scope-wide mode decides). No hooks here: lib/settingsGateView.ts.
import type { SettingsSearchSection, SettingsSectionItem } from "../modules/slots";
import type { SettingsTab } from "../store"; // type only (erased)
import { hostGate, type HostFeatureView } from "./hostGating";
import { SETTINGS_HOST_PAGES, SETTINGS_MEMBER_PAGES } from "./settingsHost";
import type { SettingsSource } from "./settingsNav";

/** Who this desktop is on the target host. */
export interface SettingsAccess {
  isOwner: boolean;
  pending: boolean;
}

/** The host a settings page reads / writes, as the gate needs it. */
export interface SettingsGateTarget {
  /** null: an app page (no target host; the slot modes decide). */
  hostId: string | null;
  /** The target host's capabilities (null: not connected). An app page: the focus host's (page-declared cards). */
  host: HostFeatureView | null;
  /** This desktop's role there (null: an app page). */
  access: SettingsAccess | null;
}

export type SettingsGate = { kind: "show" } | { kind: "notice"; missing: readonly string[] } | { kind: "hidden" };

const SHOW: SettingsGate = { kind: "show" };
const HIDDEN: SettingsGate = { kind: "hidden" };

/** A host page (= Settings renders it under the host picker's TargetHostContext). */
export function isSettingsHostPage(item: { page: SettingsTab; source: SettingsSource | null }): boolean {
  return SETTINGS_HOST_PAGES.has(item.page) && (item.source === "host" || item.source === "codex");
}

/**
 * The page as a whole for `access` there: "notOwner" / "pending" when Settings shows only the
 * 「主机设置归主机所有者」 note (a host page other than the member pages, on another user's connection).
 */
export function settingsPageAccess(item: { page: SettingsTab; source: SettingsSource | null }, access: SettingsAccess | null): "ok" | "notOwner" | "pending" {
  if (!access || access.isOwner || !isSettingsHostPage(item) || SETTINGS_MEMBER_PAGES.has(item.page)) return "ok";
  return access.pending ? "pending" : "notOwner";
}

/**
 * A `settings.section` slot entry on its page. `required` = module ∪ item capabilities
 * (lib/hostGatingView capabilitiesOf). With a target host: the slot's scope-wide "show" must also suit
 * that host (missing → the item's notice, or nothing; still loading → nothing), and the section is the
 * owner's (a member page shows other users their own cards instead). Without one: the slot mode only.
 */
export function settingsSectionGate(
  entry: { mode: "show" | "disable" | "notice"; missing: readonly string[]; waiting: boolean; item: Pick<SettingsSectionItem, "unavailable" | "titleKey"> },
  required: readonly string[],
  target: SettingsGateTarget | null,
): SettingsGate {
  const onHost = target?.hostId != null;
  if (onHost && target.access && !target.access.isOwner) return HIDDEN;
  const notice = (missing: readonly string[]): SettingsGate => ((entry.item.unavailable ?? "hide") === "notice" && entry.item.titleKey ? { kind: "notice", missing } : HIDDEN);
  if (entry.mode === "show") {
    if (!onHost) return SHOW;
    const gate = hostGate(required, target.host);
    if (gate.ok) return SHOW;
    return gate.waiting ? HIDDEN : notice(gate.missing);
  }
  if (entry.mode !== "notice" || entry.waiting) return HIDDEN;
  return notice(entry.missing);
}

/**
 * A card a page (or a section) renders itself (`SettingsSearchSection`): hidden for the wrong role,
 * with a `hiddenWith` capability, or while the host's capabilities are unknown; "notice" = the page
 * leaves it out for a missing `requires` capability (search shows it greyed with the reason).
 */
export function settingsCardGate(card: Pick<SettingsSearchSection, "requires" | "hiddenWith" | "access" | "part">, target: Pick<SettingsGateTarget, "host" | "access">): SettingsGate {
  const access = target.access ?? { isOwner: true, pending: false };
  // A host part's cards (and owner cards) are the host owner's: other connections see a notice there.
  if ((card.access === "owner" || card.part === "host") && !access.isOwner) return HIDDEN;
  if (card.access === "member" && (access.isOwner || access.pending)) return HIDDEN;
  const features = target.host?.featuresKnown ? target.host.features : null;
  if ((card.hiddenWith?.capabilities ?? []).some((c) => features?.has(c))) return HIDDEN;
  const gate = hostGate(card.requires?.capabilities ?? [], target.host);
  if (gate.ok) return SHOW;
  return gate.waiting ? HIDDEN : { kind: "notice", missing: gate.missing };
}
