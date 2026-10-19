// About: the known issues list, this desktop's changelog (更新记录, bundled from CHANGELOG.md) and the
// project card (repositories + star, install guide, license, third-party notices) on the shell's
// Settings → 关于 page (`settings.section` items; the version card on top stays the shell's). Static data
// only, no daemon calls; required so the known issues and the changelog are always reachable.
import { defineModule } from "../slots";
import { AboutLinksSection, ChangelogSection, KnownIssuesSection } from "./AboutSections";
import { provideReleases } from "../../lib/onboarding";
import { BUNDLED_CHANGELOG } from "./changelog";

// The onboarding's 新功能 dialog reads this desktop's releases from here (lib/onboarding).
provideReleases(BUNDLED_CHANGELOG.releases);

export default defineModule({
  id: "about",
  titleKey: "about.title",
  descriptionKey: "about.description",
  required: true,
  contributes: {
    "settings.section": [
      { id: "about.knownIssues", page: "about", order: 100, titleKey: "about.knownIssues", keywords: ["about.link.knownIssues"], Section: KnownIssuesSection },
      { id: "about.changelog", page: "about", order: 200, titleKey: "about.changelog", keywords: ["about.link.changelog", "about.changelog.keywords"], Section: ChangelogSection },
      { id: "about.links", page: "about", order: 300, titleKey: "about.links.section", keywords: ["about.license", "about.source", "about.star", "about.link.install", "about.thirdParty"], Section: AboutLinksSection },
    ],
  },
});
