// Settings → 关于: the module's two cards below the shell's version card — 项目 (license + links,
// opened in the system browser) and 已知问题 (docs/known-issues.json: the release branch's copy when
// main fetched one, else the built-in list; ./knownIssues.ts). Issue texts are plain text: only the
// display terms (`{{agent}}`) are filled in, nothing is rendered as HTML / Markdown or linked.
import { ExternalLink } from "lucide-react";
import { applicableIssues, localizedText } from "../../../../shared/knownIssues";
import { api } from "../../bridge";
import { useI18n } from "../../i18n";
import { Section, SettingRow } from "../../components/settings/Form";
import { applyTerms, resolveTerms, useTermOverrides } from "../../lib/terms";
import { formatAbsolute, formatWhen } from "../../lib/time";
import { useUpdateStatus } from "../../lib/update";
import { useApp } from "../../store";
import { ABOUT_LINKS, useKnownIssues } from "./knownIssues";

const LINK = "inline-flex items-center gap-1 whitespace-nowrap rounded text-xs text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none";

export function AboutLinksSection() {
  const { t } = useI18n();
  return (
    <Section title={t("about.links.section")}>
      <SettingRow label={t("about.license")} hint={t("about.licenseHint")}>
        <span className="font-mono text-xs text-muted">Apache-2.0</span>
      </SettingRow>
      <SettingRow label={t("about.links")} hint={t("about.linksHint")}>
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 group-data-[narrow]/card:justify-start">
          {ABOUT_LINKS.map((l) => (
            <button key={l.id} type="button" className={LINK} title={l.url} onClick={() => void api.openExternal(l.url)}>
              {t(l.labelKey)}
              <ExternalLink size={11} aria-hidden />
            </button>
          ))}
        </span>
      </SettingRow>
    </Section>
  );
}

export function KnownIssuesSection() {
  const { t, locale } = useI18n();
  const terms = resolveTerms(useTermOverrides(), locale);
  const view = useKnownIssues();
  // Entries with `appliesTo` hide on versions outside their range (unknown versions: shown).
  const desktop = useUpdateStatus()?.current?.version ?? null;
  const cutex = useApp((s) => s.hosts?.hosts.find((h) => h.id === s.hosts?.active)?.conn?.cutexBuild?.release ?? null);
  const issues = applicableIssues({ schema: 1, issues: [...view.issues] }, { desktop, cutex });
  const text = (value: Parameters<typeof localizedText>[0]) => applyTerms(localizedText(value, locale), terms, locale);
  const fetchedAt = view.fetchedAt ? Date.parse(view.fetchedAt) / 1000 : null;
  return (
    <Section title={t("about.knownIssues")} hint={t("about.knownIssuesHint")}>
      <p data-known-issues-source={view.source} className="pb-1 text-[11px] text-subtle" title={fetchedAt !== null ? formatAbsolute(fetchedAt) : undefined}>
        {view.source === "github" && fetchedAt !== null
          ? t(view.stale ? "about.sourceGithubStale" : "about.sourceGithub", { time: formatWhen(fetchedAt, Date.now(), locale) })
          : t("about.sourceBuiltin")}
      </p>
      {issues.length === 0 ? (
        <p className="py-3 text-xs text-muted">{t("about.noIssues")}</p>
      ) : (
        <ul>
          {issues.map((issue) => (
            <li key={issue.id} data-issue={issue.id} className="border-b border-border/60 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm">{text(issue.title)}</span>
                {issue.fixedIn && <span className="shrink-0 rounded-full bg-accent/15 px-2 text-[11px] leading-5 text-accent">{t("about.fixedIn", { version: issue.fixedIn })}</span>}
              </div>
              <p className="mt-1 whitespace-pre-line text-xs text-subtle">{text(issue.body)}</p>
              {issue.workaround && <p className="mt-1 whitespace-pre-line text-xs text-muted">{t("about.workaround", { text: text(issue.workaround) })}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
