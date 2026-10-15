import { useI18n } from "../../i18n";
import type { SideTabProps } from "../slots";
import type { NoteState } from "./model";

export function useListTab() { const { t } = useI18n(); return { title: t("notes.list") }; }
export function useNoteTab({ instance }: SideTabProps<NoteState>) { const { t } = useI18n(); return { title: instance.state.title || t("notes.note") }; }
