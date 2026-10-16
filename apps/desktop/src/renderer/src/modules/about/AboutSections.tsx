// Settings → 关于: the module's two cards below the shell's version card — 项目 (license + links,
// opened in the system browser) and 已知问题 (KNOWN_ISSUES, mirrored from docs/KNOWN-ISSUES.md).
import { ExternalLink } from "lucide-react";
import { api } from "../../bridge";
import { useI18n } from "../../i18n";
import { Section, SettingRow } from "../../components/settings/Form";
import { ABOUT_LINKS, KNOWN_ISSUES } from "./knownIssues";

const LINK = "inline-flex items-center gap-1 whitespace-nowrap rounded text-xs text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none";

export function AboutLinksSection() {
  const { t } = useI18n();
  return (
    <Section title={t("about.links.section")}>
      <SettingRow label={t("about.license")} hint={t("about.licenseHint")}>
        <span className="font-mono text-xs text-muted">Apache-2.0</span>
      </SettingRow>
      <SettingRow label={t("about.links")} hint={t("about.linksHint")}>
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 @max-[28rem]:justify-start">
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
  const { t } = useI18n();
  return (
    <Section title={t("about.knownIssues")} hint={t("about.knownIssuesHint")}>
      <ul>
        {KNOWN_ISSUES.map((issue) => (
          <li key={issue.id} data-issue={issue.id} className="border-b border-border/60 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm">{t(issue.titleKey)}</span>
              {issue.fixedIn && <span className="shrink-0 rounded-full bg-accent/15 px-2 text-[11px] leading-5 text-accent">{t("about.fixedIn", { version: issue.fixedIn })}</span>}
            </div>
            <p className="mt-1 text-xs text-subtle">{t(issue.bodyKey)}</p>
            {issue.workaroundKey && <p className="mt-1 text-xs text-muted">{t("about.workaround", { text: t(issue.workaroundKey) })}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
