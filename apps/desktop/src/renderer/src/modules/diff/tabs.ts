// The diff card's tab title (useTab hook; kept out of the .tsx file).
import { useI18n } from "../../i18n";
import type { SideTabInfo, SideTabProps } from "../slots";
import { diffLabel, diffName, type DiffState } from "./diffState";

export function useDiffTab({ instance }: SideTabProps<DiffState>): SideTabInfo {
  const { t } = useI18n();
  const s = instance.state;
  if (s.source === "text") return { title: s.title, tooltip: s.title };
  const name = diffName(s.path);
  return { title: s.source === "turn" ? t("diff.turnTab", { name }) : name, tooltip: diffLabel(s) };
}
