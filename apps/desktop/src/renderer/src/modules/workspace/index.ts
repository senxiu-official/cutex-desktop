// 工作区 (docs/desktop-modules.md §18.8, §18.6): the selected agent's files, git changes and file previews as
// right-side cards — the old side pane's 文件 / 变更 / 预览 tabs, each its own card. The diff of a
// changed file opens in the diff card (module `diff`).
import { FileText, FolderTree, GitCompare, LocateFixed } from "lucide-react";
import { revealHostInTree, revealInTree } from "../../lib/sideOpen";
import { defineModule } from "../slots";
import { ChangesBody } from "./Changes";
import { FilesBody, type FilesState } from "./Files";
import { restoreFiles } from "./explorer/state";
import { PreviewBody } from "./Preview";
import { baseOf, initPreview, parsePreviewParams, previewKey, restorePreview, type PreviewParams, type PreviewState } from "./previewState";
import { CHANGES, FILES, PREVIEW } from "./shared";
import { useChangesTab, useFilesTab, usePreviewTab } from "./tabs";
import { lazyPage } from "../../lib/lazyPage";

const ViewerSettings = lazyPage(() => import("./ViewerSettings").then((m) => m.ViewerSettings));

const WORKSPACE_FS = "workspace-fs";

export default defineModule({
  id: "workspace",
  titleKey: "workspace.title",
  descriptionKey: "workspace.description",
  contributes: {
    "settings.section": [{ id: "workspace.viewerSettings", page: "sides", order: 440, titleKey: "workspace.preview", keywords: ["workspace.autoRefresh", "workspace.autoRefreshHint"], Section: ViewerSettings }],
    // 在文件树中显示 (docs/design/019 §3) on a file's tab menu / reference card: the 预览 and git diff tabs.
    "ref.action": [
      {
        id: "workspace.revealInTree",
        titleKey: "workspace.revealInTree",
        icon: LocateFixed,
        kinds: [PREVIEW, "diff.view"],
        run: (ref) => {
          const path = ref.params.path;
          if (!path) return;
          if (ref.params.host === "1") revealHostInTree(path);
          else revealInTree(path);
        },
      },
    ],
    "side.component": [
      {
        id: FILES,
        requires: { capabilities: [WORKSPACE_FS] },
        titleKey: "workspace.files",
        icon: FolderTree,
        instances: "singleton",
        defaultBinding: "follow",
        placement: { home: "workspace", order: 100 },
        // `reveal` (lib/sideOpen openFolder): expand the tree down to that folder; each open re-applies it.
        parseParams: (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.reveal === "string" ? { reveal: raw.reveal } : {}),
        // A reveal keeps the shown root (the explorer moves to the default root itself when the path is outside it).
        init: (params: { reveal?: string }, previous: FilesState | null): FilesState =>
          params.reveal !== undefined
            ? { q: "", reveal: params.reveal, revealSeq: (previous?.revealSeq ?? 0) + 1, ...(previous?.root ? { root: previous.root } : {}) }
            : (previous ?? { q: "" }),
        // v1 stored only the search text `q` (restored as a 全部搜索); the explorer adds the shown root. The rest
        // (current folder, open folders, options) lives in the explorer's own store (explorer/store.ts).
        restore: restoreFiles,
        useTab: useFilesTab,
        Body: FilesBody,
        launcher: { category: "content", order: 100, params: () => ({}) },
      },
      {
        id: CHANGES,
        requires: { capabilities: [WORKSPACE_FS] },
        titleKey: "workspace.changes",
        icon: GitCompare,
        instances: "singleton",
        defaultBinding: "follow",
        placement: { home: "workspace", order: 200 },
        parseParams: () => ({}),
        // State is always null, so no restore (a restore returning null drops the tab).
        init: () => null,
        useTab: useChangesTab,
        Body: ChangesBody,
        launcher: { category: "content", order: 200, params: () => ({}) },
      },
      {
        // Host-path previews need no workspace-fs (they need fs-file-read; the card says so when missing).
        id: PREVIEW,
        titleKey: "workspace.preview",
        icon: FileText,
        instances: "multi",
        defaultBinding: "agent",
        transient: true,
        peekable: true,
        placement: { home: "workspace", order: 300 },
        parseParams: parsePreviewParams,
        dedupeKey: previewKey,
        init: initPreview,
        restore: restorePreview,
        toRef: (state: PreviewState) => ({
          key: previewKey(state),
          title: baseOf(state.path),
          params: { path: state.path, ...(state.host ? { host: "1" } : {}), ...(state.line ? { line: String(state.line) } : {}), ...(state.scope ? { scopeKind: state.scope.kind, scopeId: state.scope.id } : {}) },
        }),
        fromRef: (params): PreviewParams | null => parsePreviewParams({ path: params.path ?? "", line: Number(params.line) || null, host: params.host === "1", ...(params.scopeKind ? { scope: { kind: params.scopeKind, id: params.scopeId ?? "" } } : {}) }),
        useTab: usePreviewTab,
        Body: PreviewBody,
      },
    ],
  },
});
