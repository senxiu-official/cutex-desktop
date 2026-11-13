import { isImeComposing } from "../lib/ime";
import { EDITOR_PLACEHOLDER_CLASS } from "../lib/composerPlaceholder";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ClipboardEvent, type HTMLAttributes, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { composerMentionTokens, type ComposerMentionToken } from "../lib/composerMentionTokens";
import { ProfileMentionChip } from "./ProfileMentionChip";
import { agentMentionEditorValue, atomicMentionSelection, readMentionSelection, writeMentionSelection,
  type MentionSelection } from "../lib/agentMentionEditor";
import { AgentMentionChip } from "./AgentMentionChip";

export interface AgentMentionInputHandle {
  readonly element: HTMLDivElement | null;
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  setSelectionRange(start: number, end?: number): void;
  focus(options?: FocusOptions): void;
}
export interface AgentMentionInputProps extends Omit<HTMLAttributes<HTMLDivElement>,
  "children" | "onChange" | "onSelect" | "onKeyDown" | "onPaste" | "onInput" | "contentEditable"> {
  value: string;
  onChange(value: string, caret: number): void;
  onSelect?(caret: number): void;
  onKeyDown?(event: KeyboardEvent<HTMLElement>): void;
  onPaste?(event: ClipboardEvent<HTMLElement>): void;
  placeholder?: string;
  /** The conversation's host: profile chips name their profile from this host's list. */
  hostId?: string | null;
}
interface Snapshot extends MentionSelection { value: string }

/** The placeholder shows only for an empty draft with no IME composition in progress: composing text is not committed
 *  yet (the draft is still ""), but the owner already sees it, so the placeholder goes at compositionstart. */
function showPlaceholder(root: HTMLElement, committed: string, composing = false) {
  root.dataset.empty = String(!composing && committed.length === 0);
}
interface ChipPortal { host: HTMLElement; token: ComposerMentionToken }

