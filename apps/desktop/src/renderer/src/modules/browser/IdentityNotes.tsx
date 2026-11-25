// 浏览器身份 where a tab shows it (design browser-profiles v3 §2, §4): the address bar's identity chip, and the hand-over
// picker's note (which identity's logins the agent gets, and the sites signed in to there — names only, no content).
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { identityColor, identityRequest, useIdentitiesShown, useIdentity } from "./identities";

/** The chip at the start of the address box: a non-default identity's name in its colour (several identities). */
export function BrowserIdentityChip({ identityId, narrow }: { identityId: string | undefined; narrow: boolean }) {
  const { t } = useI18n();
  const shown = useIdentitiesShown();
  const identity = useIdentity(identityId);
  const color = identityColor(identity);
  if (!shown || !identity || identity.isDefault || !color) return null;
  const label = narrow ? identity.initial || [...identity.name][0] : identity.name;
  return (
    <span data-browser-identity-chip={identity.id} title={t("browser.identity.chipTitle", { name: identity.name })}
      className="flex h-5 max-w-[7rem] shrink-0 items-center rounded-chip px-1.5 text-caption font-medium"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

/** In the hand-over picker of an owner tab: the identity whose logins go with the tab, and its signed-in sites. */
export function GrantIdentityNote({ identityId, hostId }: { identityId: string | undefined; hostId: string }) {
  const { t } = useI18n();
  const shown = useIdentitiesShown();
  const identity = useIdentity(identityId);
  const [sites, setSites] = useState<string[] | null>(null);
  const id = identity?.id;
  useEffect(() => {
    if (!shown || !id) return;
    let live = true;
    void identityRequest((ids) => ids.signedInSites(id, hostId)).then((list) => { if (live) setSites(list); }, () => { if (live) setSites(null); });
    return () => { live = false; };
  }, [shown, id, hostId]);
  if (!shown || !identity) return null;
  return (
    <div role="note" data-browser-grant-identity={identity.id} className="border-b border-border px-2.5 py-2 text-caption leading-relaxed text-muted">
      <p>{t("browser.identity.grantIdentity", { name: identity.name })}</p>
      {sites && (sites.length ? <>
        <p className="mt-1 text-subtle">{t("browser.identity.grantSites")}</p>
        <p data-browser-grant-sites className="mt-0.5 line-clamp-3 break-all text-foreground">{sites.join(" · ")}</p>
      </> : <p className="mt-1 text-subtle">{t("browser.identity.grantNoSites")}</p>)}
      <p className="mt-1 text-subtle">{t("browser.identity.grantOnly")}</p>
    </div>
  );
}
