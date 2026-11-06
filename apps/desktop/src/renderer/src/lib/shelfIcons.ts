// The page icons a Shelf Rail draws (lib/sideLayout PAGE_ICONS → lucide), and a page's icon: its own, else its first
// pane's kind icon, else the empty page's. Shell code: names no feature.
import { SquareDashed, Bell, BookOpen, Bot, ChartColumn, Code, File, Flag, Folder, Globe, Headphones, House, Image, Inbox, Layers, LayoutGrid, ListTodo, Square, SquareCheck, SquareChevronRight, Star, Sun, Users } from "lucide-react";
import type { Icon } from "../modules/slots";
import type { PageIcon, SidePage } from "./sideLayout";

export const PAGE_ICON_COMPONENTS: Record<PageIcon, Icon> = {
  layers: Layers,
  headphones: Headphones,
  file: File,
  globe: Globe,
  prompt: SquareChevronRight,
  "list-todo": ListTodo,
  bot: Bot,
  users: Users,
  check: SquareCheck,
  image: Image,
  chart: ChartColumn,
  star: Star,
  folder: Folder,
  code: Code,
  flag: Flag,
  book: BookOpen,
  home: House,
  bell: Bell,
  grid: LayoutGrid,
  sun: Sun,
  inbox: Inbox,
  square: Square,
};

/**
 * An empty page (no pane yet): a dashed square — never the Shelf's own icons (its avatar / the header's Shelf toggle:
 * panel icons) nor a feature's (服务: the server).
 */
export const EMPTY_PAGE_ICON: Icon = SquareDashed;
/**
 * A page's icon: its own, else its first pane's kind icon (`kindIcon`: 服务 = the server, 浏览器 = the globe…), else
 * the empty page's. A pinned page (固定, `shared`) keeps it — the Rail and the Shelf's top-left add a pin corner
 * (owner 2026-10-25).
 */
export function pageIcon(page: Pick<SidePage, "icon" | "cards" | "emptyKind">, kindIcon: (kind: string) => Icon | null): Icon {
  if (page.icon) return PAGE_ICON_COMPONENTS[page.icon];
  const first = page.cards[0];
  return (first ? kindIcon(first.kind) : page.emptyKind ? kindIcon(page.emptyKind) : null) ?? EMPTY_PAGE_ICON;
}
