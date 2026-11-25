// 浏览器身份 in a 「我的浏览器」 card's tab row (design browser-profiles v3 §2): the switcher at the row's start (the
// identity new tabs use) and ＋▾ (one new tab in another identity, the current choice unchanged). Only on the fixed
// page and only while main serves identities; the switcher shows from one identity on (its menu creates the second),
// ▾ from two.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../i18n";
import { openMenuFrom } from "../../lib/contextMenu";
import { ICON_GHOST } from "../../components/Button";
import { usePaneHeaderCompact } from "../../lib/paneHeader";
import type { SideTabRowProps } from "../slots";
import type { BrowserState } from "./browserState";
import { identityRequest, useBrowserIdentities, useIdentitiesShown, useIdentity } from "./identities";
import { IdentityBadge } from "./IdentityBadge";
import { IdentityEditDialog } from "./IdentityEditDialog";
import { newTabMenu, switcherMenu } from "./identityMenus";

export function BrowserIdentitySwitcher({ fixedPage, cardId }: SideTabRowProps<BrowserState>) {
  const { t } = useI18n();
  const supported = useBrowserIdentities((s) => s.supported);
  const current = useIdentity(useBrowserIdentities((s) => s.state?.current));
  const [creating, setCreating] = useState(false);
  // Short of room (the header went compact): the mark only; the name is in the tooltip.
  const compact = usePaneHeaderCompact();
  if (!fixedPage || !supported || !current) return null;
  const tip = `${t("browser.identity.switcher", { name: current.name })}\n${t("browser.identity.switcherHint")}`;
  return (
    <>
      <button type="button" data-identity-switcher={current.id} data-tip={tip} aria-label={t("browser.identity.switcher", { name: current.name })} aria-haspopup="menu"
        onClick={(e) => openMenuFrom(e.currentTarget, switcherMenu(() => setCreating(true)), { owner: `identity:${cardId}` })}
        className="mr-0.5 flex h-6 max-w-[7.5rem] shrink-0 items-center gap-1 rounded-full py-0.5 pr-1.5 pl-0.5 text-xs text-muted hover:bg-hover hover:text-foreground">
        <IdentityBadge view={current} size={18} />
        {!compact && <span className="min-w-0 truncate">{current.name}</span>}
        <ChevronDown size={11} className="shrink-0 opacity-70" />
      </button>
      {creating && <IdentityEditDialog onClose={() => setCreating(false)} onCreated={(view) => void identityRequest((ids) => ids.setCurrent(view.id)).catch(() => {})} />}
    </>
  );
}

export function BrowserNewTabMenu({ fixedPage, cardId, newTab }: SideTabRowProps<BrowserState>) {
  const { t } = useI18n();
  const shown = useIdentitiesShown();
  if (!fixedPage || !shown) return null;
  return (
    <button type="button" data-identity-new-tab-menu data-tip={t("browser.identity.newTabMenu")} aria-label={t("browser.identity.newTabMenu")} aria-haspopup="menu"
      onClick={(e) => openMenuFrom(e.currentTarget, newTabMenu(newTab), { owner: `identity-new:${cardId}` })}
      className={`${ICON_GHOST} -ml-1 !w-4 !min-w-4`}>
      <ChevronDown size={11} />
    </button>
  );
}
