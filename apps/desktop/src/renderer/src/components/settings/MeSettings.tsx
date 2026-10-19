// Settings → 你 (shell page "me", local, every connection; docs/research/identity-settings-review-20261015.md
// §4.1): 「你」 — name, picture and the identity key (components/settings/IdentitySettings.tsx
// IdentitySection) — then 你在各主机上: one row per configured host saying which user you are there
// (the `user` block of its `/v2/capabilities`, lib/hostAccess; lib/myAccess), what this desktop is on
// it (the root credential, or its token's name: cutex C1 `user.token`, else the owner's `/v2/users`
// listing), and at most one exception on the right (sync / claim failed, the host does not know your
// identity yet — 记住 —, changed elsewhere, older host, syncing). A disconnected host shows the last
// known row (lib/hostAccess lastAccessOf). This machine's own host is hidden while cutex is not
// installed here and other hosts exist (the 主机 page handles setup). A row switches to that host.
// On the right of a row its manager (连接 restructure 2026-10-19): 管理访问 → (you own it: picks that host
// as the Settings target and opens 访问管理) or 由主人管理. The page ends with 我的设备 → 设备管理.
import { useState } from "react";
import { bridge } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { statusDot } from "../../lib/hosts";
import type { HostLook } from "../../lib/hostScope";
import { useIdentitySyncStatus, type IdentitySyncStatus } from "../../lib/identitySync";
import { hostIssue } from "../../lib/myAccess";
import { useMyHost } from "../../lib/myHost";
import { usePersonIdentity } from "../../lib/personIdentity";
import { settingsAnchorId } from "../../lib/settingsNav";
import { setSettingsHost } from "../../lib/settingsHost";
import { useHostData, useHostScope } from "../../lib/useHostScope";
import { selfKeyUnknown, withPersonKey } from "../../lib/personKeys";
import { useApp } from "../../store";
import type { HostClaimView } from "../../../../shared/personIdentity";
import { IdentitySection } from "./IdentitySettings";
import { DeviceLineText, RoleLine } from "./MyHostLines";
import { Button, LinkRow, Section } from "./Form";

/** Settings → 你. */
export function MePage() {
  const { t } = useI18n();
  return (
    <>
      <IdentitySection />
      <AccessSection />
      <Section>
        <LinkRow label={t("shell.me.devices.label")} hint={t("shell.me.devices.hint")} link={t("shell.me.devices.link")} onClick={() => useApp.getState().openSettings("hosts")} />
      </Section>
    </>
  );
}

/** 管理访问: that host becomes the Settings target, then its page 主机 opens. */
function manageAccess(hostId: string) {
  setSettingsHost(hostId);
  useApp.getState().openSettings("access");
}

function AccessSection() {
  const { t } = useI18n();
  const scope = useHostScope();
  const sync = useIdentitySyncStatus();
  const identity = usePersonIdentity();
  const local = useHostData("local");
  // A desktop-only machine (cutex not installed here) does not list itself among other hosts.
  const hideLocal = scope.hosts.length > 1 && local?.daemon.kind === "unreachable" && local.daemon.setup === "notInstalled";
  return (
    <Section id={settingsAnchorId("access")} title={t("me.access.title")} hint={t("me.access.hint")}>
      <ul className="-mx-4 divide-y divide-border" data-testid="my-access">
        {scope.hosts
          .filter((look) => !(hideLocal && look.id === "local"))
          .map((look) => (
            <AccessRow key={look.id} look={look} sync={sync[look.id]} claim={identity.claims[look.id]} publicKey={identity.publicKey} />
          ))}
      </ul>
    </Section>
  );
}

const apiOf = (hostId: string) => (bridge.apiFor ? bridge.apiFor(hostId) : bridge.api);

function AccessRow({ look, sync, claim, publicKey }: { look: HostLook; sync: IdentitySyncStatus | undefined; claim: HostClaimView | undefined; publicKey: string | null }) {
  const { t } = useI18n();
  const me = useMyHost(look.id);
  const [busy, setBusy] = useState(false);
  const owner = me.owner;
  const unknownSelf = me.ownerConn && !!owner.list && selfKeyUnknown(owner.list.users, publicKey);
  const issue = me.connected ? hostIssue({ sync, claim, selfUnknown: unknownSelf, noUsers: me.live.role === "older" }) : null;
  // 记住: put this desktop's key on the owner (the person who holds this connection).
  const remember = async () => {
    const user = owner.list?.users.find((u) => u.isOwner);
    if (!user || !publicKey) return;
    setBusy(true);
    try {
      await apiOf(look.id).putUserPersonKeys(user.id, withPersonKey(user, { publicKey }));
    } finally {
      setBusy(false);
      owner.reload();
    }
  };
  const switchTo = () => void useApp.getState().switchHost(look.id).catch(() => {});
  const status = look.indicator.status;
  // Owner (or an older cutex without users = the owner): 管理访问 →; member / pending: 由主人管理.
  const role = me.row.role;
  const manage = role === "owner" || role === "older" ? "owner" : role === "member" || role === "pending" ? "member" : null;
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-surface-2/50"
        title={t("me.access.switch", { host: look.label })}
        onClick={switchTo}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), switchTo())}
        data-testid="my-access-row"
      >
        <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: look.color }} aria-hidden />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate font-medium">{look.label}</span>
            {/* Only a connection on its way or in trouble; 未连接 is line 2's. */}
            {status !== "online" && status !== "disconnected" && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-subtle">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot(status)}`} aria-hidden />
                {t(`host.status.${status}` as MessageKey)}
              </span>
            )}
          </div>
          <RoleLine row={me.row} stale={me.stale} />
          <DeviceLineText device={me.device} />
        </div>
        {issue && (
          <div className="flex shrink-0 items-center gap-2 text-xs" data-testid="my-access-issue">
            <span className={issue.tone === "danger" ? "text-danger" : issue.tone === "warn" ? "text-warn" : "text-subtle"} title={issue.error ?? undefined}>
              {t(issue.key)}
            </span>
            {issue.remember && (
              <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <Button disabled={busy || !owner.list} onClick={() => void remember()}>
                  {t("me.access.issue.remember")}
                </Button>
              </span>
            )}
          </div>
        )}
        {manage && (
          // Your role there decides who manages its access: you (管理访问 →) or its owner.
          <span className="mt-0.5 shrink-0 text-xs" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} data-testid="my-access-manage">
            {manage === "owner" ? (
              <button type="button" className="text-accent hover:underline" title={t("shell.me.manageTitle", { host: look.label })} onClick={() => manageAccess(look.id)}>
                {t("shell.me.manage")}
              </button>
            ) : (
              <span className="text-subtle">{t("shell.me.managedByOwner")}</span>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
