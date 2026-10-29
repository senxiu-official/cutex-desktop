import { createContext, useContext, useLayoutEffect, useMemo, type RefObject } from "react";

interface MenuLayers { roots: Set<HTMLElement>; parent: MenuLayers | null }
export const MenuLayersContext = createContext<MenuLayers | null>(null);

/** A menu and its portalled descendants remain one interaction surface. */
export function useMenuLayers(): MenuLayers {
  const parent = useContext(MenuLayersContext);
  return useMemo(() => ({ roots: new Set<HTMLElement>(), parent }), [parent]);
}
export function useMenuLayer(ref: RefObject<HTMLElement | null>, group: MenuLayers | null, enabled = true): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const groups: MenuLayers[] = [];
    for (let current = group; current; current = current.parent) { current.roots.add(el); groups.push(current); }
    return () => { for (const current of groups) current.roots.delete(el); };
  }, [ref, group, enabled]);
}
export function menuLayerContains(group: MenuLayers, target: EventTarget | null): boolean {
  return !!target && "nodeType" in target && [...group.roots].some(el => el.contains(target as Node));
}
export function menuFlyoutRows(group: MenuLayers): HTMLElement[] {
  return [...group.roots].filter(el => el.hasAttribute("data-flyout")).flatMap(el => [...el.querySelectorAll<HTMLElement>("[role=menuitem]")]).filter(el => !(el as HTMLButtonElement).disabled);
}
export function findMenuLayerElement(group: MenuLayers, selector: string): HTMLElement | null {
  for (const root of group.roots) { const el = root.querySelector<HTMLElement>(selector); if (el) return el; }
  return null;
}
