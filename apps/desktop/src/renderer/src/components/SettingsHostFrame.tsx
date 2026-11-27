// The Settings target host around host settings (review 2026-10-15 UI-01 / UI-02).
// - SettingsHostFrame: what a host page (or a page's host part) renders inside. It makes the Settings
//   target the page's target host (lib/targetHost) and, while that host is not online, keeps the
//   page mounted with its last read data (lib/heldHostData) — drafts survive — shows why, and
//   disables every control in it (a disabled <fieldset>): no edit is sent to it, none to another host.
// - SettingsHostPart: the host half of a mixed page (浏览器, 通知): a heading with the Settings host
//   picker (the same choice as the host pages), the owner check, a 「需要升级 cutex」 notice when the
//   target lacks the part's capability, then the frame. SettingsDevicePart: the other half's heading.
import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { HeldHostDataContext, type HeldHostData } from "../lib/heldHostData";
import { useHostAccess } from "../lib/hostAccess";
import { hostPickerMode } from "../lib/hostPick";
import { setSettingsHost, useSettingsTarget, type SettingsTarget } from "../lib/settingsHost";
import { TargetHostContext, useTargetFeatures } from "../lib/targetHost";
import { useHostData, useHostScope } from "../lib/useHostScope";
import { HostPicker } from "./HostPicker";
import { Banner, EmptyState, Notice, Section } from "./settings/Form";
import { WifiOff } from "lucide-react";

// The last data each host reported while its capabilities were known (kept across page visits:
// opening a page of a host that is offline now still shows what it had).
const lastHostData = new Map<string, HeldHostData>();

/** `hostId`'s last known data, refreshed from its live data while that is known. */
function useLastHostData(hostId: string): HeldHostData | null {
  const live = useHostData(hostId);
  if (live?.featuresKnown) {
    const before = lastHostData.get(hostId);
    if (before?.features !== live.features || (live.sidebar && before.sidebar !== live.sidebar)) lastHostData.set(hostId, { hostId, features: live.features, featuresKnown: true, sidebar: live.sidebar ?? before?.sidebar ?? null });
  }
  return lastHostData.get(hostId) ?? null;
}

/** Host settings of `target`: its data, an offline notice and no edits while it is not online. */
export function SettingsHostFrame({ target, children }: { target: SettingsTarget; children: ReactNode }) {
  const { t } = useI18n();
  const scope = useHostScope();
  const held = useLastHostData(target.hostId);
  const label = scope.host(target.hostId)?.label ?? target.hostId;
  return (
    <TargetHostContext.Provider value={target.hostId}>
      <HeldHostDataContext.Provider value={target.available ? null : held}>
        {!target.available && (
          <Banner className="mb-4" attrs={{ role: "status", "data-settings-host-offline": target.hostId }} icon={<WifiOff size={16} />}>
            {t("settings.hostOffline", { host: label })}
          </Banner>
        )}
        <fieldset disabled={!target.available} data-settings-host={target.hostId} className="m-0 min-w-0 border-0 p-0 disabled:opacity-70">
          {children}
        </fieldset>
      </HeldHostDataContext.Provider>
    </TargetHostContext.Provider>
  );
}

export function SettingsDevicePart({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <div data-settings-part="device" className="mb-4">
      {/* No part headings (owner 2026-10-19: one rule — a 混合设置 page's cards are tagged). */}
      {children}
    </div>
  );
}

/** The capability gate inside the frame (the target's live or held capabilities). */
function RequiresGate({ requires, children }: { requires: readonly string[]; children: ReactNode }) {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const missing = requires.filter((c) => !features.has(c));
  if (!missing.length) return <>{children}</>;
  // An empty list = not read yet (connecting): nothing rather than a wrong 「需要升级」.
  if (!features.size) return null;
  return (
    <Section>
      <Notice tone="info">{t("modules.needsUpgrade", { feature: missing.join(", ") })}</Notice>
    </Section>
  );
}

/**
 * A mixed page's host half: heading + the Settings host picker (always shows which host), then the
 * frame on the Settings target. `requires`: capabilities the whole half needs (else 「需要升级 cutex」).
 * `title` omitted (owner 2026-10-19): no heading; each host card carries the picker in its scope tag.
 */
export function SettingsHostPart({ title, hint, requires, children }: { title?: string; hint?: string; requires?: readonly string[]; children: ReactNode }) {
  const { t } = useI18n();
  const target = useSettingsTarget();
  const scope = useHostScope();
  const access = useHostAccess(target.hostId);
  const label = scope.host(target.hostId)?.label ?? target.hostId;
  return (
    <div data-settings-part="host" data-settings-part-host={target.hostId}>
      {!access.isOwner ? (
        <Section>
          <EmptyState>{t(access.pending ? "users.access.pendingSettings" : "users.access.notOwnerSettings", { host: label })}</EmptyState>
        </Section>
      ) : (
        // A host per frame: an explicit switch starts the half over (no state of one host shown for another).
        <SettingsHostFrame key={target.hostId} target={target}>
          {requires?.length ? <RequiresGate requires={requires}>{children}</RequiresGate> : children}
        </SettingsHostFrame>
      )}
    </div>
  );
}

/**
 * The one host picker of Settings (owner 2026-11-28: 「全部统一为顶部那种：可以随时切换」): the title bar switcher's
 * look, in the header of every page with host settings (a host page, or an app page with a host part). It sets the
 * one Settings host (lib/settingsHost), so every page shows the same host; cards never carry a picker of their own.
 * It follows the title bar (a switch there resets it to the new focus host) and never drives it: picking a host here
 * edits that host's settings without changing what the window shows (docs/design/settings-rules.md).
 */
export function SettingsHostSwitcher({ all, onPick }: { all?: { label: string; hint?: string; selected: boolean; onSelect(): void }; onPick?(hostId: string): void }) {
  const { t } = useI18n();
  const target = useSettingsTarget();
  const scope = useHostScope();
  const mode = hostPickerMode(scope, target.hostId);
  return (
    <HostPicker
      switcher
      value={target.hostId}
      onChange={(id) => {
        onPick?.(id);
        setSettingsHost(id);
      }}
      mode={mode}
      title={t("hostPicker.settingsTitle")}
      all={all}
    />
  );
}
