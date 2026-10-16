// Known issues shown on Settings → 关于 → 已知问题. Source of truth: docs/KNOWN-ISSUES.md — keep this
// list (and the strings in ./i18n.ts) in sync with it: same entries, same order, same fix versions.
import type { MessageKey } from "../../i18n";
import { INSTALL_GUIDE_URL } from "../../lib/firstRun";
import { PROJECT_REPO_URL } from "../../lib/update";

export interface KnownIssue {
  id: string;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  workaroundKey?: MessageKey;
  /** The version planned to fix it ("0.1.3" = this desktop app; "cutex 0.1.2" = the backend); unset = not scheduled. */
  fixedIn?: string;
}

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  { id: "phone", titleKey: "about.issue.phone.title", bodyKey: "about.issue.phone.body" },
  { id: "browserPrivate", titleKey: "about.issue.browserPrivate.title", bodyKey: "about.issue.browserPrivate.body", workaroundKey: "about.issue.browserPrivate.workaround", fixedIn: "0.1.3" },
  { id: "browserShared", titleKey: "about.issue.browserShared.title", bodyKey: "about.issue.browserShared.body", workaroundKey: "about.issue.browserShared.workaround", fixedIn: "0.1.3" },
  { id: "browserBlocked", titleKey: "about.issue.browserBlocked.title", bodyKey: "about.issue.browserBlocked.body", workaroundKey: "about.issue.browserBlocked.workaround", fixedIn: "0.1.3" },
  { id: "browserLoopback", titleKey: "about.issue.browserLoopback.title", bodyKey: "about.issue.browserLoopback.body", workaroundKey: "about.issue.browserLoopback.workaround", fixedIn: "0.1.3" },
  { id: "jobsLinux", titleKey: "about.issue.jobsLinux.title", bodyKey: "about.issue.jobsLinux.body" },
  { id: "macos", titleKey: "about.issue.macos.title", bodyKey: "about.issue.macos.body" },
];

const RELEASE_BLOB = `${PROJECT_REPO_URL}/blob/release`;
/** The project links of the 关于 page (opened in the system browser; docs on the `release` branch). */
export const ABOUT_LINKS: readonly { id: string; labelKey: MessageKey; url: string }[] = [
  { id: "github", labelKey: "about.link.github", url: PROJECT_REPO_URL },
  { id: "changelog", labelKey: "about.link.changelog", url: `${RELEASE_BLOB}/CHANGELOG.md` },
  { id: "install", labelKey: "about.link.install", url: INSTALL_GUIDE_URL },
  { id: "knownIssues", labelKey: "about.link.knownIssues", url: `${RELEASE_BLOB}/docs/KNOWN-ISSUES.md` },
];
