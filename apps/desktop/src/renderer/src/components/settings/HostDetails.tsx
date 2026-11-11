import type { ReactNode } from "react";
import { useI18n } from "../../i18n";

/** The raw text behind a connection line: closed until asked for. */
export function HostDetails({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <details className="mt-1" data-host-details="">
      <summary className="cursor-pointer text-xs text-subtle select-none hover:text-foreground">{t("host.details")}</summary>
      <div className="mt-0.5 font-mono text-caption/[inherit] whitespace-pre-wrap text-subtle">{children}</div>
    </details>
  );
}
