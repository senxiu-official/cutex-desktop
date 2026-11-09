import { Hand } from "lucide-react";
import { defineModule, pageTitle, services, useI18n, useModulePref } from "@cutex-desktop/module-api";
import { Button, Page, Section, SettingRow, TrayButton } from "@cutex-desktop/module-api/ui";

const MODULE = "my-module";

function OpenButton() {
  const { t } = useI18n();
  return (
    <TrayButton label={t("my-module.open")} onClick={() => services.ui.openPage("my-module.page")}>
      <Hand size={16} aria-hidden />
    </TrayButton>
  );
}

function CounterPage() {
  const { t } = useI18n();
  const [count, setCount] = useModulePref<number>(MODULE, "count", 0);
  return (
    <Page>
      <Section title={t("my-module.title")} hint={t("my-module.hint")}>
        <SettingRow label={t("my-module.count", { n: count })}>
          <Button variant="primary" onClick={() => setCount(count + 1)}>
            {t("my-module.press")}
          </Button>
        </SettingRow>
      </Section>
    </Page>
  );
}

export default defineModule({
  id: MODULE,
  titleKey: "my-module.title",
  descriptionKey: "my-module.description",
  contributes: {
    "tray.entry": [{ id: "my-module.tray", Button: OpenButton }],
    "main.page": [{ id: "my-module.page", Page: CounterPage, useTitle: pageTitle("my-module.title") }],
  },
});
