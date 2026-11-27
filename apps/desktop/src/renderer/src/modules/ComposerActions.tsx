// The `composer.action` outlet (docs/desktop-modules.md §31): one Action per shown item in the input box, each in its
// own boundary (a crash stays in it), rendering into the footer's tool row (`button`) and the panel place (`panel`)
// through portals. Host state and key passes: lib/composerActions.ts.
import type { ComposerActionsHost } from "../lib/composerActions";
import { ItemBoundary } from "./Outlet";

export function ComposerActions({ host, sessionId, hostId, button, panel }: { host: ComposerActionsHost; sessionId: string; hostId: string; button: HTMLElement | null; panel: HTMLElement | null }) {
  return (
    <>
      {host.entries.map((e) => {
        const Action = e.item.Action;
        return (
          <ItemBoundary key={e.item.id} moduleId={e.moduleId} resetKey={`${hostId}\u0000${sessionId}`}>
            <Action hostId={hostId} sessionId={sessionId} composer={host.accessFor(e.item.id)} button={button} panel={panel} />
          </ItemBoundary>
        );
      })}
    </>
  );
}
