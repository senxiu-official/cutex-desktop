// Known issues shown on Settings → 关于 → 已知问题. Source of truth: docs/known-issues.json (schema in
// shared/knownIssues.ts; docs/KNOWN-ISSUES.md is its readable twin, test/aboutModule.test.tsx keeps them
// in step). The built-in list is that file, bundled at build time; main also fetches the release
// branch's copy (main/knownIssues.ts), which wins when it is valid.
import { useEffect, useState } from "react";
// A copy of docs/known-issues.json (app code stays inside apps/desktop; test/aboutModule.test.tsx keeps them identical).
import bundledJson from "./known-issues.bundled.json";
import { parseKnownIssues, type KnownIssueEntry, type KnownIssuesDoc, type KnownIssuesResult } from "../../../../shared/knownIssues";
import { bridge } from "../../bridge";
import type { MessageKey } from "../../i18n";
import { INSTALL_GUIDE_URL } from "../../lib/firstRun";
import { PROJECT_REPO_URL } from "../../lib/update";

/** The list compiled into this build (an invalid file would fail test/aboutModule.test.tsx). */
export const BUNDLED_KNOWN_ISSUES: KnownIssuesDoc = parseKnownIssues(bundledJson) ?? { schema: 1, issues: [] };

export interface KnownIssuesView {
  issues: readonly KnownIssueEntry[];
  /** github: the release branch's list (fetchedAt; stale = the latest refresh failed); builtin: this build's. */
  source: "github" | "builtin";
  fetchedAt?: string;
  stale?: boolean;
}

/** The list to show for main's answer (null = none yet / no bridge): the fetched copy, else the built-in one. */
export function knownIssuesView(result: KnownIssuesResult | null): KnownIssuesView {
  if (result?.source === "github") {
    // Main validated it already; checked again here (the renderer trusts only its own parser).
    const doc = parseKnownIssues(result.doc);
    if (doc) return { issues: doc.issues, source: "github", fetchedAt: result.fetchedAt, ...(result.stale ? { stale: true } : {}) };
  }
  return { issues: BUNDLED_KNOWN_ISSUES.issues, source: "builtin" };
}

/** The known issues to show: built-in at once, the release branch's list once main has it. */
export function useKnownIssues(): KnownIssuesView {
  const [result, setResult] = useState<KnownIssuesResult | null>(null);
  useEffect(() => {
    const source = bridge.knownIssues;
    if (!source) return;
    let live = true;
    source.get().then(
      (r) => live && setResult(r),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  return knownIssuesView(result);
}

const RELEASE_BLOB = `${PROJECT_REPO_URL}/blob/release`;
/** The known issues document on GitHub (release branch): the section's secondary 「在 GitHub 上查看」 link. */
export const KNOWN_ISSUES_URL = `${RELEASE_BLOB}/docs/KNOWN-ISSUES.md`;
/**
 * Every external link of the 关于 page (opened in the system browser; docs on the `release` branch):
 * github / install in 项目, changelog / knownIssues as the 「在 GitHub 上查看」 links of 更新记录 / 已知问题.
 */
export const ABOUT_LINKS: readonly { id: string; labelKey: MessageKey; url: string }[] = [
  { id: "github", labelKey: "about.link.github", url: PROJECT_REPO_URL },
  { id: "changelog", labelKey: "about.link.changelog", url: `${RELEASE_BLOB}/CHANGELOG.md` },
  { id: "install", labelKey: "about.link.install", url: INSTALL_GUIDE_URL },
  { id: "knownIssues", labelKey: "about.link.knownIssues", url: KNOWN_ISSUES_URL },
];
