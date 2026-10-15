// Where Markdown code blocks may show `timeline.codeBlockAction` items (docs/desktop-modules.md §22):
// Timeline.tsx provides it around a live agent reply only (never the owner's messages, never read-only
// timelines). Any other Markdown has no scope and renders streamdown's code blocks unchanged.
import { createContext } from "react";
import type { AppSlotEntry, CodeBlockMatch } from "../modules/slots";

export type CodeBlockActionEntry = AppSlotEntry<"timeline.codeBlockAction">;

export interface CodeBlockScopeValue {
  sessionId: string;
  /** The conversation's host. */
  hostId: string;
}

export const CodeBlockScope = createContext<CodeBlockScopeValue | null>(null);

/** The fence tag of a `code` element's className (`language-Bash` → "Bash"); "" = none. */
export function fenceLanguage(className: string | undefined): string {
  return className?.match(/language-([^\s]+)/)?.[1] ?? "";
}

/** streamdown's code text without trailing newlines (what Copy / Download see too). */
export function trimCode(code: string): string {
  return code.replace(/\n+$/, "");
}

/** The entries whose `match` accepts this block, in `order` (pure; a throwing `match` is logged and skipped). */
export function matchCodeBlockActions(entries: readonly CodeBlockActionEntry[], block: CodeBlockMatch, log: (id: string, error: unknown) => void = () => {}): CodeBlockActionEntry[] {
  return entries
    .filter((e) => {
      try {
        return e.item.match(block) === true;
      } catch (error) {
        log(e.item.id, error);
        return false;
      }
    })
    .sort((a, b) => (a.item.order ?? 500) - (b.item.order ?? 500));
}

