// 工作区 (docs/desktop-modules.md §18.8, §18.6): the selected agent's files, git changes and file previews as
// right-side cards — the old side pane's 文件 / 变更 / 预览 tabs, each its own card. The diff of a
// changed file opens in the diff card (module `diff`).
import { FileText, FolderTree, GitCompare } from "lucide-react";
import { defineModule } from "../slots";
import { ChangesBody } from "./Changes";
import { FilesBody, type FilesState } from "./Files";
import { PreviewBody } from "./Preview";
import { baseOf, initPreview, parsePreviewParams, previewKey, restorePreview, type PreviewParams, type PreviewState } from "./previewState";
import { CHANGES, FILES, PREVIEW } from "./shared";
import { useChangesTab, useFilesTab, usePreviewTab } from "./tabs";

const WORKSPACE_FS = "workspace-fs";

export default defineModule({
  id: "workspace",
  titleKey: "workspace.title",
  descriptionKey: "workspace.description",
  contributes: {
    "side.component": [
      {
        id: FILES,
        requires: { capabilities: [WORKSPACE_FS] },
        titleKey: "workspace.files",
        icon: FolderTree,
        instances: "singleton",
        defaultBinding: "follow",
        placement: { home: "workspace", order: 100 },
        parseParams: () => ({}),
        init: (_params: Record<string, never>, previous: FilesState | null): FilesState => previous ?? { q: "" },
        restore: (raw): FilesState => ({ q: raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.q === "string" ? raw.q.slice(0, 200) : "" }),
        useTab: useFilesTab,
        Body: FilesBody,
        launcher: { order: 100, params: () => ({}) },
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
        launcher: { order: 200, params: () => ({}) },
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
          params: { path: state.path, ...(state.host ? { host: "1" } : {}), ...(state.line ? { line: String(state.line) } : {}) },
        }),
        fromRef: (params): PreviewParams | null => parsePreviewParams({ path: params.path ?? "", line: Number(params.line) || null, host: params.host === "1" }),
        useTab: usePreviewTab,
        Body: PreviewBody,
      },
    ],
  },
});
