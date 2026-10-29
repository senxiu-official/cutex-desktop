// 「已隐藏 N 条（只在这台桌面）· 撤销」: the line after a 隐藏 / 清除 (lib/hiddenRows); one batch is undone at a time.
import { useI18n } from "../i18n";
import { useHiddenRows } from "../lib/hiddenRows";

export function HiddenUndo({ n }: { scope: string; n: number }) {
  const { t } = useI18n();
  return (
    <div className="flex h-6 items-center gap-2 px-2 text-caption/[inherit] text-subtle" data-testid="hidden-undo">
      <span className="min-w-0 flex-1 truncate">{t("hide.done", { n })}</span>
      <button onClick={() => useHiddenRows.getState().undo()} className="shrink-0 rounded-md px-1.5 py-0.5 text-foreground hover:text-accent" data-testid="hidden-undo-button">
        {t("hide.undo")}
      </button>
    </div>
  );
}
