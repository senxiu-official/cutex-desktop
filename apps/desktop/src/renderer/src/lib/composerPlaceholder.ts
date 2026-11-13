import { busyPlaceholderKey } from "./noSteerHint";

/** The composer's placeholder state: what the input says while it is empty. */
export interface ComposerPlaceholderState {
  /** A delegation turn or an awaited delegation draws its own line over the input: no placeholder then. */
  delegation: boolean;
  awaiting: boolean;
  /** A turn is running (or held through a turn boundary): typing queues. */
  busy: boolean;
  noSteer: boolean;
  name: string;
}

type Translate = (key: "composer.placeholder" | "composer.placeholderBusy" | "composer.placeholderBusyNoSteer", vars?: { name: string }) => string;

/** One text for both inputs (the plain textarea and the mention editor). */
export function composerPlaceholder(t: Translate, s: ComposerPlaceholderState): string {
  if (s.delegation || s.awaiting) return "";
  return s.busy ? t(busyPlaceholderKey(s.noSteer)) : t("composer.placeholder", { name: s.name });
}

/** Placeholder colour, the same in every composer state and in both inputs. Only `@theme` colours make utilities
 *  (`text-muted-foreground` makes none, so the mention editor's placeholder once took the text colour: white in dark). */
export const TEXTAREA_PLACEHOLDER_CLASS = "placeholder:text-subtle";
/** The mention editor (contenteditable) draws its placeholder as `::before` while `data-empty="true"`. Out of flow, so
 *  the caret stays at the start of the empty line as in a textarea; AgentMentionInput clears `data-empty` from
 *  compositionstart, so IME text never sits behind the placeholder. */
export const EDITOR_PLACEHOLDER_CLASS = "relative data-[empty=true]:before:absolute data-[empty=true]:before:content-[attr(data-placeholder)] " +
  "data-[empty=true]:before:text-subtle data-[empty=true]:before:pointer-events-none data-[empty=true]:before:select-none";
