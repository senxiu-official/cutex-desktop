// streamdown's own control labels (code block / table / diagram / image buttons, link-safety dialog) in the
// app language: every <Streamdown> passes `translations={useStreamdownTranslations()}`. Format names
// (SVG, PNG, CSV, Markdown …) keep streamdown's defaults.
import { useMemo } from "react";
import type { StreamdownTranslations } from "streamdown";
import { useI18n } from "../i18n";

export function useStreamdownTranslations(): Partial<StreamdownTranslations> {
  const { t } = useI18n();
  return useMemo(
    () => ({
      close: t("markdown.close"),
      copied: t("markdown.copied"),
      copyCode: t("markdown.copyCode"),
      copyLink: t("markdown.copyLink"),
      copyTable: t("markdown.copyTable"),
      copyTableAsCsv: t("markdown.copyTableAsCsv"),
      copyTableAsMarkdown: t("markdown.copyTableAsMarkdown"),
      copyTableAsTsv: t("markdown.copyTableAsTsv"),
      downloadDiagram: t("markdown.downloadDiagram"),
      downloadDiagramAsMmd: t("markdown.downloadDiagramAsMmd"),
      downloadDiagramAsPng: t("markdown.downloadDiagramAsPng"),
      downloadDiagramAsSvg: t("markdown.downloadDiagramAsSvg"),
      downloadFile: t("markdown.downloadFile"),
      downloadImage: t("markdown.downloadImage"),
      downloadTable: t("markdown.downloadTable"),
      downloadTableAsCsv: t("markdown.downloadTableAsCsv"),
      downloadTableAsMarkdown: t("markdown.downloadTableAsMarkdown"),
      exitFullscreen: t("markdown.exitFullscreen"),
      externalLinkWarning: t("markdown.externalLinkWarning"),
      imageNotAvailable: t("markdown.imageNotAvailable"),
      openExternalLink: t("markdown.openExternalLink"),
      openLink: t("markdown.openLink"),
      resetView: t("markdown.resetView"),
      viewFullscreen: t("markdown.viewFullscreen"),
      zoomIn: t("markdown.zoomIn"),
      zoomOut: t("markdown.zoomOut"),
    }),
    [t],
  );
}
