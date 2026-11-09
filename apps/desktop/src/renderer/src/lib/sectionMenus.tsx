// Context-menu entries for sidebar project sections (lib/sidebarSections): the project menu's
// 「移到分区 ›」 and the section header menu. Prefs edits, plus 下线空闲的… for the folder's projects (lib/stopIdle).
import { ArrowDown, ArrowUp, Check, ChevronsDownUp, ChevronsUpDown, FolderInput, FolderMinus, FolderPlus, Palette, Pencil, Power, Trash2 } from "lucide-react";
import type { MessageKey } from "../i18n";
import { folderLookDialog, promptDialog, type MenuEntry } from "./contextMenu";
import { sidebarMenuTail } from "./customizeMenu";
import { folderIdleScope, stopIdleMenuEntries } from "./stopIdle";
import { getUiPrefs, updateSections } from "./prefs";
import { assignSection, createSection, deleteSection, moveSection, renameSection, sectionOf, setSectionCollapsed, setSectionLook, type SidebarSection } from "./sidebarSections";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
const ICON = 14;
const withSeparator = (entries: MenuEntry[]): MenuEntry[] => (entries.length ? [...entries, "separator"] : []);

/** Asks for a name, then makes a section holding `members` (nothing on cancel / empty name). */
export async function newSectionWith(members: readonly string[], t: T): Promise<void> {
  const name = (await promptDialog(t("section.newTitle"), "", { placeholder: t("section.namePlaceholder") }))?.trim();
  if (name) updateSections((list) => createSection(list, name, members));
}

/** 「移到分区 ›」 for the project with member key `key` (lib/sidebarSections memberKey). */
export function moveToSectionEntry(key: string, t: T): MenuEntry {
  const sections = getUiPrefs().sidebarSections;
  const current = sectionOf(sections, key);
  return {
    label: t("menu.moveToSection"),
    icon: <FolderInput size={ICON} />,
    onSelect: () => {},
    submenu: [
      ...sections.map((s) => ({
        label: s.name,
        icon: s.id === current?.id ? <Check size={ICON} /> : undefined,
        disabled: s.id === current?.id,
        onSelect: () => updateSections((list) => assignSection(list, key, s.id)),
      })),
      sections.length > 0 && "separator",
      { label: t("menu.newSection"), icon: <FolderPlus size={ICON} />, onSelect: () => newSectionWith([key], t) },
      current && { label: t("menu.leaveSection"), icon: <FolderMinus size={ICON} />, onSelect: () => updateSections((list) => assignSection(list, key, null)) },
    ],
  };
}

/** The section header menu; `visible` = the section ids shown in this scope (move up / down among them). */
export function sectionMenu(section: SidebarSection, visible: readonly string[], t: T): MenuEntry[] {
  const at = visible.indexOf(section.id);
  return [
    {
      label: section.collapsed ? t("menu.expand") : t("menu.collapse"),
      icon: section.collapsed ? <ChevronsUpDown size={ICON} /> : <ChevronsDownUp size={ICON} />,
      onSelect: () => updateSections((list) => setSectionCollapsed(list, section.id, !section.collapsed)),
    },
    {
      label: t("menu.renameSection"),
      icon: <Pencil size={ICON} />,
      onSelect: async () => {
        const name = await promptDialog(t("section.renameTitle"), section.name, { placeholder: t("section.namePlaceholder") });
        if (name?.trim()) updateSections((list) => renameSection(list, section.id, name));
      },
    },
    {
      label: t("menu.sectionLook"),
      icon: <Palette size={ICON} />,
      onSelect: async () => {
        const picked = await folderLookDialog(section.id, section.name, section.look);
        if (picked) updateSections((list) => setSectionLook(list, section.id, picked.look));
      },
    },
    { label: t("menu.moveSectionUp"), icon: <ArrowUp size={ICON} />, disabled: at <= 0, onSelect: () => updateSections((list) => moveSection(list, section.id, -1, visible)) },
    { label: t("menu.moveSectionDown"), icon: <ArrowDown size={ICON} />, disabled: at < 0 || at >= visible.length - 1, onSelect: () => updateSections((list) => moveSection(list, section.id, 1, visible)) },
    "separator",
    // 下线空闲的…: this folder's projects, on each project's host.
    ...withSeparator(stopIdleMenuEntries(folderIdleScope(section.name, section.members), t, <Power size={ICON} />)),
    { label: t("menu.deleteSection"), info: t("menu.deleteSectionHint"), icon: <Trash2 size={ICON} />, danger: true, onSelect: () => updateSections((list) => deleteSection(list, section.id)) },
    "separator",
    ...sidebarMenuTail(t),
  ];
}
