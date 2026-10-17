// The public project repository (github.com/senxiu-official/cutex-desktop) and the files the app reads
// from its `release` branch. Shared by main (known-issues fetch) and renderer (project links).
export const PROJECT_REPO = { owner: "senxiu-official", repo: "cutex-desktop" } as const;
export const PROJECT_REPO_URL = `https://github.com/${PROJECT_REPO.owner}/${PROJECT_REPO.repo}`;
/** The branch public releases (and their docs) are published on. */
export const RELEASE_BRANCH = "release";
/** Raw file URL of `path` on the release branch (raw.githubusercontent.com, no redirect). */
export function releaseRawUrl(path: string): string {
  return `https://raw.githubusercontent.com/${PROJECT_REPO.owner}/${PROJECT_REPO.repo}/${RELEASE_BRANCH}/${path}`;
}
