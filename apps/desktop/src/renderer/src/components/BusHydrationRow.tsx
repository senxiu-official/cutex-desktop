// Top of a paged timeline (bootstrap-bounded-bus): the bus messages of turns paged in later were not all
// read (a failed read, a cursor that did not move, or the page budget). 继续读取 resumes from where it stopped.
import { useI18n } from "../i18n";

export function BusHydrationRow({ onContinue }: { onContinue(): void }) {
  const { t } = useI18n();
  return (
    <div data-testid="bus-hydration-incomplete" className="my-1 flex items-center justify-center text-xs text-subtle">
      {t("conversation.busHydrationIncomplete")}
      <button onClick={onContinue} className="ml-2 text-accent hover:underline">
        {t("conversation.busHydrationContinue")}
      </button>
    </div>
  );
}
