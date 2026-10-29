import { ImageThumb } from "./ImageThumbs";
import { itemMedia } from "../lib/itemMedia";
import { useI18n } from "../i18n";

export function ItemMedia({ item, hostId }: { item: Record<string, unknown>; hostId: string | null | undefined }) {
  const { t } = useI18n();
  const media = itemMedia(item);
  if (!media.images.length && !media.truncated) return null;
  return <div className="my-2 min-w-0" data-item-media>
    {media.truncated && <p role="status" className="my-1 text-xs text-subtle">{t("image.eventTruncated")}</p>}
    <div className="flex max-w-full flex-wrap gap-2">
      {media.images.map((image, index) => <ImageThumb key={index} image={image} hostId={hostId}
        className="inline-flex min-h-20 min-w-24 max-w-full items-center justify-center rounded-lg border border-border"
        imgClassName="max-h-80 max-w-full object-contain"
        fallback={<span className="px-3 py-2 text-xs text-subtle">{t("image.unavailable")}</span>} />)}
    </div>
  </div>;
}
