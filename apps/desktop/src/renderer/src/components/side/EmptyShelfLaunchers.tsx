import { useEffect } from "react";
import { useI18n } from "../../i18n";
import { shelfLauncherSections } from "../../lib/emptyShelfLaunchers";
import { preloadOnIntent } from "../../lib/lazyPage";
import { useSideRegistry } from "../../lib/sideComponents";
import { launch, launchable } from "../../lib/sideMenus";
import "./emptyShelf.css";

/** A Shelf's own launch target is retained even when another workspace takes focus. */
export function EmptyShelfLaunchers({ pageId, kinds }: { pageId: string | null; kinds?: readonly string[] }) {
  const { t } = useI18n();
  useSideRegistry();
  useEffect(() => void preloadOnIntent(), []);
  const sections = shelfLauncherSections(launchable(true).filter((item) => !kinds || kinds.includes(item.kind)));
  if (!sections.length) return <p className="text-xs text-subtle">{t("side.launcher.none")}</p>;
  return <div className="empty-shelf-launchers" data-empty-shelf-launchers>
    {sections.map(({ section, entries }) => <section key={section} aria-label={t(`side.launcher.${section}`)}>
      <h4>{t(`side.launcher.${section}`)}</h4>
      <div className="empty-shelf-grid">
        {entries.map(({ kind, label, Icon, params }) => <button type="button" key={kind}
          className="empty-shelf-tile" onClick={() => launch(kind, params, pageId)}>
          <Icon size={22} aria-hidden="true" /><span>{label}</span>
        </button>)}
      </div>
    </section>)}
  </div>;
}
