// The float of the input box's module panels (components/ComposerActionLayer): how tall it may get.

/** Gap kept between the float and the pane's top edge. */
export const LAYER_TOP_GAP = 12;
/** Never squeezed below this (in a pane shorter than this the float may reach under the window bar). */
export const LAYER_MIN = 160;

/** The float's max height: 60vh, and no taller than the room above the input box (`room`: input top − pane top). */
export function layerMaxHeight(room: number): string {
  return `min(60vh, ${Math.max(LAYER_MIN, Math.floor(room - LAYER_TOP_GAP))}px)`;
}
