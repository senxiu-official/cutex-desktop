// The `timeline.codeBlockAction` outlet (docs/desktop-modules.md §22): each matched item's Action after
// streamdown's Download / Copy in a code block's toolbar, in its own boundary (a crash stays in it).
import type { CodeBlockActionEntry } from "../lib/codeBlockScope";
import { ItemBoundary } from "./Outlet";
import type { CodeBlockActionProps } from "./slots";

export function CodeBlockActions({ entries, block }: { entries: readonly CodeBlockActionEntry[]; block: CodeBlockActionProps }) {
  return (
    <>
      {entries.map((e) => {
        const Action = e.item.Action;
        return (
          <ItemBoundary key={e.item.id} moduleId={e.moduleId} resetKey={`${block.hostId}\u0000${block.sessionId}`}>
            <Action {...block} />
          </ItemBoundary>
        );
      })}
    </>
  );
}
