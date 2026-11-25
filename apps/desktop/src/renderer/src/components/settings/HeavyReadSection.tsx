// 主机详情 → 高级 → 性能 → 重型读取并发数 (cutex r295; lib/heavyReadConcurrency): 自动（N） or a manual 2 / 4, with
// 6 / 8 under 高级. What it is goes in the ⓘ; the running number and 主机服务重启后生效 (the app's name for the
// Management service, as on the card's timing chip) are the visible hint (R7).
// Saving never restarts anything. Hidden on hosts that do not report the setting.
import { useI18n } from "../../i18n";
import { useHostAccess } from "../../lib/hostAccess";
import { HEAVY_READ_STEADY_MAX, useHeavyRead } from "../../lib/heavyReadConcurrency";
import { settingsAnchorId } from "../../lib/settingsNav";
import { ResetButton, Section, Select, SettingRow } from "./Form";

const AUTO = "auto";

export function HeavyReadSection({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const owner = useHostAccess(hostId).isOwner;
  const { view, error, busy, save } = useHeavyRead(hostId);
  if (!view) return null;
  const options = [
    { value: AUTO, label: t("shell.access.heavyRead.auto", { count: view.auto }) },
    ...view.options.map((n) => ({ value: String(n), label: String(n), ...(n > HEAVY_READ_STEADY_MAX ? { group: t("shell.access.heavyRead.advancedGroup") } : {}) })),
  ];
  return (
    <Section id={settingsAnchorId("heavyRead")} title={t("shell.access.heavyRead.card")}>
      <SettingRow agents="hostRestart" source="host" readOnly={!owner}
        label={t("shell.access.heavyRead.label")}
        info={<>{t("shell.access.heavyRead.help")}<br />{t("shell.access.heavyRead.measured")}</>}
        hint={
          <span data-heavy-read-hint="">
            {t("shell.access.heavyRead.active", { count: view.active })}
            {view.pending && <span className="text-attention"> · {t("settings.scope.agents.hostRestart")}</span>}
            {error && <span className="block text-danger">{t("shell.access.heavyRead.saveFailed", { error })}</span>}
          </span>
        }
        reset={<ResetButton disabled={view.override === null || busy || !owner} onClick={() => void save(null)} />}
      >
        <Select
          value={view.override === null ? AUTO : String(view.override)}
          options={options}
          disabled={busy || !owner}
          width="w-36"
          onChange={(v) => void save(v === AUTO ? null : Number(v))}
        />
      </SettingRow>
    </Section>
  );
}
