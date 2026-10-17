import { translate } from "../../i18n";
import { BROWSER_SITE_PERMISSIONS, type BrowserSitePermission } from "../../../../shared/browser";

/** Owner-facing names of what a site asked for (unknown values are dropped, never shown raw). */
export function browserSitePermissionList(permissions: readonly BrowserSitePermission[]): string {
  const known = permissions.filter(permission => (BROWSER_SITE_PERMISSIONS as readonly string[]).includes(permission)).slice(0, 4);
  return known.map(permission => translate(`browser.sitePermission.${permission}` as const)).join(translate("browser.sitePermissions.separator"));
}
