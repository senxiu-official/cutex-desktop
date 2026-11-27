// Settings → 新功能 (onboarding v3, owner 2026-11-26): every 0.2.x version's notes, newest first, from the bundled
// changelog — the same notes the upgrade dialog shows (lib/releaseNotes: internal build names left out). The installed
// version (else the newest) opens; older ones fold. 0.1.x stays in 关于 → 更新记录 only. Always reachable, no daemon calls.
import { useMemo, useState } from "react";
import { changelogText, type ChangelogRelease } from "../../../../shared/changelog";
import { Section } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useBundledReleases } from "../../lib/onboarding";
import { featureReleases, releaseItems } from "../../lib/releaseNotes";
import { useUpdateStatus } from "../../lib/update";

/** Items shown before 「还有 N 条」 in an open version. */
export const FIRST_ITEMS = 8;

function Release({ release, current, open, onToggle }: { release: ChangelogRelease; current: boolean; open: boolean; onToggle(): void }) {
  const { t, locale } = useI18n();
  const [all, setAll] = useState(false);
  const items = useMemo(() => releaseItems(release), [release]);
  const shown = all ? items : items.slice(0, FIRST_ITEMS);
  const title = (
    <span className="flex items-center gap-2">
      {release.version}
      {release.title && <span className="font-normal text-subtle">「{release.title}」</span>}
      {release.date && <span className="text-meta font-normal text-subtle">{release.date}</span>}
      {current && <span className="rounded-full border border-ok/40 px-2 text-meta font-normal text-ok">{t("start.whatsNew.current")}</span>}
    </span>
  );
  return (
    <div data-release={release.version} data-open={open}>
      <Section title={title} actions={<button type="button" onClick={onToggle} className="text-meta text-accent hover:underline">{t(open ? "start.whatsNew.collapse" : "start.whatsNew.expand")}</button>}>
        {open && (items.length ? (
          <ul className="list-disc space-y-1 pl-5 text-ui text-muted">
            {shown.map((b, i) => <li key={i}>{changelogText(b, locale)}</li>)}
            {!all && items.length > shown.length && (
              <li className="list-none">
                <button type="button" onClick={() => setAll(true)} className="text-meta text-accent hover:underline">{t("start.whatsNew.more", { n: items.length - shown.length })}</button>
              </li>
            )}
          </ul>
        ) : <p className="text-ui text-muted">{t("start.whatsNew.empty")}</p>)}
      </Section>
    </div>
  );
}

export function NewFeaturesPage() {
  const { t } = useI18n();
  const installed = useUpdateStatus()?.current?.version ?? null;
  const bundled = useBundledReleases();
  const releases = useMemo(() => featureReleases(bundled), [bundled]);
  const current = releases.find((r) => r.version === installed)?.version ?? releases[0]?.version ?? null;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(current ? [current] : []));
  const toggle = (v: string) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  });
  return (
    <div className="space-y-4" data-new-features="">
      <p className="text-meta text-muted">{t("start.whatsNew.hint")}</p>
      {releases.map((r) => <Release key={r.version} release={r} current={r.version === installed} open={open.has(r.version)} onToggle={() => toggle(r.version)} />)}
    </div>
  );
}
