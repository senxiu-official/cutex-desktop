import { Button, Section } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { openOnboarding } from "../../lib/onboarding";
import { runGuideAction, settingsAction } from "../../lib/guideActions";
import { useApp } from "../../store";
import { NEW_FEATURES, supportsFeature } from "./features";

/** Always reachable, including before connecting and on legacy hosts. No daemon calls. */
export function NewFeaturesPage() {
  const { t } = useI18n();
  const features = useApp((s) => s.features);
  const host = useApp((s) => s.hosts?.hosts.find((h) => h.id === s.hosts?.active)?.label ?? s.hosts?.active ?? "—");
  return <div className="space-y-4" data-new-features="">
    <p className="whitespace-pre-line text-meta text-muted">{t("onboarding.features.host", { host })}</p>
    <Button onClick={() => openOnboarding({ kind: "whatsNew", version: "0.2.0" })}>{t("onboarding.features.replay")}</Button>
    {NEW_FEATURES.map((feature) => {
      const supported = supportsFeature(feature, features);
      return <Section key={feature.id} title={t(feature.title)}>
        <div data-new-feature={feature.id} data-supported={supported}>
          {!supported && <p className="mb-2 text-meta text-warn-text">{t("onboarding.features.needs")}</p>}
          <p className="whitespace-pre-line text-ui text-muted">{t(feature.body)}</p>
          {supported && feature.page && <div className="mt-3"><Button onClick={() => void runGuideAction(settingsAction(feature.page!))}>{t("onboarding.features.go")}</Button></div>}
        </div>
      </Section>;
    })}
  </div>;
}
