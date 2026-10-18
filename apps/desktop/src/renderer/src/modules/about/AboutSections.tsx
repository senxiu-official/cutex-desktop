// Settings → 关于: the module's cards below the shell's version card — 已知问题 (docs/known-issues.json:
// the release branch's copy when main fetched one, else the built-in list; ./knownIssues.ts), 更新记录
// (this desktop's CHANGELOG.md, bundled at build time; ./changelog.ts) and 项目 (source repositories +
// star, install guide, license, third-party notices; opened in the system browser). The GitHub copies of
// the two documents are secondary 「在 GitHub 上查看」 links in their card headers. Texts are plain text:
// known issues only fill in display terms (`{{agent}}`); changelog entries show `code` / **bold** and a
// link's label, nothing is rendered as HTML or linked.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { applicableIssues, localizedText } from "../../../../shared/knownIssues";
import { changelogText, type ChangelogBlock, type ChangelogRelease } from "../../../../shared/changelog";
import { api } from "../../bridge";
import { useI18n } from "../../i18n";
import { Button, EmptyState, Section, SettingRow } from "../../components/settings/Form";
import { applyTerms, resolveTerms, useTermOverrides } from "../../lib/terms";
import { formatAbsolute, formatWhen } from "../../lib/time";
import { PROJECT_REPO_URL, RELATED_REPO_URLS, useUpdateStatus } from "../../lib/update";
import { INSTALL_GUIDE_URL } from "../../lib/firstRun";
import { useApp } from "../../store";
import { ABOUT_LINKS, KNOWN_ISSUES_URL, useKnownIssues } from "./knownIssues";
import { BUNDLED_CHANGELOG, initialOpen, inlineTokens, newSince, readSeenVersion, writeSeenVersion } from "./changelog";

const FOCUS = "focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none";
const LINK = `inline-flex items-center gap-1 whitespace-nowrap rounded text-xs text-accent hover:underline ${FOCUS}`;
const CHANGELOG_URL = ABOUT_LINKS.find((l) => l.id === "changelog")!.url;

/** An external link (system browser), the URL in its tooltip. */
function ExternalLinkButton({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <button type="button" className={LINK} title={url} onClick={() => void api.openExternal(url)}>
      {children}
      <ExternalLink size={11} aria-hidden />
    </button>
  );
}

/** 「在 GitHub 上查看」: the published copy of a document, secondary to the in-app list. */
function OnGithub({ url }: { url: string }) {
  const { t } = useI18n();
  return <ExternalLinkButton url={url}>{t("about.onGithub")}</ExternalLinkButton>;
}

// ---------- 项目 ----------

/** 项目: the one place for the repositories (+ star), the install guide, the license and third-party notices. */
export function AboutLinksSection() {
  const { t } = useI18n();
  return (
    <Section title={t("about.links.section")}>
      <SettingRow label={t("about.source")} hint={t("about.sourceHint")}>
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 group-data-[narrow]/card:justify-start">
          {RELATED_REPO_URLS.map((r) => (
            <ExternalLinkButton key={r.name} url={r.url}>
              {r.name}
            </ExternalLinkButton>
          ))}
          <Button onClick={() => void api.openExternal(PROJECT_REPO_URL)} title={PROJECT_REPO_URL}>
            {t("about.star")}
          </Button>
        </span>
      </SettingRow>
      <SettingRow label={t("about.link.install")} hint={t("about.installHint")}>
        <ExternalLinkButton url={INSTALL_GUIDE_URL}>{t("about.open")}</ExternalLinkButton>
      </SettingRow>
      <SettingRow label={t("about.license")} hint={t("about.licenseHint")}>
        <span className="font-mono text-xs text-muted">Apache-2.0</span>
      </SettingRow>
      <SettingRow label={t("about.thirdParty")} hint={t("about.thirdPartyHint")}>
        <span className="font-mono text-xs text-subtle">NOTICE</span>
      </SettingRow>
    </Section>
  );
}

// ---------- 已知问题 ----------

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
    <Section title={t("about.knownIssues")} hint={t("about.knownIssuesHint")} actions={<OnGithub url={KNOWN_ISSUES_URL} />}>
      <p data-known-issues-source={view.source} className="pt-2 pb-1 text-[11px] text-subtle" title={fetchedAt !== null ? formatAbsolute(fetchedAt) : undefined}>
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

