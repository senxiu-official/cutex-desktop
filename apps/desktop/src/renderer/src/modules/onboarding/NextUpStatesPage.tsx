// 帮助与文档 → 「接下来里的状态」 (Next Up registry 1.3/1.4 §六): every state a Next Up row can be, what it means, its
// buttons and how it ends — generated from the one code table (lib/inputLedger/nextUpRegistry), so it can never
// disagree with what the rows show. Self-contained (no props, no daemon calls).
import { Info } from "lucide-react";
import { Section } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { NEXT_UP_STATES, REGISTRY_VERSION, helpRows, langOf, stateLabelKey } from "../../lib/inputLedger/nextUpRegistry";

export function NextUpStatesPage() {
  const { t, locale } = useI18n();
  const lang = langOf(locale);
  const rows = helpRows(lang);
  const label = (key: string) => t(key as MessageKey, { time: "1:45" });
  return (
    <div className="space-y-4" data-help-next-up="">
      <Section title={t("nextUp.help.title")}>
        <ol className="divide-y divide-border">
          {rows.map(row => (
            <li key={row.id} className="py-2" data-next-up-help-state={row.id}>
              <div className="flex items-baseline gap-2">
                <span className="w-5 shrink-0 text-right text-meta tabular-nums text-subtle">{row.n}</span>
                <span className={`text-sm font-medium ${NEXT_UP_STATES[row.id].tone === "danger" ? "text-danger-text" : NEXT_UP_STATES[row.id].tone === "warn" ? "text-warn-text" : "text-foreground"}`}>
                  {row.labelKeys.map(label).join(" / ")}
                </span>
              </div>
              <div className="ml-7 space-y-0.5 text-meta">
                <p className="text-muted">{row.meaning}</p>
                {row.info && <p className="flex items-start gap-1 text-muted" data-next-up-help-info={row.id}><Info aria-hidden className="mt-0.5 size-3 shrink-0" />{row.info}</p>}
                <p className="text-subtle"><span className="text-muted">{t("nextUp.help.buttons")}：</span>{row.buttons.length ? row.buttons.join(" · ") : t("nextUp.help.none")}</p>
                <p className="text-subtle" data-next-up-help-exit={row.id}><span className="text-muted">{t("nextUp.help.exit")}：</span>
                  {row.deadline ? t("nextUp.help.exitDeadline", { to: t(stateLabelKey(row.deadline.to) as MessageKey) }) : t("nextUp.help.exitOwner", { buttons: row.disposals.join(" / ") })}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <p className="text-caption text-subtle">{t("nextUp.help.version", { version: REGISTRY_VERSION })}</p>
    </div>
  );
}
