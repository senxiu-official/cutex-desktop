// Who reads `cutex-media:` / event-blob images for ImageThumb (ItemMedia in tool rows). The desktop
// leaves it unset: reads go through the host bridge with its feature and authority checks
// (lib/historyMedia). A host without that bridge (the iPad conversation) provides its own reader.
import { createContext } from "react";
import type { ThumbnailBytes } from "./fileThumbnails";
import type { MediaRef } from "./historyMedia";

export interface MediaLoader {
  /** Separates cached images of different hosts / sessions / authorities; change it to drop them. */
  scope: string;
  /** The image bytes, or a ThumbnailUnavailable when the image is not there. */
  read(ref: MediaRef, expected?: { mime: string; size: number }): Promise<ThumbnailBytes>;
}

export const MediaLoaderContext = createContext<MediaLoader | null>(null);