// ---------- 更新记录 ----------

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((tok, i) =>
        tok.kind === "code" ? (
          <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[11px] break-all">
            {tok.text}
          </code>
        ) : tok.kind === "bold" ? (
          <strong key={i} className="font-semibold text-foreground">
            {tok.text}
          </strong>
        ) : (
          <span key={i}>{tok.text}</span>
        ),
      )}
    </>
  );
}

/** A release's blocks: the intro paragraphs, `**Group**` headings and bulleted entries in written order. */
function ReleaseBody({ blocks }: { blocks: readonly ChangelogBlock[] }) {
  const { locale } = useI18n();
  // Consecutive items form one list.
  const groups: { kind: ChangelogBlock["kind"]; blocks: ChangelogBlock[] }[] = [];
  for (const b of blocks) {
    const last = groups.at(-1);
    if (b.kind === "item" && last?.kind === "item") last.blocks.push(b);
    else groups.push({ kind: b.kind, blocks: [b] });
  }
  return (
    <div className="space-y-2 pb-3 pl-5 text-xs leading-5 text-muted">
      {groups.map((g, i) =>
        g.kind === "heading" ? (
          <p key={i} className="pt-1 text-xs font-semibold text-foreground">
            <Inline text={changelogText(g.blocks[0]!, locale)} />
          </p>
        ) : g.kind === "text" ? (
          <p key={i} className="text-foreground/90">
            <Inline text={changelogText(g.blocks[0]!, locale)} />
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-4 marker:text-subtle">
            {g.blocks.map((b, j) => (
              <li key={j} className="break-words">
                <Inline text={changelogText(b, locale)} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function ReleaseRow({ release, open, onToggle, installed, fresh }: { release: ChangelogRelease; open: boolean; onToggle(): void; installed: boolean; fresh: boolean }) {
  const { t, locale } = useI18n();
  const id = `changelog-${release.version}`;
  const date = release.date ? new Date(`${release.date}T12:00:00`) : null;
  return (
    <li data-release={release.version} className="border-b border-border/60 last:border-b-0">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded py-3 text-left ${FOCUS}`}>
        {open ? <ChevronDown size={13} className="shrink-0 text-muted" aria-hidden /> : <ChevronRight size={13} className="shrink-0 text-muted" aria-hidden />}
        <span className="text-sm font-medium tabular-nums">{release.version}</span>
        {release.title && <span className="text-sm text-subtle">“{release.title}”</span>}
        {installed && <span className="shrink-0 rounded-full bg-accent/15 px-2 text-[11px] leading-5 text-accent">{t("about.changelog.installed")}</span>}
        {fresh && <span className="shrink-0 rounded-full bg-ok/15 px-2 text-[11px] leading-5 text-ok-text">{t("about.changelog.new")}</span>}
        {date && !Number.isNaN(date.getTime()) && (
          <span className="ml-auto shrink-0 text-xs text-subtle tabular-nums" title={release.date}>
            {date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })}
          </span>
        )}
      </button>
      {open && (
        <div id={id}>
          <ReleaseBody blocks={release.blocks} />
        </div>
      )}
    </li>
  );
}

/**
 * 更新记录: this desktop's released versions, newest first; the installed version (binary installs know
 * it) opens first and is marked, versions newer than the one last seen here are marked 新.
 */
export function ChangelogSection() {
  const { t } = useI18n();
  const releases = BUNDLED_CHANGELOG.releases;
  const installed = useUpdateStatus()?.current?.version ?? null;
  // Read once per visit: what is new is decided against the version seen before this visit.
  const [fresh] = useState(() => newSince(releases, readSeenVersion()));
  // null = untouched: the installed version's entry (else the newest) is open. The update status arrives
  // after the first render, so this follows it until the owner opens or closes an entry.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const first = initialOpen(releases, installed);
  const open = picked ?? new Set(first ? [first] : []);
  useEffect(() => {
    if (releases[0]) writeSeenVersion(releases[0].version);
  }, [releases]);
  const toggle = (version: string) => {
    const next = new Set(open);
    if (next.has(version)) next.delete(version);
    else next.add(version);
    setPicked(next);
  };
  return (
    <Section title={t("about.changelog")} hint={t("about.changelogHint")} actions={<OnGithub url={CHANGELOG_URL} />}>
      {releases.length === 0 ? (
        <EmptyState>{t("about.changelog.empty")}</EmptyState>
      ) : (
        <ul data-changelog="">
          {releases.map((r) => (
            <ReleaseRow key={r.version} release={r} open={open.has(r.version)} onToggle={() => toggle(r.version)} installed={r.version === installed} fresh={fresh.has(r.version)} />
          ))}
        </ul>
      )}
    </Section>
  );
}
