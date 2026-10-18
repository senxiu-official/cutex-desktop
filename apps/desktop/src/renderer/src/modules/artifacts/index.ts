// 成果 (artifacts, design docs/research/research-paradigm-design-20261010.md §3.6; wire contract
// docs/research/artifacts-api-v1.md; desktop contract docs/desktop-modules.md v1.7): the project's
// versioned results. 成果库 card (artifacts.library), one artifact per tab (artifacts.view: pinned
// and latest are different tabs), the `artifact_publish` timeline card, the `artifact` ref kind behind
// `cutex:artifact/<ref>` links (chips, thumbnails), copy link / open on the right. Needs cutex's
// `artifacts` capability; the core never imports this module. 项目 page: a 成果库 tab (`project.tab`,
// §21) with the project's scope and a count for the overview. HTML artifacts render as pages in the
// offline opaque frame (§10.2); an agent's live publish opens beside its conversation (live.ts).
import { Copy, FolderOpen, Library, PanelRight } from "lucide-react";
import { ARTIFACTS_FEATURE, parseArtifactRef } from "../../../../shared/artifactStore";
import { defineModule } from "../slots";
import { copyArtifactLink, explainOpen } from "./actions";
import { LibraryBody, ProjectLibraryTab } from "./Library";
import { useProjectArtifactsSummary } from "./summary";
import { ARTIFACT_REF_KIND, DEFAULT_LIBRARY, initView, isPublishTool, LIBRARY, parseViewParams, publishCallOf, restoreLibrary, restoreView, VIEW, viewKey, type LibraryState, type ViewParams, type ViewState } from "./model";
import { artifactThumbnail, openArtifactRef, useArtifactLink } from "./refTarget";
import { startArtifactSync } from "./store";
import { startAutoOpen } from "./live";
import { ArtifactSettings } from "./Settings";
import { ArtifactToasts } from "./Toasts";
import { useLibraryTab, useViewTab } from "./tabs";
import { PublishToolRow } from "./ToolRow";
import { ViewActions, ViewBody } from "./View";
import { isRunning } from "../../lib/workGroups";
import { services } from "../app";


export default defineModule({
  id: "artifacts",
  titleKey: "artifacts.title",
  descriptionKey: "artifacts.description",
  requires: { capabilities: [ARTIFACTS_FEATURE] },
  contributes: {
    "side.component": [
      {
        id: LIBRARY,
        titleKey: "artifacts.library",
        icon: Library,
        instances: "singleton",
        defaultBinding: "workspace",
        placement: { home: "artifacts", order: 100 },
        parseParams: () => ({}),
        init: (_params: Record<string, never>, previous: LibraryState | null): LibraryState => previous ?? DEFAULT_LIBRARY,
        restore: (raw): LibraryState => restoreLibrary(raw),
        useTab: useLibraryTab,
        Body: LibraryBody,
        launcher: { order: 850, params: () => ({}) },
      },
      {
        id: VIEW,
        titleKey: "artifacts.view",
        icon: FolderOpen,
        instances: "multi",
        defaultBinding: "host",
        transient: true,
        peekable: true,
        placement: { home: "artifacts", prefer: [{ containing: LIBRARY }, { group: "artifacts" }], order: 200 },
        parseParams: parseViewParams,
        dedupeKey: viewKey,
        init: (params: ViewParams, previous: ViewState | null) => initView(params, previous),
        restore: restoreView,
        toRef: (state: ViewState) => {
          const parts = parseArtifactRef(state.ref);
          const name = state.name ?? state.ref;
          const title = parts && parts.version !== "latest" ? `${name} v${parts.version}` : name;
          return { key: viewKey(state), title: title.slice(0, 200), params: { ref: state.ref, ...(state.name ? { name: state.name } : {}) } };
        },
        fromRef: (params) => parseViewParams({ ref: params.ref ?? "", ...(params.name ? { name: params.name } : {}) }),
        useTab: useViewTab,
        Body: ViewBody,
        Actions: ViewActions,
      },
    ],
    // An agent's live publish: opened beside its conversation / a card with 查看 (live.ts, autoOpen.ts).
    "conversation.overlay": [{ id: "artifacts.toasts", order: 300, Overlay: ArtifactToasts }],
    "settings.section": [
      { id: "artifacts.settings", page: "sides", order: 450, titleKey: "artifacts.settings", keywords: ["artifacts.autoOpen", "artifacts.autoOpenHint", "artifacts.autoOpen.open", "artifacts.autoOpen.notify", "artifacts.autoOpen.off"], Section: ArtifactSettings },
    ],
    "project.tab": [{ id: "artifacts.projectTab", tab: "artifacts", order: 310, titleKey: "artifacts.library", Body: ProjectLibraryTab, useSummary: useProjectArtifactsSummary }],
    "timeline.tool": [
      {
        id: "artifacts.tool",
        order: 150,
        match: isPublishTool,
        Row: PublishToolRow,
        // A finished publish is a card of its own (like a delegation), not folded into the work group.
        standalone: (item) => !isRunning(item) && publishCallOf(item)?.status === "done",
        activity: () => "artifacts.tool.activity",
      },
    ],
    "ref.target": [{ id: "artifacts.ref", kind: ARTIFACT_REF_KIND, role: "content", open: openArtifactRef, useLink: useArtifactLink, thumbnail: artifactThumbnail }],
    "ref.action": [
      {
        id: "artifacts.copyLink",
        order: 100,
        kinds: [ARTIFACT_REF_KIND, VIEW],
        icon: Copy,
        titleKey: "artifacts.copyLink",
        run: (ref) => {
          const key = ref.kind === VIEW ? (ref.params.ref ?? ref.key) : ref.key;
          if (!parseArtifactRef(key)) return;
          copyArtifactLink(key, (ref.params.name ?? ref.title).replace(/\s+v\d+$/, ""));
        },
      },
      {
        // The reference card / a bookmark of a view → a tab on the right (link chips have it built in).
        id: "artifacts.openRight",
        order: 110,
        kinds: [VIEW],
        icon: PanelRight,
        titleKey: "artifacts.openRight",
        run: async (ref) => explainOpen(await services.refs.open(ref, { how: "page" })),
      },
    ],
  },
  activate: (ctx) => {
    startArtifactSync(ctx);
    startAutoOpen(ctx);
  },
});