/** Used for drafts containing canonical agent links or explicit profile/model references. The parent keeps ordinary drafts in a textarea. */
export const AgentMentionInput = forwardRef<AgentMentionInputHandle, AgentMentionInputProps>(function AgentMentionInput(
  { value, onChange, onSelect, onKeyDown, onPaste, placeholder, hostId, className, style, ...attributes }, ref,
) {
  const element = useRef<HTMLDivElement>(null);
  const current = useRef(value);
  const caret = useRef<MentionSelection>({ start: value.length, end: value.length });
  const composing = useRef(false);
  const before = useRef<Snapshot | null>(null);
  const past = useRef<Snapshot[]>([]), future = useRef<Snapshot[]>([]);
  const callbacks = useRef({ onChange, onSelect, onKeyDown, onPaste });
  callbacks.current = { onChange, onSelect, onKeyDown, onPaste };
  const [portals, setPortals] = useState<ChipPortal[]>([]);

  // React owns only chip contents via portals. Browser edits never mutate a React-owned text subtree.
  const renderDocument = useCallback((text: string) => {
    const root = element.current;
    if (!root) return;
    const doc = root.ownerDocument, fragment = doc.createDocumentFragment();
    const chips: ChipPortal[] = [];
    let cursor = 0;
    for (const token of composerMentionTokens(text)) {
      fragment.append(doc.createTextNode(text.slice(cursor, token.start)));
      const host = doc.createElement("span");
      host.setAttribute("contenteditable", "false");
      host.setAttribute("data-agent-mention-raw", token.raw);
      if (token.kind === "agent") host.setAttribute("data-agent-mention-id", token.id);
      else host.setAttribute("data-profile-mention-raw", token.raw);
      host.style.display = "inline-flex";
      host.style.height = "1em";
      host.style.lineHeight = "1";
      host.style.alignItems = "baseline";
      host.style.maxWidth = "100%";
      host.style.verticalAlign = "baseline";
      fragment.append(host);
      chips.push({ host, token });
      cursor = token.end;
    }
    fragment.append(doc.createTextNode(text.slice(cursor)));
    if (text.endsWith("\n")) {
      const tail = doc.createElement("br");
      tail.setAttribute("data-mention-editor-tail", "");
      fragment.append(tail);
    }
    root.replaceChildren(fragment);
    showPlaceholder(root, text);
    setPortals(chips);
  }, []);

  const selection = useCallback(() => {
    const root = element.current;
    const next = root?.ownerDocument.activeElement === root ? readMentionSelection(root!) : null;
    if (next) caret.current = next;
    return caret.current;
  }, []);
  const remember = useCallback(() => {
    before.current = { value: current.current, ...selection() };
  }, [selection]);
  const commit = useCallback((text: string, next: MentionSelection, record = true) => {
    if (text !== current.current && record) {
      past.current.push(before.current ?? { value: current.current, ...caret.current });
      if (past.current.length > 100) past.current.shift();
      future.current = [];
    }
    before.current = null;
    current.current = text;
    caret.current = atomicMentionSelection(text, next.start, next.end);
    renderDocument(text);
    if (element.current) writeMentionSelection(element.current, caret.current.start, caret.current.end);
    callbacks.current.onChange(text, caret.current.start);
  }, [renderDocument]);
  const replaceSelection = useCallback((insert: string) => {
    remember();
    const range = selection(), text = current.current;
    const next = text.slice(0, range.start) + insert + text.slice(range.end);
    const at = range.start + insert.length;
    commit(next, { start: at, end: at });
  }, [commit, remember, selection]);
  const history = useCallback((redo: boolean) => {
    const from = redo ? future.current : past.current;
    const to = redo ? past.current : future.current;
    const previous = from.pop();
    if (!previous) return;
    to.push({ value: current.current, ...selection() });
    commit(previous.value, previous, false);
  }, [commit, selection]);

  useImperativeHandle(ref, () => ({
    get element() { return element.current; },
    get value() { return element.current ? agentMentionEditorValue(element.current) : current.current; },
    get selectionStart() { return selection().start; },
    get selectionEnd() { return selection().end; },
    setSelectionRange(start, end = start) {
      caret.current = atomicMentionSelection(current.current, start, end);
      const root = element.current;
      if (root && root.ownerDocument.activeElement === root) {
        writeMentionSelection(root, caret.current.start, caret.current.end);
      }
    },
    focus(options) {
      element.current?.focus(options);
      if (element.current) writeMentionSelection(element.current, caret.current.start, caret.current.end);
    },
  }), [selection]);

  useLayoutEffect(() => {
    if (composing.current) return;
    const root = element.current;
    if (!root) return;
    if (value !== current.current) {
      past.current.push({ value: current.current, ...caret.current });
      future.current = [];
      current.current = value;
    }
    if (agentMentionEditorValue(root) !== value || !root.childNodes.length) {
      renderDocument(value);
      caret.current = atomicMentionSelection(value, caret.current.start, caret.current.end);
      if (root.ownerDocument.activeElement === root) writeMentionSelection(root, caret.current.start, caret.current.end);
    }
  }, [value, renderDocument]);

  useEffect(() => {
    const root = element.current;
    if (!root) return;
    const beforeInput = (event: InputEvent) => {
      if (event.isComposing || composing.current) return;
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        event.preventDefault(); history(event.inputType === "historyRedo");
      } else if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
        event.preventDefault(); replaceSelection("\n");
      } else if (event.inputType === "deleteContentBackward" || event.inputType === "deleteContentForward") {
        const range = selection();
        const backward = event.inputType === "deleteContentBackward";
        const token = composerMentionTokens(current.current).find(item => backward ? item.end === range.start : item.start === range.end);
        if (range.start !== range.end || token) {
          event.preventDefault(); remember();
          const start = range.start === range.end && backward ? token!.start : range.start;
          const end = range.start === range.end && !backward ? token!.end : range.end;
          commit(current.current.slice(0, start) + current.current.slice(end), { start, end: start });
        } else remember();
      } else remember();
    };
    const changed = () => {
      const next = readMentionSelection(root);
      if (next && (next.start !== caret.current.start || next.end !== caret.current.end)) {
        caret.current = next;
        callbacks.current.onSelect?.(next.start);
      }
    };
    root.addEventListener("beforeinput", beforeInput);
    root.ownerDocument.addEventListener("selectionchange", changed);
    return () => {
      root.removeEventListener("beforeinput", beforeInput);
      root.ownerDocument.removeEventListener("selectionchange", changed);
    };
  }, [commit, history, remember, replaceSelection, selection]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (composing.current || isImeComposing(event)) return;
    callbacks.current.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const command = (event.ctrlKey || event.metaKey) && !event.altKey;
    if (command && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
      event.preventDefault(); history(event.key.toLowerCase() === "y" || event.shiftKey); return;
    }
    if (event.key === "Enter") { event.preventDefault(); replaceSelection("\n"); return; }
    const range = selection();
    const tokens = composerMentionTokens(current.current);
    // Chromium replaces a deleted final separator after a noneditable atom with a filler BR.
    // Commit this one-character deletion ourselves so it cannot become an unintended newline.
    if (event.key === "Backspace" && range.start === range.end && current.current[range.start - 1] === " " &&
      tokens.some(token => token.end === range.start - 1)) {
      event.preventDefault(); remember();
      const start = range.start - 1;
      commit(current.current.slice(0, start) + current.current.slice(range.end), { start, end: start });
      return;
    }
    const previous = tokens.find(token => token.end === range.start);
    const next = tokens.find(token => token.start === range.end);
    if ((event.key === "Backspace" || event.key === "Delete") &&
      (range.start !== range.end || (event.key === "Backspace" ? previous : next))) {
      event.preventDefault(); remember();
      const start = range.start === range.end && event.key === "Backspace" ? previous!.start : range.start;
      const end = range.start === range.end && event.key === "Delete" ? next!.end : range.end;
      commit(current.current.slice(0, start) + current.current.slice(end), { start, end: start });
    } else if (!event.shiftKey && !command && range.start === range.end &&
      ((event.key === "ArrowLeft" && previous) || (event.key === "ArrowRight" && next))) {
      event.preventDefault();
      const at = event.key === "ArrowLeft" ? previous!.start : next!.end;
      caret.current = writeMentionSelection(element.current!, at);
      callbacks.current.onSelect?.(at);
    } else remember();
  }
  function copy(event: ClipboardEvent<HTMLElement>, cut: boolean) {
    const range = selection();
    if (range.start === range.end) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", current.current.slice(range.start, range.end));
    if (cut) replaceSelection("");
  }
  return <div {...attributes} ref={element} role={attributes.role ?? "textbox"} aria-multiline="true"
    contentEditable suppressContentEditableWarning data-agent-mention-editor="" data-placeholder={placeholder}
    className={`outline-none ${EDITOR_PLACEHOLDER_CLASS} ${className ?? ""}`}
    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...style }}
    onKeyDown={handleKeyDown}
    onInput={() => {
      if (composing.current || !element.current) return;
      const text = agentMentionEditorValue(element.current);
      const next = readMentionSelection(element.current) ?? caret.current;
      if (text !== current.current) commit(text, next);
    }}
    onCompositionStart={event => {
      remember(); composing.current = true;
      if (element.current) showPlaceholder(element.current, current.current, true);
      attributes.onCompositionStart?.(event);
    }}
    onCompositionEnd={event => {
      composing.current = false;
      if (element.current) {
        const text = agentMentionEditorValue(element.current);
        const next = readMentionSelection(element.current) ?? caret.current;
        if (text !== current.current) commit(text, next);
        // A cancelled composition (Esc, or deleted back to nothing) commits nothing: the placeholder comes back.
        else showPlaceholder(element.current, current.current);
      }
      attributes.onCompositionEnd?.(event);
    }}
    onPaste={event => {
      callbacks.current.onPaste?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
      if (text) replaceSelection(text);
    }}
    onCopy={event => { attributes.onCopy?.(event); if (!event.defaultPrevented) copy(event, false); }}
    onCut={event => { attributes.onCut?.(event); if (!event.defaultPrevented) copy(event, true); }}
    onDrop={event => { attributes.onDrop?.(event); event.preventDefault(); }}>
    {portals.map(({ host, token }) => createPortal(token.kind === "agent" ? <AgentMentionChip id={token.id} name={token.name} interactive={false} /> : <ProfileMentionChip token={token} hostId={hostId} />, host, `${token.start}:${token.raw}`))}
  </div>;
});
