// Home page settings (cutex `user-home`) and service tiles (cutex `service-tiles`): wire types come from
// @cutex-desktop/cutex-client (home.ts); this file adds the IPC result shapes. Images (cover, tile image)
// reach the renderer as data: URLs read by main — the renderer stays network-locked.
export {
  HOME_BIO_MAX,
  HOME_COVER_MAX_BYTES,
  HOME_COVER_TYPES,
  HOME_MAX_BLOCKS,
  HOME_MAX_PINS,
  HOME_PIN_KINDS,
  HOME_TILE_SIZES,
  SERVICE_TILES_FEATURE,
  USER_HOME_FEATURE,
  USER_HOME_PAGE_PINS_FEATURE,
  isPagePinKey,
  parsePagePinKey,
  readHomeDoc,
  readHomePin,
  readServiceTile,
  tilePath,
} from "@cutex-desktop/cutex-client";
export type { HomeBlock, HomeCoverType, HomeCoverUpload, HomeDoc, HomePin, HomePinKind, HomeTileSize, HomeView, ServiceTile, ServiceTileAction, ServiceTileAnswer } from "@cutex-desktop/cutex-client";

/** A refused home write as a value: `revision` = the host's current one on `home_revision_conflict`. */
export interface HomeRefusal {
  code: string;
  message: string;
  revision?: number;
}

export type HomeResult<T> = { ok: true; value: T } | { ok: false; error: HomeRefusal };

export const HOME_REVISION_CONFLICT = "home_revision_conflict";

/** An image read by main (cover, tile image). */
export interface HomeImage {
  dataUrl: string;
  etag: string | null;
}
