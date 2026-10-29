// How a page pane draws its page (docs/desktop-modules.md §24.4): modules/Outlet registers `PageContent` (the
// page in its module's error boundary and component gate) when it loads, so lib/paneKinds does not import the
// outlet (and its UI) itself. Until then (tests) the page component is drawn as it is.
import { createElement, type ComponentType, type ReactNode } from "react";
import type { PageItem } from "../modules/slots";
import type { ModuleId, PageParams } from "../modules/types";

export type PageContentProps = { item: PageItem; moduleId: ModuleId | null; params: PageParams };

let content: ComponentType<PageContentProps> | null = null;

export function setPageContent(c: ComponentType<PageContentProps>): void {
  content = c;
}

export function pageContent(props: PageContentProps): ReactNode {
  return content ? createElement(content, props) : createElement(props.item.Page, { params: props.params });
}
