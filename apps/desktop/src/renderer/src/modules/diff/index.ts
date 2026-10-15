// 差异 (docs/desktop-modules.md §18.8): one viewer for a workspace file's git diff and one turn's
// changes to a file — tabs of the same diff card (key git:<path> / turn:<turnId>:<path>). Not gated:
// the git source says in the card when the host has no workspace routes.
import { FileDiff } from "lucide-react";
import { defineModule } from "../slots";
import { DiffBody } from "./DiffView";
import { diffKey, diffName, initDiff, parseDiffParams, restoreDiff, type DiffState } from "./diffState";
import { useDiffTab } from "./tabs";

export default defineModule({
  id: "diff",
  titleKey: "diff.title",
  descriptionKey: "diff.description",
  contributes: {
    "side.component": [
      {
        id: "diff.view",
        titleKey: "diff.view",
        icon: FileDiff,
        instances: "multi",
        defaultBinding: "agent",
        placement: { home: "workspace", prefer: [{ containing: "workspace.changes" }, { group: "workspace" }], order: 400 },
        parseParams: parseDiffParams,
        dedupeKey: diffKey,
        init: initDiff,
        restore: restoreDiff,
        toRef: (state: DiffState) => (state.source === "git" ? { key: diffKey(state), title: diffName(state.path), params: { source: "git", path: state.path } } : null),
        fromRef: (params) => parseDiffParams({ source: "git", path: params.path ?? "" }),
        useTab: useDiffTab,
        Body: DiffBody,
      },
    ],
  },
});
