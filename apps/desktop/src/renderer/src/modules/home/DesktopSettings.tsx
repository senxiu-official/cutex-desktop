// Settings → 桌面 → 主页内容 (design 006 v1): the home's content (cover, bio, blocks, entries) stays edited on the
// desktop itself (编辑主页, ./EditPanel — the real desktop is the preview); this card says so and opens it there.
import { useI18n } from "../../i18n";
import { revealDesktop } from "../../lib/paneActions";
import { Button, Section, SettingRow } from "../../components/settings/Form";
import { setHomeEditing } from "./store";
import { useHomeSource } from "./hooks";
import { useApp } from "../../store";
import { TargetHostContext } from "../../lib/targetHost";

export function HomeDesktopSettings() {
  const { t } = useI18n();
  const home = useHomeSource();
  const host = useApp((s) => s.hosts?.hosts.find((h) => h.id === home.hostId)?.label) ?? home.hostId ?? "—";
  return (
    <TargetHostContext.Provider value={home.hostId}>
    <Section title={t("home.settings.title")} hint={t(home.entry?.source === "host" ? "settings.ia.homeScope" : home.entry?.source === "local" ? "settings.ia.homeLocal" : "settings.loading", { host })}>
      <SettingRow navigation agents="none" source={home.entry?.source ?? "host"} label={t("home.edit")} hint={t("home.settings.hint")}>
        <Button
          onClick={() => {
            revealDesktop();
            setHomeEditing(true);
          }}
        >
          {t("home.settings.open")}
        </Button>
      </SettingRow>
    </Section>
    </TargetHostContext.Provider>
  );
}
