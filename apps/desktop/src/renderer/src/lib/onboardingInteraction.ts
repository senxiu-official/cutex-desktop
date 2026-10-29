import { useEffect, type RefObject } from "react";
import { isElement, isHTMLElement, isNode } from "./ownerWindow";
import { useOwnerDocument } from "./ownerContext";

/** Onboarding shares the app's modal convention: contain Tab, restore the opener, and keep radio arrows local. */
export function useOnboardingInteraction(box: RefObject<HTMLElement | null>, onClose: () => void, page?: string): void {
  const doc = useOwnerDocument();
  useEffect(() => {
    const before = doc.activeElement;
    const panel = box.current;
    if (!panel) return;
    panel.focus();
    const focus = (event: FocusEvent) => {
      if (isNode(event.target) && !panel.contains(event.target)) panel.focus();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      const target = isHTMLElement(event.target) ? event.target : null;
      if (target?.getAttribute("role") === "radio" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        const group = target.closest('[role="radiogroup"]');
        const radios = [...(group?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [])];
        const index = radios.indexOf(target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1 : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + radios.length) % radios.length;
        event.preventDefault();
        event.stopPropagation();
        radios[next]?.focus();
        radios[next]?.click();
      }
      if (event.key !== "Tab") return;
      const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter((el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert], [aria-hidden="true"]'));
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (doc.activeElement === first || doc.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === panel)) { event.preventDefault(); first.focus(); }
    };
    const select = (event: MouseEvent) => {
      const radio = isElement(event.target) ? event.target.closest<HTMLElement>('[role="radio"]') : null;
      radio?.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]').forEach((item) => { item.tabIndex = item === radio ? 0 : -1; });
    };
    panel.addEventListener("click", select);
    panel.addEventListener("keydown", key);
    doc.addEventListener("focusin", focus);
    return () => {
      panel.removeEventListener("click", select);
      panel.removeEventListener("keydown", key);
      doc.removeEventListener("focusin", focus);
      if (isHTMLElement(before) && before.isConnected) before.focus();
    };
  }, [box, onClose, doc]);
  useEffect(() => {
    // Selection groups have one Tab stop; arrow keys move and select within the group.
    box.current?.querySelectorAll('[role="radiogroup"]').forEach((group) => {
      const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
      const chosen = radios.find((r) => r.getAttribute("aria-checked") === "true") ?? radios[0];
      radios.forEach((r) => { r.tabIndex = r === chosen ? 0 : -1; });
    });
  });
  useEffect(() => { box.current?.focus(); }, [box, page]);
}
