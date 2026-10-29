/** Shared by native listeners and React handlers, including Safari's final keyCode 229 event. */
type ImeEvent = {
  isComposing?: boolean; keyCode?: number; which?: number; target?: EventTarget | null;
  nativeEvent?: { isComposing?: boolean; keyCode?: number; which?: number; target?: EventTarget | null };
};
const composing = new WeakSet<EventTarget>();
export function isImeComposing(event: ImeEvent): boolean {
  const native = event.nativeEvent ?? event;
  if (native.isComposing || native.keyCode === 229 || native.which === 229) return true;
  const target = event.target ?? native.target;
  if (target && composing.has(target)) return true;
  if ((target as Element | null)?.tagName === "FORM" &&
    Array.from((target as Element).querySelectorAll("input, textarea, [contenteditable]")).some((field) => composing.has(field))) return true;
  const doc = (target as Node | null)?.ownerDocument;
  return !!doc?.activeElement && composing.has(doc.activeElement);
}

/** Keep native length limits from cutting an IME's temporary phonetic spelling. */
export function installImeGuards(doc: Document): () => void {
  const limits = new Map<HTMLInputElement | HTMLTextAreaElement, string>();
  const blockedSubmits = new WeakSet<EventTarget>();
  const input = (event: Event) => {
    const target = event.target;
    return target instanceof doc.defaultView!.HTMLInputElement || target instanceof doc.defaultView!.HTMLTextAreaElement ? target : null;
  };
  const start = (event: Event) => {
    if (event.target) composing.add(event.target);
    const field = input(event);
    if (field?.hasAttribute("maxlength")) {
      limits.set(field, field.getAttribute("maxlength")!);
      field.removeAttribute("maxlength");
    }
  };
  const restore = (field: HTMLInputElement | HTMLTextAreaElement) => {
    if (composing.has(field)) return;
    const limit = limits.get(field);
    if (limit !== undefined) { field.setAttribute("maxlength", limit); limits.delete(field); }
  };
  const end = (event: Event) => {
    if (event.target) composing.delete(event.target);
    const field = input(event);
    // Some engines emit the committed input after compositionend. Restore only after that task.
    if (field) setTimeout(() => restore(field), 0);
  };
  const submit = (event: Event) => {
    if (isImeComposing(event) || (event.target && blockedSubmits.has(event.target))) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !isImeComposing(event)) return;
    const form = (event.target as Element | null)?.closest?.("form");
    if (form) { blockedSubmits.add(form); setTimeout(() => blockedSubmits.delete(form), 0); }
    // Do not preventDefault: the IME must still be able to accept its candidate.
  };
  doc.addEventListener("compositionstart", start, true);
  doc.addEventListener("compositionend", end, true);
  doc.addEventListener("submit", submit, true);
  doc.addEventListener("keydown", keydown, true);
  return () => {
    doc.removeEventListener("compositionstart", start, true);
    doc.removeEventListener("compositionend", end, true);
    doc.removeEventListener("submit", submit, true);
    doc.removeEventListener("keydown", keydown, true);
    for (const field of limits.keys()) { composing.delete(field); restore(field); }
  };
}
