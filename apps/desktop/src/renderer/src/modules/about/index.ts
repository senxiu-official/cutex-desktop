// About: the license, project links and the known issues list on the shell's Settings → 关于 page
// (`settings.section` items; the page itself — versions, third-party licenses — stays the shell's).
// Static data only, no daemon calls; required so the known issues are always reachable.
import { defineModule } from "../slots";
import { AboutLinksSection, KnownIssuesSection } from "./AboutSections";

export default defineModule({
  id: "about",
  titleKey: "about.title",
  descriptionKey: "about.description",
  required: true,
  contributes: {
    "settings.section": [
      { id: "about.links", page: "about", order: 100, titleKey: "about.links.section", keywords: ["about.license", "about.links", "about.link.changelog", "about.link.install"], Section: AboutLinksSection },
      { id: "about.knownIssues", page: "about", order: 200, titleKey: "about.knownIssues", keywords: ["about.link.knownIssues"], Section: KnownIssuesSection },
    ],
  },
});
